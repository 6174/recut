/* E2E：zoom 重渲染零闪烁（同步纹理缓存）+ 失败重试仍恢复 */
import { chromium } from "playwright";

const URL = process.env.E2E_URL || "http://app.localhost:3000/worlds/6ab9ebc7ec45066f91c1c5dc";
const COVER_ASSET = "06b116aaac1bcadd34226250";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
let blocked = 0;
await page.route(`**/v1/media/assets/${COVER_ASSET}/content*`, (route) => {
  blocked += 1;
  if (blocked === 1) return route.abort();
  return route.continue();
});
page.on("pageerror", (err) => console.log("[pageerror]", String(err).slice(0, 300)));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__worldCanvasDebug), null, { timeout: 30000 });
await page.waitForTimeout(8000); // 覆盖重试窗口（2s+6s），头图已就位并进入缓存

// 连续 20 次缩放触发 renderOnZoom 全量重建，每次重建后立刻数该卡 sprite（同步，零等待）
const flicker = await page.evaluate(() => {
  const { editor } = window.__worldCanvasDebug;
  const adapter = editor.renderAdapter;
  const rec = editor.state.getAllBlocks((r) => r.type === "entity-card").find((r) => String(r.attrs.title).includes("深夜客厅（主场）"));
  if (!rec) return { missing: true };
  let min = Infinity, max = 0;
  for (let step = 0; step < 20; step += 1) {
    adapter.setTransform(640 - Number(rec.attrs.x) * 0.9, 100 - Number(rec.attrs.y) * 0.9, 0.7 + step * 0.02);
    let n = 0;
    const walk = (container) => {
      if (container.children.some((c) => typeof c.text === "string" && String(c.text).includes("深夜客厅（主场）"))) {
        const collect = (node) => { if (typeof node.text !== "string" && node.texture) n += 1; node.children.forEach(collect); };
        collect(container);
        return;
      }
      container.children.forEach(walk);
    };
    walk(adapter.app.stage);
    min = Math.min(min, n); max = Math.max(max, n);
  }
  return { min, max, missing: false };
});
console.log("zoom flicker check: sprite count min/max =", flicker.min, "/", flicker.max);
if (flicker.missing || flicker.min !== 1) throw new Error("zoom 重渲染中出现 sprite 消失（闪烁）");
console.log("PASS: 连续 20 次 zoom 重建，头图 sprite 同步常在，零闪烁");
await browser.close();
