import { chromium } from "playwright";

const URL = process.env.E2E_URL || "http://app.localhost:3000/worlds/6ab9ebc7ec45066f91c1c5dc";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (err) => console.error("pageerror:", String(err)));
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__worldCanvasDebug), null, { timeout: 30000 });
await page.waitForTimeout(1500);

// fit-to-content 与 e2e 脚本一致
await page.evaluate(() => {
  const { editor } = window.__worldCanvasDebug;
  const adapter = editor.renderAdapter;
  const blocks = editor.state.getAllBlocks((r) => r.type === "entity-card");
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const rec of blocks) {
    const x = Number(rec.attrs.x) || 0, y = Number(rec.attrs.y) || 0;
    const w = Number(rec.attrs.width) || 200, h = Number(rec.attrs.height) || 110;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
  }
  const viewX = 400 + 40, viewY = 90 + 40, viewW = 1600 - 400 - 380 - 80, viewH = 1000 - 90 - 80;
  const scale = Math.max(0.3, Math.min(1, Math.min(viewW / (maxX - minX + 80), viewH / (maxY - minY + 80))));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  adapter.setTransform(viewX + viewW / 2 - cx * scale, viewY + viewH / 2 - cy * scale, scale);
});
await page.waitForTimeout(600);
const zoom = await page.evaluate(() => window.__worldCanvasDebug.editor.renderAdapter.transform.scale);
console.log("zoom:", zoom);
await page.screenshot({ path: "scripts/probe-shot.png" });
await browser.close();
