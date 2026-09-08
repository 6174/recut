import { chromium } from "playwright";
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://app.localhost:3000/worlds/ac5009d9fdc748643ebb06fe", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__worldCanvasDebug), null, { timeout: 30000 });
await page.waitForTimeout(2500);
const diag = await page.evaluate(() => {
  const { editor } = window.__worldCanvasDebug;
  const t = editor.renderAdapter.transform;
  const cards = editor.state.getAllBlocks((r) => r.type === "entity-card").map((r) => ({
    title: r.attrs.title, x: Number(r.attrs.x), y: Number(r.attrs.y), w: Number(r.attrs.width), h: Number(r.attrs.height),
    screenX: (Number(r.attrs.x) || 0) * t.scale + t.x, screenY: (Number(r.attrs.y) || 0) * t.scale + t.y,
  }));
  return { transform: t, cards };
});
console.log(JSON.stringify(diag, null, 1).slice(0, 2500));
await browser.close();
