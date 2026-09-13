/*
 * e2e：真实 World Canvas 的 vello-native 变体（?renderer=vello）
 * 用法：node scripts/e2e-world-canvas-vello.mjs
 * 前置：web dev server 于 app.localhost:3000，service 于 17373；用系统 Chrome(WebGPU) 经 CDP 驱动。
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WORLD = process.env.WORLD_ID || "ac5009d9fdc748643ebb06fe";
const URL = `http://app.localhost:3000/worlds/${WORLD}?renderer=vello`;
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9370);

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

if (!existsSync(CHROME)) {
  console.log(`SKIP  chrome not found at ${CHROME}`);
  process.exit(0);
}

const profile = mkdtempSync(join(tmpdir(), "world-vello-"));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  ...(process.env.VELLO_HEADLESS ? ["--headless=new"] : []),
  "--enable-unsafe-webgpu",
  "--ignore-gpu-blocklist",
  "--no-first-run",
  "--no-default-browser-check",
  "--window-size=1600,900",
  "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sampleRegion(page, clip) {
  const rect = { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.max(1, Math.round(clip.width)), height: Math.max(1, Math.round(clip.height)) };
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
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    return { width: img.width, height: img.height, data: Array.from(data) };
  }, { b64 });
}

let browser;
try {
  let connected = false;
  for (let attempt = 0; attempt < 30 && !connected; attempt++) {
    await sleep(500);
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
      connected = true;
    } catch {
      /* retry */
    }
  }
  if (!connected || !browser) throw new Error("failed to connect to Chrome over CDP");
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__worldCanvasDebug), null, { timeout: 120_000 });
  const renderer = await page.evaluate(() => window.__worldCanvasDebug.renderer);
  ok("renderer=vello 生效", renderer === "vello", `renderer=${renderer}`);

  await page.waitForFunction(() => window.__worldCanvasDebug.store.getState().entities.length > 0, null, { timeout: 60_000 });
  const entities = await page.evaluate(() => window.__worldCanvasDebug.store.getState().entities.length);
  ok("世界数据加载", entities > 0, `entities=${entities}`);

  await page.waitForTimeout(3000);
  const viewport = await page.evaluate(() => window.__worldCanvasDebug.editor.renderAdapter.viewport);
  ok("画布尺寸有效", (viewport?.width ?? 0) > 100, `width=${viewport?.width}`);
  await page.waitForTimeout(4000);
  // 内容像素：采样画布中部区域，统计非背景像素
  const region = await sampleRegion(page, { x: 500, y: 120, width: 700, height: 600 });
  let content = 0;
  for (let i = 0; i < region.data.length; i += 4) {
    const r = region.data[i], g = region.data[i + 1], b = region.data[i + 2];
    if (!(r < 24 && g < 28 && b < 40)) content++;
  }
  ok("vello 渲染出内容（图+文）", content > 20000, `非背景像素=${content}`);

  const layers = await page.evaluate(() => ({
    grid: Boolean(document.querySelector('[data-grid-layer="true"]')),
    overlay: Boolean(document.querySelector('[data-overlay-root="true"]')),
  }));
  ok("独立网格图层存在", layers.grid === true, `grid=${layers.grid}`);
  ok("DOM/SVG overlay 存在", layers.overlay === true, `overlay=${layers.overlay}`);

  ok("页面无报错", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  await page.screenshot({ path: "scripts/e2e-world-canvas-vello.png" }).catch(() => {});
} catch (error) {
  ok("脚本执行完成", false, String(error));
} finally {
  if (browser) await browser.close().catch(() => {});
  chrome.kill();
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed === 0 ? 0 : 1);
