/*
 * e2e：vello-native 瓦片渲染验证（playwright 手写脚本，非 test runner）
 * 用法：node scripts/e2e-vello-tiles.mjs
 * 前置：web dev server 运行于 E2E_BASE（默认 http://localhost:3000），/dev/vello-tiles 可访问
 * 说明：Vitest/标准 Playwright runner 需要独占 webServer:3457；本仓已有 dev server 常驻时改用本脚本。
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

try {
  await page.goto(`${BASE}/dev/vello-tiles?direct=0`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__velloTilesDebug), null, { timeout: 90_000 });
  await page.waitForFunction(() => (window.__velloTilesDebug?.getViewport().width ?? 0) > 0, null, { timeout: 10_000 });
  await page.evaluate(() => window.__velloTilesDebug.pause());
  ok("demo mounted", true);

  // 1) 算法自检
  const selfTests = await page.evaluate(() => window.__velloTilesDebug.selfTest());
  const failed = selfTests.filter((item) => !item.pass);
  ok("算法自检全部通过", failed.length === 0, `${selfTests.length} 项，失败 ${failed.length}${failed.length ? `: ${JSON.stringify(failed)}` : ""}`);

  // 2) 合成：场景规模 + 背景 + 卡片像素
  await page.evaluate(() => window.__velloTilesDebug.settle());
  const counts = await page.evaluate(() => window.__velloTilesDebug.sceneCounts());
  ok("场景规模正确", counts.cards === 48 && counts.arrows > 0, `cards=${counts.cards} arrows=${counts.arrows} chunks=${counts.chunks}`);

  const bg = await page.evaluate(() => window.__velloTilesDebug.samplePixel(5, 5));
  ok("背景为深色（无内容处）", bg[0] + bg[1] + bg[2] < 80, `rgb=${bg.slice(0, 3)}`);

  const card = await page.evaluate(() => {
    const d = window.__velloTilesDebug;
    const first = d.cards()[0];
    return d.sampleWorld(first.x + first.width / 2, first.y + first.height / 2);
  });
  ok("卡片中心有内容", card[0] + card[1] + card[2] > 60, `rgb=${card.slice(0, 3)}`);

  // 3) 平移命中缓存：0 次瓦片光栅
  const afterPan = await page.evaluate(() => {
    const d = window.__velloTilesDebug;
    d.resetTelemetry();
    const v = d.getViewport();
    d.setViewport({ panX: v.panX - 20, panY: v.panY - 10 });
    d.settle();
    return d.telemetry();
  });
  ok("小范围平移不重光栅", afterPan.tilesRenderedTotal === 0, `rendered=${afterPan.tilesRenderedTotal}`);

  // 4) 拖一张卡：只重渲相交瓦片
  const afterMove = await page.evaluate(() => {
    const d = window.__velloTilesDebug;
    d.resetTelemetry();
    d.moveCard("card-0", 260, 0);
    d.settle();
    return d.telemetry();
  });
  ok(
    "拖拽只重渲相交瓦片",
    afterMove.tilesRenderedTotal > 0 && afterMove.tilesRenderedTotal <= 12,
    `rendered=${afterMove.tilesRenderedTotal}`,
  );

  // 5) 跨瓦片无缝：纯色探针在瓦片边界处无缝隙
  const seam = await page.evaluate(() => {
    const d = window.__velloTilesDebug;
    const probe = d.probe();
    d.setViewport({ zoom: 1, panX: 100, panY: 100 - probe.y });
    d.settle();
    const out = [];
    const maxWorldX = Math.min(probe.x + probe.width - 8, 1100);
    const y = probe.y + probe.height / 2;
    const points = 40;
    for (let i = 0; i < points; i++) {
      const x = probe.x + 8 + (i * (maxWorldX - (probe.x + 8))) / (points - 1);
      out.push(d.sampleWorld(x, y));
    }
    return out;
  });
  const badSeams = seam.filter((p) => !(p[1] > 150 && p[0] < 120 && p[2] < 170));
  ok("跨瓦片无接缝", badSeams.length === 0, `采样 ${seam.length} 点，异常 ${badSeams.length}${badSeams.length ? `: ${JSON.stringify(badSeams.slice(0, 3))}` : ""}`);

  // 6) 真实鼠标拖拽接线（复位卡片与视口，保证 card-0 不被遮挡且在屏幕内）
  await page.evaluate(() => {
    const d = window.__velloTilesDebug;
    d.moveCard("card-0", -260, 0);
    d.resetViewport();
  });
  await page.evaluate(() => window.__velloTilesDebug.resume());
  await page.evaluate(() => window.__velloTilesDebug.settle());
  const before = await page.evaluate(() => {
    const d = window.__velloTilesDebug;
    const first = d.cards()[0];
    const v = d.getViewport();
    return { x: first.x, screenX: first.x * v.zoom + v.panX, screenY: first.y * v.zoom + v.panY };
  });
  await page.mouse.move(before.screenX + 40, before.screenY + 40);
  await page.mouse.down();
  await page.mouse.move(before.screenX + 160, before.screenY + 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const afterX = await page.evaluate(() => window.__velloTilesDebug.cards()[0].x);
  const pstats = await page.evaluate(() => window.__velloTilesDebug.pointer());
  ok(
    "真实鼠标拖拽生效",
    Math.abs(afterX - before.x) > 20,
    `dx=${(afterX - before.x).toFixed(1)} start=(${before.screenX.toFixed(0)},${before.screenY.toFixed(0)}) pointer=${JSON.stringify(pstats)}`,
  );

  ok("页面无报错", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
} catch (error) {
  ok("脚本执行完成", false, String(error));
} finally {
  await page.screenshot({ path: "scripts/e2e-vello-tiles.png" }).catch(() => {});
  await browser.close();
}

const failedTotal = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failedTotal}/${results.length} 通过`);
process.exit(failedTotal === 0 ? 0 : 1);
