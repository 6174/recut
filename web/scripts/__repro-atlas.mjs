import { chromium } from "playwright";

const URL = process.env.E2E_URL || "http://app.localhost:3000/worlds/07e63fbda9c580d68f06041b?ctx=9b410a1906c10fd07e5beac0";
const OUT = "/var/folders/kj/tprkfgbj3bv0c5rfxccy1b6r0000gn/T/opencode";

const browser = await chromium.launch({ channel: "chrome", headless: false });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__worldCanvasDebug), null, { timeout: 30000 });
await page.waitForTimeout(9000);

async function shot(name) { const el = await page.$("canvas"); await el.screenshot({ path: `${OUT}/${name}.png` }); }
const state = () => page.evaluate(() => {
  const a = window.__worldCanvasDebug.editor.renderAdapter;
  const tiers = [...a.imageTier.values()];
  const sum = tiers.reduce((n, t) => n + t * Math.round(t * 1.2), 0);
  return { registered: a.imageIds.size, tiers: Object.fromEntries([...new Set(tiers)].map((t) => [t, tiers.filter((x) => x === t).length])), approxPixels: sum, scale: a.transform.scale };
});

// Center of all content
const center = await page.evaluate(() => {
  const { editor } = window.__worldCanvasDebug;
  const blocks = editor.state.getAllBlocks(() => true);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const rec of blocks) {
    const x = Number(rec.attrs.x) || 0, y = Number(rec.attrs.y) || 0, w = Number(rec.attrs.width) || 200, h = Number(rec.attrs.height) || 120;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
});

// 200%
await page.evaluate(({ cx, cy }) => {
  const a = window.__worldCanvasDebug.editor.renderAdapter;
  const r = a.getView().getBoundingClientRect();
  const s = 2.0;
  a.setTransform(r.width / 2 - cx * s, r.height / 2 - cy * s, s);
}, center);
await page.waitForTimeout(6000);
console.log("at-200", JSON.stringify(await state()));
await page.evaluate(() => window.__worldCanvasDebug.editor.renderAdapter.renderNow());
await page.waitForTimeout(400);
await shot("atlas-200");

// 30%
await page.evaluate(({ cx, cy }) => {
  const a = window.__worldCanvasDebug.editor.renderAdapter;
  const r = a.getView().getBoundingClientRect();
  const s = 0.3;
  a.setTransform(r.width / 2 - cx * s, r.height / 2 - cy * s, s);
}, center);
await page.waitForTimeout(6000);
console.log("at-30", JSON.stringify(await state()));
await page.evaluate(() => window.__worldCanvasDebug.editor.renderAdapter.renderNow());
await page.waitForTimeout(600);
await shot("atlas-30");
console.log("done");
await browser.close();
