/**
 * 诊断对照：老的 iframe/单页 editor（apps/editor/ui demo，无 Next、无 StrictMode）拖拽成本。
 * 用 __recutTest 选中并拖拽一个元素，输出每帧 wall / CDP 指标 / GL 调用计数。
 *
 * usage: node scripts/diag-drag-demo.mjs [url]
 *   default: http://127.0.0.1:5199/demo.html?test=1   (生产 dist)
 */
import { chromium } from "@playwright/test";

const URL = process.argv[2] ?? "http://127.0.0.1:5199/demo.html?test=1";
const KEYS = ["ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "TaskDuration", "LayoutCount", "RecalcStyleCount"];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.addInitScript(() => {
    window.__diag = { gl: {} };
    const patch = (proto, name, key) => {
      if (!proto || typeof proto[name] !== "function") return;
      const orig = proto[name];
      proto[name] = function (...args) {
        window.__diag.gl[key] = (window.__diag.gl[key] ?? 0) + 1;
        return orig.apply(this, args);
      };
    };
    patch(CanvasRenderingContext2D.prototype, "clearRect", "clearRect");
    patch(CanvasRenderingContext2D.prototype, "drawImage", "drawImage2D");
    patch(window.WebGL2RenderingContext?.prototype, "texSubImage2D", "texSub");
    patch(window.WebGLRenderingContext?.prototype, "texSubImage2D", "texSub");
    patch(window.WebGL2RenderingContext?.prototype, "texImage2D", "texImage");
    patch(window.WebGLRenderingContext?.prototype, "texImage2D", "texImage");
  });
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__recutTest && document.querySelector("canvas[data-recut-canvas]"), null, { timeout: 60000 });
  await page.waitForTimeout(5000);

  const target = await page.evaluate((preferText) => {
    const t = window.__recutTest;
    const doc = t.getProjectDocument?.();
    const ids = t.getElementIds();
    if (preferText && doc) {
      const scenes = doc.scenes ?? [];
      for (const scene of scenes) {
        const tracks = [scene.tracks?.main, ...(scene.tracks?.overlay ?? []), ...(scene.tracks?.audio ?? [])];
        for (const track of tracks) {
          if (track?.type !== "text") continue;
          for (const el of track.elements ?? []) {
            const b = t.getNodeBounds(el.id);
            if (b && b.width > 20 && b.height > 10) return { id: el.id, b, type: "text" };
          }
        }
      }
    }
    for (const id of ids) {
      const b = t.getNodeBounds(id);
      if (b && b.width > 40 && b.height > 20) return { id, b, type: "any" };
    }
    return null;
  }, process.env.ELEMENT !== "any");
  if (!target) throw new Error("no draggable element found in demo");
  console.log(`target element=${target.id} type=${target.type} bounds=${JSON.stringify(target.b)}`);
  await page.evaluate((id) => window.__recutTest.selectElement(id), target.id);

  const center = await page.evaluate(({ cx, cy }) => window.__recutTest.canvasToScreen(cx, cy), target.b);
  const cx = center.x, cy = center.y;

  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable").catch(() => {});
  const metricSet = async () => {
    const { metrics } = await client.send("Performance.getMetrics");
    const m = {}; for (const x of metrics) m[x.name] = x.value; return m;
  };
  const glNow = () => page.evaluate(() => ({ ...window.__diag.gl }));

  const before = await metricSet();
  const glBefore = await glNow();
  const t0 = Date.now();
  await client.send("Profiler.enable").catch(() => {});
  await client.send("Profiler.setSamplingInterval", { interval: 200 }).catch(() => {});
  await client.send("Profiler.start").catch(() => {});
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const perMove = [];
  for (let i = 1; i <= 12; i++) {
    const s = Date.now();
    await page.mouse.move(cx + i * 6, cy + i * 2);
    perMove.push(Date.now() - s);
  }
  await page.mouse.up();
  const { profile } = await client.send("Profiler.stop").catch(() => ({ profile: null }));
  const after = await metricSet();
  const glAfter = await glNow();
  const wall = Date.now() - t0;

  console.log(`\n=== [${URL}] 12-move wall=${wall}ms per-move=${JSON.stringify(perMove)}`);
  const glDelta = {}; for (const k of Object.keys(glAfter)) glDelta[k] = glAfter[k] - (glBefore[k] ?? 0);
  console.log(`GL/canvas calls in window:`, JSON.stringify(glDelta));
  console.log(`metrics delta (ms):`, JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, +(((after[k] ?? 0) - (before[k] ?? 0)) * 1000).toFixed(1)]))));
  if (profile) {
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const self = new Map();
    for (let i = 0; i < profile.samples.length; i++) {
      const node = byId.get(profile.samples[i]);
      if (!node) continue;
      const cf = node.callFrame;
      const key = `${cf.functionName || "(anon)"} @ ${cf.url.split("/").pop()}:${cf.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0));
    }
    console.log(`--- top self-time (ms) ---`);
    for (const [fn, us] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 28)) {
      console.log(`  ${(us / 1000).toFixed(1).padStart(8)}ms  ${fn}`);
    }
  }
} finally {
  await browser.close().catch(() => {});
}
