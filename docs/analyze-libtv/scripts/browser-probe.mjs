#!/usr/bin/env node
/*
 * [INPUT]: 一个 liblib.tv 作品 detail URL（需要本机已装 playwright：web/node_modules）；网络访问 liblib.tv
 * [OUTPUT]: 在输出目录写 detail*.png（详情页截图）、canvas*.png（制作画布截图）、api.json（进入画布后的 XHR/fetch）、
 *   canvas-dom.json（画布 DOM 盘点：react-flow 类名 / 屏上节点 / 视口 transform）、canvas-text.txt
 * [POS]: docs/analyze-libtv 的浏览器侧探查——拿到截图、接口清单与画布 DOM 结构；结构性结论用 analyze-snapshot.mjs
 * [PROTOCOL]: 变更时更新此头部，然后检查 docs/analyze-libtv/README.md
 *
 * 用法:
 *   node docs/analyze-libtv/scripts/browser-probe.mjs <detailUrl> [--out <dir>] [--headed] [--full]
 *     [--click "查看制作过程"] [--viewport 1600x1000] [--focus "62311,43950,0.9"] [--select] [--wait 6000]
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs, extractUuid, outDirFor, loadChromium, UA } from "./lib/env.mjs";

const args = parseArgs();
const input = args.url || args._[0];
if (!input) {
  console.error('用法: node browser-probe.mjs <detailUrl> [--out <dir>] [--click "查看制作过程"] [--focus "x,y,scale"] [--select]');
  process.exit(1);
}

const uuid = extractUuid(input);
const url = /^https?:/.test(input) ? input : `https://www.liblib.tv/detail/${uuid}`;
const out = outDirFor(uuid, args.out);
const full = !!args.full;
const waitMs = Number(args.wait ?? 6000);
const [vw, vh] = String(args.viewport ?? "1600x1000").split("x").map(Number);
const clickText = typeof args.click === "string" ? args.click : "查看制作过程";

console.log(`[probe] url=${url}\n[probe] out=${out}`);

const chromium = await loadChromium();
const browser = await chromium.launch({ headless: !args.headed, args: ["--disable-blink-features=AutomationControlled"] });
const context = await browser.newContext({
  viewport: { width: vw, height: vh },
  userAgent: UA,
  locale: "zh-CN",
});
const page = await context.newPage();

const api = [];
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("requestfailed", (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));
page.on("response", async (res) => {
  const req = res.request();
  const type = req.resourceType();
  if (type !== "xhr" && type !== "fetch") return;
  let body = "";
  try {
    const ct = res.headers()["content-type"] || "";
    if (ct.includes("json")) body = (await res.text()).slice(0, 300000);
  } catch {
    /* ignore */
  }
  api.push({ url: res.url(), method: req.method(), status: res.status(), body });
});

console.log("[probe] 打开详情页…");
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(waitMs);
fs.writeFileSync(path.join(out, "detail-text.txt"), await page.evaluate(() => document.body?.innerText ?? ""));
await page.screenshot({ path: path.join(out, "detail.png"), fullPage: full }).catch(() => {});

// 记录点击前的接口，之后只看"进入画布后"的
api.length = 0;

console.log(`[probe] 点击「${clickText}」进入制作画布…`);
let clicked = false;
try {
  await page.getByText(clickText, { exact: true }).first().click({ timeout: 10000 });
  clicked = true;
} catch {
  const el = page.locator(`[aria-label="${clickText}"], [aria-label="查看创作过程"]`).first();
  clicked = await el.click({ timeout: 8000 }).then(() => true).catch(() => false);
}
await page.waitForTimeout(8000);

fs.writeFileSync(
  path.join(out, "api.json"),
  JSON.stringify(api, null, 2),
);
console.log(`[probe] 捕获到 ${api.length} 条 XHR/fetch（api.json）`);
for (const a of api) console.log(`  ${a.status} ${a.method} ${a.url.slice(0, 130)}`);

// 画布是否挂载
const hasCanvas = await page.locator(".react-flow__viewport").count().catch(() => 0);
console.log(`[probe] react-flow 视口存在: ${hasCanvas > 0}（clicked=${clicked}）`);
await page.screenshot({ path: path.join(out, "canvas.png"), fullPage: full }).catch(() => {});

// 画布 DOM 盘点
const canvasDom = await page.evaluate(() => {
  const classes = {};
  document.querySelectorAll("*").forEach((el) => {
    if (typeof el.className === "string" && el.className) {
      for (const c of el.className.split(/\s+/)) if (/flow|node|edge|viewport|group/i.test(c)) classes[c] = (classes[c] || 0) + 1;
    }
  });
  const nodes = [];
  document.querySelectorAll(".react-flow__node").forEach((el) => {
    const r = el.getBoundingClientRect();
    nodes.push({
      kind: [...el.classList].find((c) => c.startsWith("react-flow__node-")),
      id: el.getAttribute("data-id"),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      text: el.innerText.split("\n").slice(0, 2).join(" | ").slice(0, 60),
    });
  });
  return {
    transform: document.querySelector(".react-flow__viewport")?.style?.transform ?? null,
    classes,
    nodeCount: nodes.length,
    onScreen: nodes.filter((n) => n.rect.x + n.rect.w > 0 && n.rect.x < window.innerWidth && n.rect.y + n.rect.h > 0 && n.rect.y < window.innerHeight && n.rect.w > 10),
  };
});
fs.writeFileSync(path.join(out, "canvas-dom.json"), JSON.stringify(canvasDom, null, 2));
fs.writeFileSync(path.join(out, "canvas-text.txt"), await page.evaluate(() => document.body?.innerText ?? ""));
console.log(`[probe] 画布 DOM：${canvasDom.nodeCount} 个节点，屏上 ${canvasDom.onScreen.length} 个（canvas-dom.json）`);

// 可选：直接把视口定位到某坐标，看节点长什么样
if (typeof args.focus === "string") {
  const [fx, fy, fz] = args.focus.split(",").map(Number);
  await page.evaluate(
    ({ fx, fy, fz }) => {
      const vp = document.querySelector(".react-flow__viewport");
      if (!vp) return;
      const W = window.innerWidth;
      const H = window.innerHeight;
      vp.style.transform = `translate(${W / 2 - fx * fz}px, ${H / 2 - fy * fz}px) scale(${fz})`;
    },
    { fx, fy, fz: fz || 1 },
  );
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, "canvas-focus.png"), fullPage: full }).catch(() => {});
  console.log(`[probe] 已定位到 (${fx},${fy}) @ ${fz}x → canvas-focus.png`);
}

// 可选：点选一个屏上节点，看是否出现检查器/详情
if (args.select) {
  const target = canvasDom.onScreen.find((n) => n.kind && !n.kind.includes("group") && n.rect.w > 40);
  if (target) {
    await page.mouse.click(target.rect.x + target.rect.w / 2, target.rect.y + 10);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(out, "canvas-selected.png"), fullPage: full }).catch(() => {});
    fs.writeFileSync(path.join(out, "canvas-selected-text.txt"), await page.evaluate(() => document.body?.innerText ?? ""));
    console.log(`[probe] 选中 ${target.id} → canvas-selected.png`);
  } else {
    console.log("[probe] 屏上没有可点选的节点，跳过 --select");
  }
}

fs.writeFileSync(path.join(out, "console.log"), logs.join("\n"));
await browser.close();
console.log(`[probe] 完成。产物在 ${out}`);
