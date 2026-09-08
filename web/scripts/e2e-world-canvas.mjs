/* e2e：world canvas 功能与拖拽性能验证（playwright 手写脚本，非 test runner）
 * 用法：node scripts/e2e-world-canvas.mjs
 * 前置：web dev server 运行于 http://app.localhost:3000，本地 service 于 17373
 */
import { chromium } from "playwright";

const URL = process.env.E2E_URL || "http://app.localhost:3000/worlds/ac5009d9fdc748643ebb06fe";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch(process.env.PERF_HEADED ? { headless: false } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const network = { assetContent: 0, assetFailed: 0 };
page.on("response", (res) => {
  if (/\/v1\/media\/assets\/[0-9a-f]+\/content/.test(res.url())) {
    if (res.ok()) network.assetContent += 1;
    else network.assetFailed += 1;
  }
});
const pageErrors = [];
page.on("pageerror", (err) => pageErrors.push(String(err)));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__worldCanvasDebug), null, { timeout: 30000 });
ok("canvas mounted", true);

// 幂等布局：把实体卡摆到固定网格再 fit（脚本是持续投放测试拖拽的，不重置会单向漂移出窗口）
await page.evaluate(() => {
  const { store } = window.__worldCanvasDebug;
  const state = store.getState();
  state.entities.forEach((entity, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    state.moveElement(`shape:${entity.id}`, 240 + col * 320, 240 + row * 220);
  });
});
await page.waitForTimeout(500);

// 视口 fit：把全部内容缩放居中（历次运行会拖动卡位漂移）
await page.evaluate(() => {
  const { editor, store } = window.__worldCanvasDebug;
  const adapter = editor.renderAdapter;
  const view = adapter.app.view;
  const rect = view.getBoundingClientRect();
  // bounds 只按刚网格化的实体卡算（漂移过的箭头/notes 不能决定 fit）
  const blocks = editor.state.getAllBlocks((r) => r.type === "entity-card");
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const rec of blocks) {
    const x = Number(rec.attrs.x) || 0, y = Number(rec.attrs.y) || 0;
    const w = Number(rec.attrs.width) || 200, h = Number(rec.attrs.height) || 110;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
  }
  // 内容区从画布可见区（避开左侧 Chat 400px 与顶栏 90px）中间开始
  const viewX = 400 + 40, viewY = 90 + 40, viewW = 1600 - 400 - 380 - 80, viewH = 900 - 90 - 80;
  const scale = Math.max(0.3, Math.min(1, Math.min(viewW / (maxX - minX + 80), viewH / (maxY - minY + 80))));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const tx = viewX + viewW / 2 - cx * scale;
  const ty = viewY + viewH / 2 - cy * scale;
  adapter.setTransform(tx, ty, scale);
});

const info = await page.evaluate(() => {
  const { editor, store } = window.__worldCanvasDebug;
  const state = store.getState();
  return {
    worldName: state.worldName,
    readOnly: state.readOnly,
    entities: state.entities.length,
    entityImages: state.entities.map((e) => (e.references ?? []).filter((r) => r.modality === "image").length),
  };
});
ok("store loaded", info.entities > 0, `entities=${info.entities} world=${info.worldName}`);
ok("not readOnly", info.readOnly === false, `readOnly=${info.readOnly}`);

// 页面内求某 block 的屏幕矩形（实时 transform）
const screenRectOf = (blockId) => page.evaluate((id) => {
  const { editor } = window.__worldCanvasDebug;
  const rec = editor.state.getBlockById(id);
  if (!rec) return null;
  const t = editor.renderAdapter.transform;
  const x = (Number(rec.attrs.x) || 0) * t.scale + t.x;
  const y = (Number(rec.attrs.y) || 0) * t.scale + t.y;
  return {
    x, y,
    w: (Number(rec.attrs.width) || 0) * t.scale,
    h: (Number(rec.attrs.height) || 0) * t.scale,
  };
}, blockId);

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const centerIn = (rect, vw = 1600, vh = 900) => ({ x: clamp(rect.x + rect.w / 2, 10, vw - 10), y: clamp(rect.y + rect.h / 2, 10, vh - 10) });

// 选一张视口内可见（避开左侧 Chat 面板与顶部工具栏）的实体卡
const pickVisibleCard = () => page.evaluate(() => {
  const { editor } = window.__worldCanvasDebug;
  const t = editor.renderAdapter.transform;
  const view = editor.renderAdapter.app.view.getBoundingClientRect();
  const toScreen = (rec) => ({
    x: (Number(rec.attrs.x) || 0) * t.scale + t.x + view.left,
    y: (Number(rec.attrs.y) || 0) * t.scale + t.y + view.top,
    w: (Number(rec.attrs.width) || 0) * t.scale,
    h: (Number(rec.attrs.height) || 0) * t.scale,
  });
  const visible = [];
  for (const rec of editor.state.getAllBlocks((r) => r.type === "entity-card")) {
    const s = toScreen(rec);
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    if (cx > 430 && cx < 1260 && cy > 100 && cy < 880) visible.push({ id: rec.id, cx, cy, right: s.x + s.w, rightY: s.y + s.h / 2, coverUrl: rec.attrs.coverUrl ?? "" });
  }
  // 优先有真图的卡（验证图片渲染），否则任意可见卡
  return visible.find((item) => item.coverUrl) ?? visible[0] ?? null;
});

const card = await pickVisibleCard();
if (!card) {
  const dbg = await page.evaluate(() => {
    const { editor } = window.__worldCanvasDebug;
    const t = editor.renderAdapter.transform;
    const rect = editor.renderAdapter.app.view.getBoundingClientRect();
    return { transform: t, rect: { left: rect.left, top: rect.top }, cards: editor.state.getAllBlocks((r) => r.type === "entity-card").slice(0, 12).map((r) => ({ id: r.id, title: r.attrs.title, cx: Math.round((Number(r.attrs.x) + 132) * t.scale + t.x + rect.left), cy: Math.round((Number(r.attrs.y) + 164) * t.scale + t.y + rect.top) })) };
  });
  console.log("  pick debug:", JSON.stringify(dbg));
}
ok("visible card found", Boolean(card), card ? `${card.id} coverUrl=${card.coverUrl.slice(0, 60)}` : "none");
if (!card) process.exit(1);

// ---- 功能：点击选中 ----
await page.mouse.click(card.cx, card.cy);
await page.waitForTimeout(300);
const sel1 = await page.evaluate(() => window.__worldCanvasDebug.store.getState().selection);
ok("click selects card", sel1?.type === "entity", `selection=${sel1?.type ?? "null"}`);

// ---- 图片功能：asset content 请求 + 纹理 sprite ----
await page.waitForTimeout(3000);
const spriteInfo = await page.evaluate(() => {
  const { editor } = window.__worldCanvasDebug;
  let sprites = 0;
  const walk = (c) => {
    for (const child of c.children) {
      // 真 Sprite：有 texture 且不是 Text（v7 里 Text 继承 Sprite）
      if (child.texture && typeof child.text !== "string") sprites += 1;
      walk(child);
    }
  };
  walk(editor.renderAdapter.app.stage);
  return { sprites };
});
ok("asset content fetched", network.assetContent > 0, `fetched=${network.assetContent} failed=${network.assetFailed}`);
ok("image sprites on stage", spriteInfo.sprites > 0, `sprites=${spriteInfo.sprites}`);

// ---- 拖拽（性能采样由 pomeloPerf 完成）----
const perfReset = await page.evaluate(() => { window.__pomeloPerf.reset(); return true; });

let beforePos = await page.evaluate((id) => {
  const rec = window.__worldCanvasDebug.editor.state.getBlockById(id);
  return { x: Number(rec.attrs.x), y: Number(rec.attrs.y) };
}, card.id);

const dragCardOnce = async () => {
  await page.mouse.move(card.cx, card.cy);
  await page.mouse.down();
  for (let i = 1; i <= 20; i += 1) {
    await page.mouse.move(card.cx + (120 * i) / 20, card.cy + (80 * i) / 20);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
};
await page.evaluate(() => window.__pomeloPerf.reset());
await dragCardOnce();
// 间歇性失败重试：读取位置判断是否生效
{
  const check = await page.evaluate((id) => {
    const rec = window.__worldCanvasDebug.editor.state.getBlockById(id);
    return { x: Number(rec.attrs.x), y: Number(rec.attrs.y) };
  }, card.id);
  if (Math.abs(check.x - beforePos.x) < 30 && Math.abs(check.y - beforePos.y) < 30) {
    console.log("  drag retry...");
    await page.evaluate(() => window.__pomeloPerf.reset());
    beforePos = check;
    await dragCardOnce();
  }
}
const perf = await page.evaluate(() => ({
  summary: window.__pomeloPerf.summary(),
  gaps: window.__pomeloPerf.dump().filter((e) => e.name === "frame.gap").map((e) => Math.round(e.ms)),
  longtasks: window.__pomeloPerf.dump().filter((e) => e.name === "longtask").length,
}));
const dragFps = 1000 / Math.max(16.7, ...[]); // placeholder not used
const gapCount = perf.gaps.length;
const worstGap = perf.gaps.length ? Math.max(...perf.gaps) : 0;
// headless = SwiftShader 软件渲染：快照 RT 分配/上传在 CPU 上是恒定数百 ms，性能口径只在 headed 可信
const worstGapBudget = process.env.PERF_HEADED ? 120 : 1000;
ok("drag smooth (few frame gaps)", perf.longtasks <= 5 && worstGap < worstGapBudget, `gaps=${gapCount} worst=${worstGap}ms (budget ${worstGapBudget}ms) longtasks=${perf.longtasks} transact p95=${perf.summary.transact?.p95 ?? "-"}ms block.update p95=${perf.summary["block.update"]?.p95 ?? "-"}ms`);
console.log("perf summary:", JSON.stringify(perf.summary, null, 1));
// 长任务定位：longtask 与 frame.gap 的时刻 vs 拖拽事件起点
const timeline = await page.evaluate(() => {
  const events = window.__pomeloPerf.dump();
  const long = events.filter((e) => e.name === "longtask" || e.name === "frame.gap");
  const firstDrag = events.find((e) => e.name === "transact");
  return long.map((e) => ({ name: e.name, ms: e.ms, at: e.t, relative: e.t - (firstDrag?.t ?? e.t) }));
});
console.log("gap timeline:", JSON.stringify(timeline));

const afterPos = await page.evaluate((id) => {
  const rec = window.__worldCanvasDebug.editor.state.getBlockById(id);
  return { x: Number(rec.attrs.x), y: Number(rec.attrs.y) };
}, card.id);
const moved = Math.abs(afterPos.x - beforePos.x) > 30 || Math.abs(afterPos.y - beforePos.y) > 30;
ok("drag moves card", moved, `${JSON.stringify(beforePos)} → ${JSON.stringify(afterPos)}`);

// ---- 功能：「+」手柄拖出 → 关系确认 ----
const plus = await page.evaluate((id) => {
  const { editor } = window.__worldCanvasDebug;
  const rec = editor.state.getBlockById(id);
  if (!rec) return null;
  const t = editor.renderAdapter.transform;
  const rect = editor.renderAdapter.app.view.getBoundingClientRect();
  return {
    x: (Number(rec.attrs.x) + Number(rec.attrs.width)) * t.scale + t.x + rect.left,
    y: (Number(rec.attrs.y) + Number(rec.attrs.height) / 2) * t.scale + t.y + rect.top,
  };
}, card.id);
const second = await page.evaluate(() => {
  const { editor } = window.__worldCanvasDebug;
  const t = editor.renderAdapter.transform;
  for (const rec of editor.state.getAllBlocks((r) => r.type === "entity-card")) {
    if (rec.id === arguments.length ? "" : "") continue;
  }
  return null;
}).catch(() => null);
// 目标：视口内的另一张实体卡中心
const target = await page.evaluate(() => {
  const { editor, store } = window.__worldCanvasDebug;
  const t = editor.renderAdapter.transform;
  const sel = store.getState().selection;
  const selId = sel?.type === "entity" ? `entity:${sel.entity.id}` : "";
  const rect = editor.renderAdapter.app.view.getBoundingClientRect();
  for (const rec of editor.state.getAllBlocks((r) => r.type === "entity-card")) {
    if (rec.id === selId) continue;
    const x = (Number(rec.attrs.x) || 0) * t.scale + t.x + rect.left;
    const y = (Number(rec.attrs.y) || 0) * t.scale + t.y + rect.top;
    const cx = x + (Number(rec.attrs.width) || 0) * t.scale / 2;
    const cy = y + (Number(rec.attrs.height) || 0) * t.scale / 2;
    if (cx > 430 && cx < 1200 && cy > 100 && cy < 860) return { cx, cy };
  }
  return null;
});
const dragPlusOnce = async () => {
  await page.mouse.move(plus.x, plus.y);
  await page.mouse.down();
  for (let i = 1; i <= 40; i += 1) {
    await page.mouse.move(plus.x + ((target.cx - plus.x) * i) / 40, plus.y + ((target.cy - plus.y) * i) / 40);
    await page.waitForTimeout(24);
  }
  // 在目标中心驻留几个小步，确保 hover 命中
  for (const [dx, dy] of [[0, 0], [2, 0], [0, 2], [0, 0]]) {
    await page.mouse.move(target.cx + dx, target.cy + dy);
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
  return page.evaluate(() => window.__worldCanvasDebug.store.getState().pendingRelation);
};
if (plus && target) {
  let pending = await dragPlusOnce();
  if (!pending) {
    // 第一次落空会打开属性菜单面板，Esc 关闭后再重试
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    pending = await dragPlusOnce();
  }
  ok("plus-handle opens relation confirm", Boolean(pending), JSON.stringify(pending ?? {}).slice(0, 120));
  if (pending) {
    const cancel = page.locator("button", { hasText: /取消/ }).last();
    if (await cancel.count()) await cancel.click().catch(() => {});
  }
} else {
  ok("plus-handle opens relation confirm", false, "plus handle or target missing");
}

await page.screenshot({ path: "scripts/e2e-world-canvas.png" });
ok("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | ").slice(0, 200));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
