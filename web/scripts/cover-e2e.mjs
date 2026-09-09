/* E2E 诊断：目标世界实体卡头图全链路（bundle 新鲜度 → store → pixi 场景 → 截图） */
import { chromium } from "playwright";

const URL = process.env.E2E_URL || "http://app.localhost:3000/worlds/6ab9ebc7ec45066f91c1c5dc";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("console", (msg) => { if (/error/i.test(msg.type())) console.log("[console.error]", msg.text().slice(0, 300)); });
page.on("pageerror", (err) => console.log("[pageerror]", String(err).slice(0, 300)));
page.on("requestfailed", (req) => { if (/content|files\/remote/.test(req.url())) console.log("[requestfailed]", req.url().slice(0, 140), req.failure()?.errorText); });

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__worldCanvasDebug), null, { timeout: 30000 });
await page.waitForTimeout(4000);

const report = await page.evaluate(() => {
  const { editor, store } = window.__worldCanvasDebug;
  const state = store.getState();
  const target = state.entities.find((e) => String(e.title).includes("深夜客厅（主场）"));
  const out = { apiBase: state.apiBase, dataVersion: state.dataVersion };
  if (!target) return { ...out, entityFound: false };
  out.entityFound = true;
  out.references = (target.references ?? []).map((r) => ({ modality: r.modality, status: r.status, purpose: r.purpose, assetId: r.assetId, url: r.url, source: r.source }));
  const block = editor.state.getAllBlocks((r) => r.id === `entity:${target.id}`)[0];
  out.attrs = block ? { cover: block.attrs.cover, coverUrl: block.attrs.coverUrl, coverKind: block.attrs.coverKind } : null;
  // pixi 场景解剖：找到该卡容器（含大标题文本的容器），数 children/纹理
  const stage = editor.renderAdapter.app.stage;
  const found = { cards: 0, headerSprites: [], texts: [] };
  const walk = (container) => {
    const textChildren = container.children.filter((c) => typeof c.text === "string");
    const bigTitle = textChildren.find((c) => String(c.text).includes("深夜客厅（主场）") && Number(c.style?.fontSize) >= 15);
    if (bigTitle) {
      found.cards += 1;
      found.texts.push(textChildren.map((c) => `${c.text}(${c.style?.fontSize})`));
      const sprites = [];
      const collect = (node) => { if (typeof node.text !== "string" && node.texture) sprites.push({ w: node.texture.width, h: node.texture.height, x: node.x, y: node.y, sx: node.scale.x }); node.children.forEach(collect); };
      collect(container);
      found.headerSprites.push(sprites);
    }
    container.children.forEach(walk);
  };
  walk(stage);
  out.scene = found;
  return out;
});
console.log(JSON.stringify(report, null, 2));

// 放大对准这张卡截图
await page.evaluate(() => {
  const { editor } = window.__worldCanvasDebug;
  const rec = editor.state.getAllBlocks((r) => r.type === "entity-card").find((r) => String(r.attrs.title).includes("深夜客厅（主场）"));
  if (!rec) return;
  editor.renderAdapter.setTransform(640 - Number(rec.attrs.x) * 0.9, 100 - Number(rec.attrs.y) * 0.9, 0.9);
});
await page.waitForTimeout(2500);
await page.screenshot({ path: "scripts/cover-e2e.png" });
console.log("screenshot saved");
await browser.close();
