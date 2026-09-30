/* 临时验证脚本（用完即删）：真实浏览器里验证多选对齐/网格排布 + 撤销。
 * 用法：node scripts/tmp-arrange-verify.mjs
 * 前置：web dev server 于 http://app.localhost:3000、本地 service 于 17373。
 * 结束时用 ⌘Z 撤销回原位，不改动世界的既有布局。 */
import { chromium } from "playwright";

const URL = process.env.E2E_URL || "http://app.localhost:3000/worlds/6ab9ebc7ec45066f91c1c5dc";
const SHOTS = process.env.COMMANDCODE_SCRATCHPAD || ".";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// headless 下要软件 WebGPU（SwiftShader）：否则画布按「不支持 WebGPU」直接拒绝渲染
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=swiftshader", "--use-gl=angle", "--disable-vulkan-surface"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__worldCanvasDebug), null, { timeout: 60000 });
await page.waitForFunction(() => window.__worldCanvasDebug.store.getState().entities.length >= 3, null, { timeout: 30000 });

// 按 block id 读几何：store 元素 x/y 与画布投影（doc）x/y；wEff = 实体卡有效宽度（与 entityCardRect 同规则）
const readRects = (ids) =>
  page.evaluate((blockIds) => {
    const state = window.__worldCanvasDebug.store.getState();
    const editor = window.__worldCanvasDebug.editor;
    return blockIds.map((blockId) => {
      const element = state.elements.find((item) => item.id === blockId.replace(/^entity:/, "shape:"));
      const record = editor.state.getBlockById(blockId);
      const width = Number(element?.geometry?.width);
      return {
        x: Number(element?.geometry?.x),
        y: Number(element?.geometry?.y),
        wEff: Math.max(width || 264, 240),
        docX: Number(record?.attrs.x),
        docY: Number(record?.attrs.y),
      };
    });
  }, ids);

const setup = await page.evaluate(() => {
  const store = window.__worldCanvasDebug.store;
  const state = store.getState();
  const ids = state.entities.slice(0, 3).map((entity) => `entity:${entity.id}`);
  state.selectMany(ids);
  return { ids, readOnly: state.readOnly, changes: state.changeLog.length };
});
const ids = setup.ids;
ok("canvas ready (editable, >=3 cards)", !setup.readOnly, `selected=${ids.length} changes=${setup.changes}`);

const before = await readRects(ids);

// ---- 入口：多选后工具栏出现「对齐」，下拉列出 9 项 ----
const trigger = page.getByLabel(/对齐与排布/);
await trigger.waitFor({ state: "visible", timeout: 15000 });
ok("multi-select reveals toolbar align entry", (await trigger.count()) === 1);

await trigger.click();
const menu = page.getByRole("menuitem");
await menu.first().waitFor({ state: "visible", timeout: 8000 });
const itemCount = await menu.count();
const labels = (await menu.allInnerTexts()).map((text) => text.trim());
await page.screenshot({ path: `${SHOTS}/arrange-menu.png` });
ok("dropdown lists the 9 arrange actions in order", itemCount === 9 && labels.join("|") === "左对齐|水平居中|右对齐|顶对齐|垂直居中|底对齐|水平分布间距|垂直分布间距|网格排布", `items=${itemCount} labels=${labels.join("|")}`);

// ---- 左对齐（走真实菜单点击）----
await page.getByRole("menuitem", { name: "左对齐" }).click();
await page.waitForTimeout(500);
const aligned = await readRects(ids);
const minX = Math.min(...before.map((rect) => rect.x));
const changeCount = await page.evaluate(() => window.__worldCanvasDebug.store.getState().changeLog.length);
await page.screenshot({ path: `${SHOTS}/arrange-left.png` });
ok("left align: every selected x == group min x", aligned.every((rect) => rect.x === minX), `x=${aligned.map((r) => r.x).join(",")} minX=${minX}`);
ok("left align: y untouched", aligned.every((rect, index) => rect.y === before[index].y), `y=${aligned.map((r) => r.y).join(",")}`);
ok("left align: canvas projection rebuilt (doc == store)", aligned.every((rect) => rect.docX === rect.x && rect.docY === rect.y));
ok("one grouped undo entry for the batch", changeCount === setup.changes + 1, `${setup.changes} -> ${changeCount}`);

// ---- 撤销一步回到原位（不改动世界既有布局）----
await page.evaluate(() => window.__worldCanvasDebug.store.getState().undoLastChange());
await page.waitForTimeout(600);
const restored = await readRects(ids);
ok("single undo restores every element", restored.every((rect, index) => rect.x === before[index].x && rect.y === before[index].y), `x=${restored.map((r) => r.x).join(",")}`);

// ---- 网格排布：行内等间隙、锚定左上角 ----
await page.evaluate((blockIds) => window.__worldCanvasDebug.store.getState().arrangeSelection("grid"), ids);
await page.waitForTimeout(500);
const gridded = await readRects(ids);
await page.screenshot({ path: `${SHOTS}/arrange-grid.png` });
const rows = new Map();
gridded.forEach((rect, index) => rows.set(rect.y, [...(rows.get(rect.y) ?? []), index]));
const badGaps = [];
for (const row of rows.values()) {
  const items = row.map((index) => gridded[index]).sort((a, b) => a.x - b.x);
  for (let k = 1; k < items.length; k += 1) {
    const gap = items[k].x - (items[k - 1].x + items[k - 1].wEff);
    if (gap !== 26) badGaps.push(gap);
  }
}
const minBeforeX = Math.min(...before.map((rect) => rect.x));
const minBeforeY = Math.min(...before.map((rect) => rect.y));
ok("grid: every row keeps a constant 26px gap", badGaps.length === 0, `rows=${rows.size} bad=${badGaps.join(",")}`);
ok("grid: anchored at the group's top-left", Math.min(...gridded.map((r) => r.x)) === minBeforeX && Math.min(...gridded.map((r) => r.y)) === minBeforeY, `minX=${Math.min(...gridded.map((r) => r.x))} minY=${Math.min(...gridded.map((r) => r.y))}`);
await page.evaluate(() => window.__worldCanvasDebug.store.getState().undoLastChange());
await page.waitForTimeout(600);
const backAgain = await readRects(ids);
ok("grid undo restores positions too", backAgain.every((rect, index) => rect.x === before[index].x && rect.y === before[index].y));

// ---- 单选时入口不出现 ----
await page.evaluate((blockIds) => window.__worldCanvasDebug.store.getState().selectMany(blockIds.slice(0, 1)), ids);
await page.waitForTimeout(300);
ok("single selection hides the align entry", (await page.getByLabel(/对齐与排布/).count()) === 0);

ok("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | ").slice(0, 200));

await browser.close();
const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
