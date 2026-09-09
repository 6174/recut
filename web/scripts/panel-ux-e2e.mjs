/* E2E：属性边标签（属性：具体名称）+ 边面板可编辑 + 面板文本体验（统一组件/钳制/放大编辑） */
import { chromium } from "playwright";

const URL = process.env.E2E_URL || "http://app.localhost:3000/worlds/6ab9ebc7ec45066f91c1c5dc";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const fails = [];
const ok = (name, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) fails.push(name);
};
page.on("pageerror", (err) => { console.log("[pageerror]", String(err).slice(0, 300)); fails.push("pageerror"); });

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__worldCanvasDebug), null, { timeout: 30000 });
await page.waitForTimeout(2500);

// 1) 属性边标签 = 属性 · 具体属性名
const labels = await page.evaluate(() => {
  const { editor, store } = window.__worldCanvasDebug;
  const state = store.getState();
  return state.elements
    .filter((e) => e.kind === "arrow" && String(e.props?.attrMedia ?? ""))
    .map((arrow) => {
      const attr = state.elements.find((item) => item.id === String(arrow.props?.toElementId ?? "") && item.kind === "attr");
      const block = editor.state.getBlockById(arrow.id);
      return {
        attrLabel: String(attr?.props?.label ?? "") || String(attr?.name ?? "").replace(/^属性 · /, ""),
        blockLabel: block ? String(block.attrs.label) : "(missing block)",
      };
    });
});
console.log(JSON.stringify(labels));
ok("属性边标签带具体属性名", labels.length > 0 && labels.every((l) => l.blockLabel === `属性 · ${l.attrLabel}` || l.blockLabel === `属性 · ${l.attrLabel || "文本"}` || l.blockLabel === `属性 · ${l.attrLabel || "图片"}` || l.blockLabel.includes(l.attrLabel)), JSON.stringify(labels.map((l) => l.blockLabel)));

// 2) 边面板可编辑：直接选一条属性边 → 面板出现「属性名称」「值」编辑器
const panelShown = await page.evaluate(() => {
  const { store } = window.__worldCanvasDebug;
  const state = store.getState();
  const arrow = state.elements.find((e) => e.kind === "arrow" && String(e.props?.attrMedia ?? ""));
  if (!arrow) return false;
  store.getState().select({ type: "canvas", element: arrow });
  return true;
});
await page.waitForTimeout(600);
const hasLabelEditor = await page.evaluate(() => Boolean(document.querySelector("aside")?.textContent?.includes("属性名称")));
ok("属性边面板出现「属性名称」编辑器", panelShown && hasLabelEditor);

// renameAttrLabel 语义：改属性名 → attr 名/边名/实体 content 同步
const renamed = await page.evaluate(async () => {
  const { store, editor } = window.__worldCanvasDebug;
  const state = store.getState();
  const arrow = state.elements.find((e) => e.kind === "arrow" && String(e.props?.attrMedia ?? ""));
  const attr = state.elements.find((item) => item.id === String(arrow.props?.toElementId ?? ""));
  const before = { attrName: attr.name, arrowName: (editor.state.getBlockById(arrow.id)?.attrs ?? {}).label };
  await state.renameAttrLabel(attr.id, "E2E字段名");
  const after = {
    attrName: store.getState().elements.find((item) => item.id === attr.id)?.name,
    arrowLabel: editor.state.getBlockById(arrow.id)?.attrs.label,
  };
  return { before, after };
});
console.log(JSON.stringify(renamed));
ok("renameAttrLabel 同步 attr 名", renamed.after.attrName === "属性 · E2E字段名", `${renamed.before.attrName} → ${renamed.after.attrName}`);
ok("renameAttrLabel 同步边标签", String(renamed.after.arrowLabel).includes("E2E字段名"), String(renamed.after.arrowLabel));

// 还原 E2E 改动的属性名（不污染真实数据）
await page.evaluate(async () => {
  const { store } = window.__worldCanvasDebug;
  const state = store.getState();
  const attr = state.elements.find((item) => item.kind === "attr" && String(item.props?.label ?? "") === "E2E字段名");
  if (attr) await state.renameAttrLabel(attr.id, "图片");
});

// 3) 面板文本体验：实体标题用 FieldRow（无裸 input）、正文折叠 + 放大编辑
await page.evaluate(() => {
  const { store } = window.__worldCanvasDebug;
  const state = store.getState();
  const target = state.entities.find((e) => String(e.title).includes("深夜城市场景体系")) ?? state.entities[0];
  store.getState().select({ type: "entity", entity: target });
});
await page.waitForTimeout(600);
const ux = await page.evaluate((entityTitle) => {
  const aside = document.querySelector("aside");
  const titleInputCount = [...(aside?.querySelectorAll("input") ?? [])].filter((input) => input.value?.includes(entityTitle)).length;
  const titleFieldRow = [...(aside?.querySelectorAll("button") ?? [])].some((b) => b.textContent?.trim() === entityTitle);
  const clampCount = aside?.querySelectorAll(".line-clamp-4").length ?? 0;
  const expandButtons = [...(aside?.querySelectorAll("button") ?? [])].some((b) => b.textContent === "展开");
  return { titleInputCount, titleFieldRow, clampCount, expandButtons };
}, "深夜城市场景体系");
console.log(JSON.stringify(ux));
ok("标题统一为 FieldRow（无裸 input）", ux.titleFieldRow && ux.titleInputCount === 0);
ok("长文本默认折叠", ux.clampCount > 0, `line-clamp-4 × ${ux.clampCount}`);
ok("展开/收起入口", ux.expandButtons);

// 进入正文编辑态：textarea 限高 + 放大入口
await page.evaluate(() => {
  const aside = document.querySelector("aside");
  // 点「正文」FieldRow 的展示按钮（正文内容含「统一公式」）进入编辑
  const bodyButton = [...(aside?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trimStart().startsWith("#"));
  bodyButton?.click();
});
await page.waitForTimeout(400);
const editing = await page.evaluate(() => {
  const aside = document.querySelector("aside");
  const textareas = [...(aside?.querySelectorAll("textarea") ?? [])];
  return {
    editing: textareas.length > 0,
    maxHeightTextareas: textareas.filter((t) => t.className.includes("max-h-44")).length,
    zoomButtons: [...(aside?.querySelectorAll("button") ?? [])].some((b) => b.getAttribute("title") === "放大编辑"),
  };
});
console.log(JSON.stringify(editing));
ok("编辑态多行限高（max-h-44）", editing.editing && editing.maxHeightTextareas > 0);
ok("放大编辑入口存在", editing.zoomButtons);

// 放大编辑对话框打开
await page.evaluate(() => {
  const aside = document.querySelector("aside");
  const button = [...(aside?.querySelectorAll("button") ?? [])].find((b) => b.getAttribute("title") === "放大编辑");
  button?.click();
});
await page.waitForTimeout(400);
const dialogOpen = await page.evaluate(() => Boolean(document.querySelector("[role='dialog'] textarea")));
ok("放大编辑全屏对话框", dialogOpen);
await page.keyboard.press("Escape");
await browser.close();
if (fails.length) { console.log("FAILED:", fails.join(", ")); process.exit(1); }
console.log("ALL PASS");
