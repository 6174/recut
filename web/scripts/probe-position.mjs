import { chromium } from "playwright";

const URL = process.env.E2E_URL || "http://app.localhost:3000/worlds/6ab9ebc7ec45066f91c1c5dc";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (err) => console.error("pageerror:", String(err)));
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__worldCanvasDebug), null, { timeout: 30000 });
await page.waitForTimeout(1500);

const measure = (label) => page.evaluate((label) => {
  const { editor } = window.__worldCanvasDebug;
  const adapter = editor.renderAdapter;
  const t = adapter.transform;
  const rec = editor.state.getAllBlocks((r) => r.type === "entity-card")[0];
  const block = adapter.getBlockById(rec.id);
  if (!block) return "no block";
  // 深度遍历 contentElement，收集每个容器的 world 位置/缩放
  let captionLayer = null;
  const walk = (el, worldX, worldY, worldScale) => {
    for (const child of el.children) {
      const cx = worldX + child.x * worldScale;
      const cy = worldY + child.y * worldScale;
      const cs = worldScale * child.scale.x;
      if (child.scale && Math.abs(child.scale.x - 1) > 1e-6 && child.children.length === 2 && !captionLayer) {
        captionLayer = { worldY: child.y, scale: child.scale.x, screenTop: cy * t.scale + t.y };
      }
      walk(child, cx, cy, cs);
    }
  };
  walk(block.contentElement.el, Number(rec.attrs.x) || 0, Number(rec.attrs.y) || 0, 1);
  const cardTopScreen = (Number(rec.attrs.y) || 0) * t.scale + t.y;
  return {
    zoom: t.scale,
    cardTopScreen,
    caption: captionLayer,
    gap: captionLayer ? cardTopScreen - captionLayer.screenTop : null,
  };
}, label);

for (const z of [0.5, 1.0, 1.5]) {
  await page.evaluate((z) => {
    const { editor } = window.__worldCanvasDebug;
    const adapter = editor.renderAdapter;
    const t = adapter.transform;
    adapter.setTransform(t.x, 400, z);
  }, z);
  await page.waitForTimeout(400);
  console.log(JSON.stringify(await measure(z)));
}
await browser.close();
