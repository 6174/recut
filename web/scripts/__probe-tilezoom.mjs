import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WORLD = process.env.WORLD_ID || "ac5009d9fdc748643ebb06fe";
const APP_BASE = process.env.APP_BASE || "http://app.localhost:3000";
const URL = `${APP_BASE}/worlds/${WORLD}?renderer=vello`;
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9399);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(CHROME)) { console.log("no chrome"); process.exit(0); }
const profile = mkdtempSync(join(tmpdir(), "probe-tilezoom-"));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--no-first-run", "--no-default-browser-check",
  "--window-size=1600,900", "about:blank",
], { stdio: "ignore" });

let browser;
try {
  let connected = false;
  for (let i = 0; i < 40 && !connected; i++) { await sleep(500); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); connected = true; } catch {} }
  if (!browser) throw new Error("cdp fail");
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__worldCanvasDebug), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__worldCanvasDebug.store.getState().entities.length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(8000);

  await page.evaluate(() => {
    const { editor } = window.__worldCanvasDebug;
    const ctrl = editor.renderAdapter.controller;
    window.__z = { frames: [] };
    const o = ctrl.renderFrame.bind(ctrl);
    ctrl.renderFrame = (input) => { const t = performance.now(); const r = o(input); window.__z.frames.push({ ms: performance.now() - t, nav: input.navigationActive, rendered: r.rendered, presented: r.presented }); return r; };
  });

  const pt = await page.evaluate(() => { const r = window.__worldCanvasDebug.editor.renderAdapter.getView().getBoundingClientRect(); return { x: r.left + 700, y: r.top + 400 }; });
  await page.mouse.move(pt.x, pt.y);

  const doWheel = async (deltaY, n, delay) => { for (let i = 0; i < n; i++) { await page.keyboard.down("Control"); await page.mouse.wheel(0, deltaY); await page.keyboard.up("Control"); await page.waitForTimeout(delay); } };
  const snap = (tag) => page.evaluate((t) => { const f = window.__z.frames.splice(0); const nav = f.filter((x) => x.nav); const x = nav.map((e) => e.ms).sort((a, b) => a - b); return { tag: t, navFrames: nav.length, p50: x[Math.floor(x.length/2)]?.toFixed(2), p95: x[Math.floor(x.length*0.95)]?.toFixed(2), max: x[x.length-1]?.toFixed(2), rendered: nav.reduce((s, e) => s + e.rendered, 0) }; }, tag);

  await doWheel(-100, 20, 10);
  const zin = await snap("zoomIn");
  await page.waitForTimeout(900);
  await page.screenshot({ path: "/tmp/tile-zoom-in.png" }).catch(() => {});
  const scaleIn = await page.evaluate(() => window.__worldCanvasDebug.editor.renderAdapter.transform.scale);

  await doWheel(100, 30, 10);
  const zout = await snap("zoomOut");
  await page.waitForTimeout(900);
  await page.screenshot({ path: "/tmp/tile-zoom-out.png" }).catch(() => {});
  const scaleOut = await page.evaluate(() => window.__worldCanvasDebug.editor.renderAdapter.transform.scale);

  const cache = await page.evaluate(() => window.__worldCanvasDebug.editor.renderAdapter.controller.debugState());
  console.log(JSON.stringify({ zin, scaleIn, zout, scaleOut, cache, pageErrors }, null, 2));
} catch (e) { console.log("ERR", e); }
finally { if (browser) await browser.close().catch(() => {}); chrome.kill(); }
