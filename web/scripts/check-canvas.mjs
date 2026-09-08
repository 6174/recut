import { chromium } from "playwright";
const URL = "http://app.localhost:3000/worlds/6ab9ebc7ec45066f91c1c5dc";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("console:", m.text().slice(0, 200)); });
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__worldCanvasDebug), null, { timeout: 30000 });
await page.waitForTimeout(4000);
const info = await page.evaluate(() => {
  const { editor } = window.__worldCanvasDebug;
  const arrows = editor.state.getAllBlocks((r) => r.type === "relation-arrow");
  const blocks = editor.state.getAllBlocks((r) => r.type === "entity-card");
  // 数 pixi 树里可见的 relation-arrow 内容容器
  const content = editor.renderAdapter.mountpointBlock.hostElement.el;
  let arrowContainers = 0;
  for (const b of arrows) {
    const block = editor.renderAdapter.getBlockById(b.id);
    if (block?.contentElement?.el?.parent) arrowContainers++;
  }
  return { arrows: arrows.length, arrowContainers, cards: blocks.length, stageChildren: editor.renderAdapter.app.stage.children.length, contentChildren: content.children.length };
});
console.log("state:", JSON.stringify(info), "errors:", errors.length, errors.slice(0, 3));
await page.screenshot({ path: "/tmp/canvas-check.png" });
await browser.close();
