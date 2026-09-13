/*
 * e2e：vello-native GPU 瓦片渲染验证（playwright + 系统 Chrome WebGPU，经 CDP 驱动）
 * 用法：node scripts/e2e-vello-gpu.mjs
 * 前置：web dev server 运行于 E2E_BASE（默认 http://localhost:3000），且 wasm 产物已 sync 到 public/vello-wasm。
 * 说明：Playwright 自带 Chromium 不暴露 navigator.gpu；本脚本启动系统 Chrome(--headless=new --enable-unsafe-webgpu)
 *       并经 connectOverCDP 连接。像素验证用页面截图（浏览器合成器输出）而非 drawImage(WebGPU canvas)。
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9345);

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

if (!existsSync(CHROME)) {
  console.log(`SKIP  chrome not found at ${CHROME}`);
  process.exit(0);
}

const profile = mkdtempSync(join(tmpdir(), "vello-gpu-"));
const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--headless=new",
    "--enable-unsafe-webgpu",
    "--ignore-gpu-blocklist",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 截取 clip 区域并经页面内 2D canvas 解码为 RGBA 数组。 */
async function sampleRegion(page, clip) {
  const rect = {
    x: Math.round(clip.x),
    y: Math.round(clip.y),
    width: Math.max(1, Math.round(clip.width)),
    height: Math.max(1, Math.round(clip.height)),
  };
  const buffer = await page.screenshot({ clip: rect });
  const base64 = buffer.toString("base64");
  return page.evaluate(
    async ({ b64 }) => {
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
    },
    { b64: base64 },
  );
}

function pixelAt(region, x, y) {
  const i = (y * region.width + x) * 4;
  return [region.data[i], region.data[i + 1], region.data[i + 2], region.data[i + 3]];
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
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto(`${BASE}/dev/vello-tiles`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__velloTilesDebug), null, { timeout: 90_000 });
  await page.waitForFunction(() => (window.__velloTilesDebug?.getViewport().width ?? 0) > 0, null, { timeout: 15_000 });
  await page.evaluate(() => window.__velloTilesDebug.pause());

  const rasterizer = await page.evaluate(() => window.__velloTilesDebug.rasterizerName());
  ok("使用 vello GPU 光栅器", rasterizer === "vello", `rasterizer=${rasterizer}`);

  const selfTests = await page.evaluate(() => window.__velloTilesDebug.selfTest());
  const failed = selfTests.filter((item) => !item.pass);
  ok("算法自检全部通过", failed.length === 0, `${selfTests.length} 项，失败 ${failed.length}`);

  await page.evaluate(() => window.__velloTilesDebug.settle());
  const counts = await page.evaluate(() => window.__velloTilesDebug.sceneCounts());
  ok("场景规模正确", counts.cards === 48 && counts.arrows > 0, `cards=${counts.cards} arrows=${counts.arrows} chunks=${counts.chunks}`);

  const bgRegion = await sampleRegion(page, { x: 5, y: 5, width: 1, height: 1 });
  const bg = pixelAt(bgRegion, 0, 0);
  ok("背景为深色（无内容处）", bg[0] + bg[1] + bg[2] < 80, `rgb=${bg.slice(0, 3)}`);

  const cardCss = await page.evaluate(() => {
    const d = window.__velloTilesDebug;
    const c = d.cards()[0];
    const v = d.getViewport();
    return { x: (c.x + c.width / 2) * v.zoom + v.panX, y: (c.y + c.height / 2) * v.zoom + v.panY };
  });
  const cardRegion = await sampleRegion(page, { x: cardCss.x, y: cardCss.y, width: 1, height: 1 });
  const card = pixelAt(cardRegion, 0, 0);
  ok("卡片中心有内容", card[0] + card[1] + card[2] > 40, `rgb=${card.slice(0, 3)}`);

  const afterPan = await page.evaluate(() => {
    const d = window.__velloTilesDebug;
    d.resetTelemetry();
    const v = d.getViewport();
    d.setViewport({ panX: v.panX - 20, panY: v.panY - 10 });
    d.settle();
    return d.telemetry();
  });
  ok("小范围平移不重光栅", afterPan.tilesRenderedTotal === 0, `rendered=${afterPan.tilesRenderedTotal}`);

  const afterMove = await page.evaluate(() => {
    const d = window.__velloTilesDebug;
    d.resetTelemetry();
    d.moveCard("card-0", 260, 0);
    d.settle();
    return d.telemetry();
  });
  ok("拖拽只重渲相交瓦片", afterMove.tilesRenderedTotal > 0 && afterMove.tilesRenderedTotal <= 12, `rendered=${afterMove.tilesRenderedTotal}`);

  // 接缝：把探针移到屏幕内，截取一条水平线，逐像素断言为绿色（无深色缝隙）
  const strip = await page.evaluate(() => {
    const d = window.__velloTilesDebug;
    const p = d.probe();
    d.setViewport({ zoom: 1, panX: 100, panY: 100 - p.y });
    d.settle();
    const v = d.getViewport();
    return { x: 100, y: p.y * v.zoom + v.panY + (p.height / 2) * v.zoom, width: 1000, height: 1 };
  });
  const row = await sampleRegion(page, strip);
  let badSeams = 0;
  const seamSamples = [];
  for (let x = 0; x < row.width; x++) {
    const [r, g, b] = pixelAt(row, x, 0);
    if (!(g > 150 && r < 120 && b < 170)) {
      badSeams++;
      if (seamSamples.length < 3) seamSamples.push({ x, rgb: [r, g, b] });
    }
  }
  ok("跨瓦片无接缝", badSeams === 0, `采样 ${row.width} 点，异常 ${badSeams}${badSeams ? `: ${JSON.stringify(seamSamples)}` : ""}`);

  const fontRegistered = await page.evaluate(() => window.__velloTilesDebug.fontRegistered());
  ok("字体已注册", fontRegistered === true, `fontRegistered=${fontRegistered}`);

  // 文本：把 text probe 移入视图，扫描亮度断言有字形像素
  const textRegion = await page.evaluate(() => {
    const d = window.__velloTilesDebug;
    d.setViewport({ zoom: 1, panX: 100, panY: 100 - 4200 });
    d.settle();
    const v = d.getViewport();
    return { x: 100, y: (4200 + 60) * v.zoom + v.panY, width: 900, height: 200 };
  });
  const textRow = await sampleRegion(page, textRegion);
  let brightPixels = 0;
  for (let i = 0; i < textRow.data.length; i += 4) {
    if (textRow.data[i] > 180 && textRow.data[i + 1] > 180 && textRow.data[i + 2] > 180) brightPixels++;
  }
  ok("文本渲染（GPU 字形）", brightPixels > 50, `亮点像素=${brightPixels}`);

  ok("页面无报错", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

  await page.screenshot({ path: "scripts/e2e-vello-gpu.png" }).catch(() => {});
} catch (error) {
  ok("脚本执行完成", false, String(error));
} finally {
  if (browser) await browser.close().catch(() => {});
  chrome.kill();
}

const failedTotal = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failedTotal}/${results.length} 通过`);
process.exit(failedTotal === 0 ? 0 : 1);
