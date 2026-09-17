/**
 * 诊断：定位 native timeline-editor 的 asset.list 风暴与拖拽卡顿来源。
 * 对比「静置窗口」与「拖拽窗口」的请求/WS/longtask，并抓取 asset.list 的调用栈。
 *
 * usage: node scripts/diag-drag-profile.mjs
 */
import { chromium } from "@playwright/test";

const WEB_URL = process.env.WEB_URL ?? "http://app.localhost:3000";
const SERVICE_URL = process.env.SERVICE_URL ?? "http://127.0.0.1:17373";
const APP_ID = "recut.editor";

async function api(path, init) {
  const res = await fetch(`${SERVICE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "Accept-Language": "zh", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const invoke = (projectId, op, input) =>
  api(`/v1/projects/${projectId}/apps/${APP_ID}/api/${op}`, { method: "POST", body: JSON.stringify(input ?? {}) });

const browser = await chromium.launch();
let projectId = null;
const pageErrors = [];
  let mediaId = "";
try {
  const created = await api("/v1/projects", {
    method: "POST",
    body: JSON.stringify({ name: `Drag Diag ${Date.now()}`, appId: APP_ID }),
  });
  projectId = created.body.id;
  await invoke(projectId, "project.create", {});

  // 上传一张小图并挂到项目，模拟"素材库非空"的真实项目。
  if (process.env.WITH_MEDIA !== "0") {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    const form = new FormData();
    form.append("file", new Blob([png], { type: "image/png" }), "diag.png");
    const up = await fetch(`${SERVICE_URL}/v1/media/assets`, { method: "POST", body: form });
    const asset = await up.json().catch(() => null);
    if (asset?.id) {
      await fetch(`${SERVICE_URL}/v1/media/assets/${asset.id}/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      mediaId = asset.id;
      console.log(`media asset attached: ${asset.id}`);
    } else {
      console.log(`media upload failed: ${up.status}`);
    }
  }

  const ELEMENT = process.env.ELEMENT ?? "text";
  await invoke(projectId, "timeline.command", {
    op: {
      type: "insert",
      payload:
        ELEMENT === "image"
          ? {
              element: {
                type: "image", name: "perf-drag-image", startSec: 0, durationSec: 6,
                mediaId,
              },
            }
          : {
              element: {
                type: "text", name: "perf-drag-text", startSec: 0, durationSec: 6,
                params: { content: "性能诊断文本", fontSize: 160, color: "#facc15" },
              },
            },
    },
  });

  // 额外 clip：用于放大「一次预览更新连坐多少 clip 重渲染」的扇出。
  const extra = Number.parseInt(process.env.MANY ?? "0", 10);
  for (let i = 0; i < extra; i++) {
    await invoke(projectId, "timeline.command", {
      op: {
        type: "insert",
        payload: {
          element: {
            type: "text",
            name: `perf-extra-${i}`,
            startSec: 10 + i * 10,
            durationSec: 5,
            params: { content: `clip ${i}`, fontSize: 80, color: "#ffffff" },
          },
        },
      },
    });
  }
  if (extra) console.log(`inserted ${extra} extra clips`);

  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__diag = { calls: [], stacks: [], gl: {} };
    window.__recutRenderLog = true;
    window.__renderCounts = {};
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
    const origFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const op = url.includes("/api/") ? url.split("/api/")[1] : "";
      window.__diag.calls.push({ t: performance.now(), op });
      if (op === "asset.list" && window.__diag.stacks.length < 6) {
        window.__diag.stacks.push({ t: performance.now(), stack: String(new Error().stack) });
      }
      return origFetch(input, init);
    };
  });

  await page.goto(`${WEB_URL}/projects/${projectId}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll("iframe").length === 0, null, { timeout: 30000 });
  await page.waitForFunction(() => {
    const c = document.querySelector("canvas[data-recut-canvas]");
    return c && c.clientWidth > 50 && c.clientHeight > 50;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(8000);

  const box = await page.evaluate(() => {
    const c = document.querySelector("canvas[data-recut-canvas]");
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const DRAG = process.env.DRAG ?? "preview";
  let cx = box.x + box.w / 2;
  let cy = box.y + box.h / 2;
  let stepX = 6;
  let stepY = 2;
  if (DRAG === "timeline") {
    const clip = await page.evaluate(() => {
      const sections = [...document.querySelectorAll("section")];
      const timeline = sections.find((s) => {
        const label = s.getAttribute("aria-label") ?? "";
        return label.includes("时间线") || label.toLowerCase().includes("timeline");
      });
      const scope = timeline ?? document;
      const el = [...scope.querySelectorAll("span")].find(
        (s) => s.textContent === "性能诊断文本",
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        sectionLabel: timeline?.getAttribute("aria-label") ?? null,
      };
    });
    if (!clip) throw new Error("timeline clip not found");
    cx = clip.x + clip.w / 2;
    cy = clip.y + clip.h / 2;
    stepX = 5;
    stepY = 0;
    console.log(`timeline clip rect=${JSON.stringify(clip)}`);
  }

  const snap = async (label, fn) => {
    await page.evaluate(() => {
      window.__diag.calls = [];
      window.__diag.stacks = [];
    });
    const t0 = Date.now();
    await fn();
    const dt = Date.now() - t0;
    const { calls, stacks } = await page.evaluate(() => ({
      calls: window.__diag.calls,
      stacks: window.__diag.stacks,
    }));
    const counts = {};
    for (const c of calls) counts[c.op] = (counts[c.op] ?? 0) + 1;
    console.log(`\n[${label}] ${dt}ms total=${calls.length}`, counts);
    const seen = new Set();
    for (const s of stacks) {
      const key = s.stack.split("\n").slice(1, 6).join(" | ");
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`\n--- ${label} asset.list stack ---\n${s.stack}`);
    }
    return counts;
  };

  await snap("idle-2s", () => page.waitForTimeout(2000));
  await snap("select-click", async () => { await page.mouse.click(cx, cy); await page.waitForTimeout(800); });

  // 每帧成本分类：CDP Performance.getMetrics 增量（script / layout / style / task / GPU）
  const wclient = await page.context().newCDPSession(page);
  await wclient.send("Performance.enable").catch(() => {});
  const metricSet = async () => {
    const { metrics } = await wclient.send("Performance.getMetrics");
    const map = {};
    for (const m of metrics) map[m.name] = m.value;
    return map;
  };
  const KEYS = ["ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "TaskDuration", "LayoutCount", "RecalcStyleCount"];
  const before = await metricSet();
  const glBefore = await page.evaluate(() => ({ ...window.__diag.gl }));
  const t0 = Date.now();
  await wclient.send("Profiler.enable").catch(() => {});
  await wclient.send("Profiler.setSamplingInterval", { interval: 200 }).catch(() => {});
  await wclient.send("Profiler.start").catch(() => {});
  await page.evaluate(() => { window.__renderCounts = {}; });
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const perMove = [];
  const BURST = Number.parseInt(process.env.BURST ?? "1", 10);
  let pointerIndex = 0;
  for (let i = 1; i <= 12; i++) {
    const a = await metricSet();
    const s = Date.now();
    for (let k = 0; k < BURST; k++) {
      pointerIndex += 1;
      await page.mouse.move(cx + pointerIndex * 6, cy + pointerIndex * 2);
    }
    perMove.push(Date.now() - s);
    const b = await metricSet();
    if (i === 1) console.log(`move#1`, JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, +(((b[k] ?? 0) - (a[k] ?? 0)) * 1000).toFixed(1)]))));
  }
  console.log(`pointermoves=${pointerIndex} burst=${BURST}`);
  await page.mouse.up();
  const { profile } = await wclient.send("Profiler.stop").catch(() => ({ profile: null }));
  const renderCounts = await page.evaluate(() => window.__renderCounts || {});
  const after = await metricSet();
  const glAfter = await page.evaluate(() => ({ ...window.__diag.gl }));
  const wall = Date.now() - t0;
  const report = (label, wall, before, after, glBefore, glAfter, profile) => {
    console.log(`\n=== ${label} wall=${wall}ms`);
    const glDelta = {};
    for (const k of Object.keys(glAfter)) glDelta[k] = glAfter[k] - (glBefore[k] ?? 0);
    console.log(`GL/canvas calls:`, JSON.stringify(glDelta));
    console.log(`window`, JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, +(((after[k] ?? 0) - (before[k] ?? 0)) * 1000).toFixed(1)]))));
    if (profile) {
      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const self = new Map();
      const inclusive = new Map();
      for (let i = 0; i < profile.samples.length; i++) {
        const node = byId.get(profile.samples[i]);
        if (!node) continue;
        const dt = profile.timeDeltas[i] ?? 0;
        const cf = node.callFrame;
        const key = `${cf.functionName || "(anon)"} @ ${cf.url.split("/").pop()}:${cf.lineNumber + 1}`;
        self.set(key, (self.get(key) ?? 0) + dt);
        // inclusive：沿 parent 链累计到每个函数名（同名只记一次，避免重复计入递归）
        let cursor = node;
        const seen = new Set();
        while (cursor) {
          const name = cursor.callFrame.functionName || "(anon)";
          if (!seen.has(name)) {
            inclusive.set(name, (inclusive.get(name) ?? 0) + dt);
            seen.add(name);
          }
          cursor = cursor.parent !== undefined ? byId.get(cursor.parent) : null;
        }
      }
      const WATCH = ["TimelineElement", "useElementPreview", "ElementInner", "TimelineTrackContent", "TimelineTrackRows", "TrackLabelsPanel", "Timeline", "EditorLayout", "PreviewPanel", "PreviewCanvas", "TransformHandles", "renderWithHooks", "beginWork", "renderRootSync", "AssetsPanel", "MediaView", "TopNavigation", "AudioLibraryView", "ComponentLibraryView", "TextView", "EffectLibraryView", "Captions", "PropertiesPanel", "AssetPreviewDialog", "MediaItemList", "DraggableItem"];
      console.log(`--- inclusive time by component (ms) ---`);
      for (const name of WATCH) {
        const us = inclusive.get(name);
        if (us) console.log(`  ${(us / 1000).toFixed(1).padStart(8)}ms  ${name}`);
      }
      console.log(`--- top self-time (ms) ---`);
      for (const [fn, us] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
        console.log(`  ${(us / 1000).toFixed(1).padStart(8)}ms  ${fn}`);
      }
    }
  };
  report(`12-move drag`, wall, before, after, glBefore, glAfter, profile);
  console.log(`per-move wall=${JSON.stringify(perMove)}`);
  console.log(`--- renders during 12-move drag (count) ---`);
  for (const [name, count] of Object.entries(renderCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(6)}  ${name}`);
  }

  // seek 路径：键盘 l 连续前移，测每次 seek 的成本
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(200);
  const sBefore = await metricSet();
  const sGlBefore = await page.evaluate(() => ({ ...window.__diag.gl }));
  await wclient.send("Profiler.start").catch(() => {});
  const perSeek = [];
  for (let i = 1; i <= 20; i++) {
    const s = Date.now();
    await page.keyboard.press("l");
    perSeek.push(Date.now() - s);
    await page.waitForTimeout(8);
  }
  const { profile: sProfile } = await wclient.send("Profiler.stop").catch(() => ({ profile: null }));
  const sAfter = await metricSet();
  const sGlAfter = await page.evaluate(() => ({ ...window.__diag.gl }));
  console.log(`\nper-seek wall=${JSON.stringify(perSeek)}`);
  report(`20x seek`, perSeek.reduce((a, b) => a + b, 0), sBefore, sAfter, sGlBefore, sGlAfter, sProfile);

  await snap("idle-after-2s", () => page.waitForTimeout(2000));
} finally {
  if (projectId) await api(`/v1/projects/${projectId}`, { method: "DELETE" }).catch(() => {});
  await browser.close().catch(() => {});
  if (pageErrors.length) console.log(`\npageErrors:\n${pageErrors.slice(0, 5).join("\n")}`);
}
