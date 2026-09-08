import { chromium } from "playwright";
const URL = "http://app.localhost:3000/worlds/6ab9ebc7ec45066f91c1c5dc";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") console.log("console err:", m.text().slice(0, 200)); });
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__worldCanvasDebug), null, { timeout: 30000 });
await page.waitForTimeout(3000);
const handles = await page.evaluate(() => {
  const { editor, store } = window.__worldCanvasDebug;
  const state = store.getState();
  if (state.readOnly) return { readOnly: true };
  // 直接读插件的 plusHandles（经 pluginRegistry）
  return { readOnly: false, selection: state.selection?.type ?? null };
});
console.log("state:", JSON.stringify(handles));
// 鼠标驱动 + 手柄：先点击选中一张卡，再拖其右缘 + 手柄到另一张卡中心
const card = await page.evaluate(() => {
  const { editor, store } = window.__worldCanvasDebug;
  const t = editor.renderAdapter.transform;
  const rect = editor.renderAdapter.app.view.getBoundingClientRect();
  for (const rec of editor.state.getAllBlocks((r) => r.type === "entity-card")) {
    const x = (Number(rec.attrs.x) + Number(rec.attrs.width)) * t.scale + t.x + rect.left;
    const y = (Number(rec.attrs.y) + Number(rec.attrs.height) / 2) * t.scale + t.y + rect.top;
    if (x > 500 && x < 1550 && y > 100 && y < 860) return { id: rec.id, hx: x, hy: y };
  }
  return null;
});
if (!card) {
  console.log("no in-canvas card handle; abort"); 
  await browser.close(); process.exit(0);
}
await page.mouse.click(card.hx - 30, card.hy); // 选中
await page.waitForTimeout(400);
// + 手柄在卡片右缘中点（+ 图标）
await page.mouse.move(card.hx, card.hy, { steps: 3 });
await page.waitForTimeout(200);
await page.mouse.down();
const target = await page.evaluate(({ id }) => {
  const { editor } = window.__worldCanvasDebug;
  const t = editor.renderAdapter.transform;
  const rect = editor.renderAdapter.app.view.getBoundingClientRect();
  for (const rec of editor.state.getAllBlocks((r) => r.type === "entity-card" && `entity:${(r.attrs.entityId ?? "").length}`)) {
    if (rec.id === id) continue;
    const cx = (Number(rec.attrs.x) + Number(rec.attrs.width) / 2) * t.scale + t.x + rect.left;
    const cy = (Number(rec.attrs.y) + Number(rec.attrs.height) / 2) * t.scale + t.y + rect.top;
    if (cx > 500 && cx < 1550 && cy > 100 && cy < 880) return { cx, cy, id: rec.id };
  }
  return null;
}, { id: card.id });
console.log("target:", JSON.stringify(target));
if (target) {
  await page.mouse.move(target.cx, target.cy, { steps: 20 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/plus-drag.png" });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const dialog = await page.evaluate(() => {
    const { store } = window.__worldCanvasDebug;
    return store.getState().pendingRelation;
  });
  console.log("pendingRelation after drop:", JSON.stringify(dialog));
  // 取消掉，不写入
  if (dialog) await page.evaluate(() => window.__worldCanvasDebug.store.getState().setPendingRelation(null));
}
await page.screenshot({ path: "/tmp/plus-after.png" });
await browser.close();
