import { chromium } from "playwright";
// READ-ONLY probe: never mutates canvas elements. Zooms the viewport (UI only) and clicks existing cards.
const URL = "http://app.localhost:3000/worlds/07e63fbda9c580d68f06041b?ctx=9b410a1906c10fd07e5beac0&cvperf=1";
const browser = await chromium.launch({ channel: "chrome", headless: false });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", (m) => { const t = m.text(); if (t.includes("[cvperf]")) console.log(t); });
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__worldCanvasDebug), null, { timeout: 30000 });
await page.waitForTimeout(2500);

const original = await page.evaluate(() => { const t = window.__worldCanvasDebug.editor.renderAdapter.transform; return { x: t.x, y: t.y, scale: t.scale }; });
console.log("original transform", JSON.stringify(original));

await page.evaluate(() => {
  window.__lag = { max: 0 };
  let last = performance.now();
  const tick = () => { const now = performance.now(); const g = now - last; last = now; if (g > window.__lag.max) window.__lag.max = g; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

async function trial(scale) {
  // center on first entity card
  await page.evaluate((s) => {
    const { editor } = window.__worldCanvasDebug;
    const adapter = editor.renderAdapter;
    const view = adapter.getView(); const rect = view.getBoundingClientRect();
    const rec = editor.state.getAllBlocks((r) => r.type === "entity-card")[0];
    const x = +rec.attrs.x || 0, y = +rec.attrs.y || 0, w = +rec.attrs.width || 200, h = +rec.attrs.height || 110;
    const cx = x + w / 2, cy = y + h / 2;
    adapter.setTransform(rect.width / 2 - cx * s, rect.height / 2 - cy * s, s);
  }, scale);
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__worldCanvasDebug.store.getState().selectMany([]));
  await page.waitForTimeout(300);
  const onScreen = await page.evaluate(() => {
    const { editor } = window.__worldCanvasDebug;
    const adapter = editor.renderAdapter; const view = adapter.getView(); const rect = view.getBoundingClientRect(); const t = adapter.transform;
    const out = [];
    for (const rec of editor.state.getAllBlocks((r) => r.type === "entity-card")) {
      const x = +rec.attrs.x || 0, y = +rec.attrs.y || 0, w = +rec.attrs.width || 200, h = +rec.attrs.height || 110;
      const cx = rect.left + (x + w / 2) * t.scale + t.x, cy = rect.top + (y + h / 2) * t.scale + t.y;
      if (cx > 430 && cx < 1240 && cy > 120 && cy < 870) out.push({ cx, cy });
    }
    return out;
  });
  console.log(`\n=== scale=${scale} onScreen=${onScreen.length} ===`);
  for (let i = 0; i < Math.min(onScreen.length, 4); i++) {
    await page.evaluate(() => { window.__lag.max = 0; });
    const t0 = Date.now();
    await page.mouse.move(onScreen[i].cx, onScreen[i].cy);
    await page.keyboard.down("Shift"); await page.mouse.down(); await page.mouse.up(); await page.keyboard.up("Shift");
    const events = Date.now() - t0;
    await page.waitForTimeout(300);
    const lag = await page.evaluate(() => Math.round(window.__lag.max));
    const sel = await page.evaluate(() => window.__worldCanvasDebug.store.getState().selectedIds.length);
    console.log(`  click#${i + 1} events=${events}ms maxFrameGap=${lag}ms selected=${sel}`);
  }
}

await trial(1.0);
await trial(2.0);
await trial(3.0);

// restore original viewport (UI only)
await page.evaluate((o) => { window.__worldCanvasDebug.editor.renderAdapter.setTransform(o.x, o.y, o.scale); }, original);
await browser.close();
