/*
 * e2e：world-canvas 四类 block 的 vello-native 迁移验证（playwright 手写脚本）
 * 用法：node scripts/e2e-world-vello.mjs
 * 前置：web dev server 运行于 E2E_BASE（默认 http://localhost:3000），/dev/world-vello 可访问。
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

async function samplePixel(x, y) {
  const buffer = await page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } });
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
  await page.goto(`${BASE}/dev/world-vello`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__worldVelloDebug), null, { timeout: 90_000 });
  await page.evaluate(() => window.__worldVelloDebug.renderNow());
  ok("world-vello 适配器挂载", true);

  const state = await page.evaluate(() => window.__worldVelloDebug.debugState());
  ok("光栅器就绪", state.rasterizer === "vello" || state.rasterizer === "canvas2d", `rasterizer=${state.rasterizer}`);
  ok("6 个 block chunk", state.chunks === 6, `chunks=${state.chunks}`);

  const pixel = await page.evaluate(() => {
    const d = window.__worldVelloDebug;
    const rect = d.cardRect("e1");
    const v = d.adapter.viewport;
    return { x: (rect.x + rect.width / 2) * v.zoom + v.panX, y: (rect.y + rect.height / 2) * v.zoom + v.panY };
  });
  const color = await samplePixel(pixel.x, pixel.y);
  ok("实体卡已渲染", color[0] + color[1] + color[2] > 40, `rgb=${color.slice(0, 3)}`);

  const before = await page.evaluate(() => window.__worldVelloDebug.cardRect("e1").x);
  await page.evaluate(() => window.__worldVelloDebug.moveBlock("e1", 80, 0));
  const after = await page.evaluate(() => window.__worldVelloDebug.cardRect("e1").x);
  const afterState = await page.evaluate(() => window.__worldVelloDebug.debugState());
  ok("transact 位移生效", Math.abs(after - before - 80) < 1, `dx=${(after - before).toFixed(1)}`);
  ok("位移后 chunk 数不变", afterState.chunks === 6, `chunks=${afterState.chunks}`);

  // DOM/SVG overlay：选区框 + 4 个手柄
  const overlay = await page.evaluate(() => {
    const d = window.__worldVelloDebug;
    const okSelect = d.select("e1");
    const selection = document.querySelector('[data-overlay-selection="true"]');
    const handles = document.querySelectorAll('[data-overlay-handle="true"]');
    const visible = selection && selection.style.display !== "none";
    return { okSelect, visible, handles: handles.length };
  });
  ok("DOM/SVG overlay 选区可见", overlay.okSelect && overlay.visible, `handles=${overlay.handles}`);
  ok("DOM/SVG overlay 四角手柄", overlay.handles === 4, `handles=${overlay.handles}`);

  const cleared = await page.evaluate(() => {
    window.__worldVelloDebug.clearOverlay();
    const selection = document.querySelector('[data-overlay-selection="true"]');
    return selection ? selection.style.display === "none" : true;
  });
  ok("overlay 可清除", cleared, "");

  ok("页面无报错", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  await page.screenshot({ path: "scripts/e2e-world-vello.png" }).catch(() => {});
} catch (error) {
  ok("脚本执行完成", false, String(error));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed === 0 ? 0 : 1);
