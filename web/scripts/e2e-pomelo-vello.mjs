/*
 * e2e：VelloRendererAdapter 接入 pomelo-core 的验证（playwright 手写脚本）
 * 用法：node scripts/e2e-pomelo-vello.mjs
 * 前置：web dev server 运行于 E2E_BASE（默认 http://localhost:3000），/dev/pomelo-vello 可访问。
 */
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch(process.env.PERF_HEADED ? { headless: false } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on("pageerror", (err) => pageErrors.push(String(err)));

async function sampleRegion(clip) {
  const rect = { x: Math.round(clip.x), y: Math.round(clip.y), width: 1, height: 1 };
  const buffer = await page.screenshot({ clip: rect });
  const b64 = buffer.toString("base64");
  return page.evaluate(async ({ b64 }) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }, { b64 });
}

try {
  await page.goto(`${BASE}/dev/pomelo-vello`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__pomeloVelloDebug), null, { timeout: 90_000 });
  await page.waitForFunction(() => window.__pomeloVelloDebug?.cards().length === 3, null, { timeout: 15_000 });
  await page.evaluate(() => window.__pomeloVelloDebug.renderNow());
  ok("适配器挂载 + 3 个 block", true);

  const state = await page.evaluate(() => window.__pomeloVelloDebug.debugState());
  ok("光栅器就绪", state.rasterizer === "vello", `rasterizer=${state.rasterizer}`);
  ok("chunk 数正确", state.chunks === 3, `chunks=${state.chunks}`);

  const pixel = await page.evaluate(() => {
    const d = window.__pomeloVelloDebug;
    const card = d.cards()[0];
    const v = d.adapter.viewport;
    return { x: (card.x + card.width / 2) * v.zoom + v.panX, y: (card.y + card.height / 2) * v.zoom + v.panY };
  });
  const color = await sampleRegion(pixel);
  ok("block 已渲染（卡片中心有内容）", color[0] + color[1] + color[2] > 40, `rgb=${color.slice(0, 3)}`);

  const beforeX = await page.evaluate(() => window.__pomeloVelloDebug.cards()[0].x);
  await page.evaluate(() => window.__pomeloVelloDebug.moveBlock("card-1", 120, 0));
  const afterX = await page.evaluate(() => window.__pomeloVelloDebug.cards()[0].x);
  const afterState = await page.evaluate(() => window.__pomeloVelloDebug.debugState());
  ok("transact 位移生效", Math.abs(afterX - beforeX - 120) < 1, `dx=${(afterX - beforeX).toFixed(1)}`);
  ok("位移后 chunk 数不变", afterState.chunks === 3, `chunks=${afterState.chunks}`);

  ok("页面无报错", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  await page.screenshot({ path: "scripts/e2e-pomelo-vello.png" }).catch(() => {});
} catch (error) {
  ok("脚本执行完成", false, String(error));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed === 0 ? 0 : 1);
