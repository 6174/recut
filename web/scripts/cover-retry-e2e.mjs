/* E2E：头图首次加载失败 → 自动重试恢复（不刷新、不交互） */
import { chromium } from "playwright";

const URL = process.env.E2E_URL || "http://app.localhost:3000/worlds/6ab9ebc7ec45066f91c1c5dc";
const COVER_ASSET = "06b116aaac1bcadd34226250";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
let blocked = 0;
await page.route(`**/v1/media/assets/${COVER_ASSET}/content*`, (route) => {
  blocked += 1;
  if (blocked === 1) return route.abort(); // 只杀第一次（模拟瞬时失败）
  return route.continue();
});
page.on("pageerror", (err) => console.log("[pageerror]", String(err).slice(0, 300)));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__worldCanvasDebug), null, { timeout: 30000 });
await page.waitForTimeout(1500); // 第一次请求已被 abort，占位图态

const countSprites = () => page.evaluate(() => {
  const stage = window.__worldCanvasDebug.editor.renderAdapter.app.stage;
  let n = 0;
  const walk = (container) => {
    const title = container.children.find((c) => typeof c.text === "string" && String(c.text).includes("深夜客厅（主场）"));
    if (title) {
      const collect = (node) => { if (typeof node.text !== "string" && node.texture) n += 1; node.children.forEach(collect); };
      collect(container);
      return;
    }
    container.children.forEach(walk);
  };
  walk(stage);
  return n;
});
const before = await countSprites();
console.log("retry-before: cover sprites =", before, "(0 = 占位图, 失败已发生)");
if (before !== 0) throw new Error("预期首次失败未复现，route 拦截失效");

await page.waitForTimeout(5000); // 等自动重试（2s）完成
const after = await countSprites();
console.log("retry-after: cover sprites =", after, "(1 = 自动重试成功)");
if (after !== 1) throw new Error("自动重试未恢复头图");
console.log("PASS: 头图首次失败 → 自动重试恢复，无需刷新");
await browser.close();
