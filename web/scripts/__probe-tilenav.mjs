import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WORLD = process.env.WORLD_ID || "ac5009d9fdc748643ebb06fe";
const APP_BASE = process.env.APP_BASE || "http://app.localhost:3000";
const URL = `${APP_BASE}/worlds/${WORLD}?renderer=vello`;
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP_PORT || 9397);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(CHROME)) { console.log("no chrome"); process.exit(0); }
const profile = mkdtempSync(join(tmpdir(), "probe-tilenav-"));
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
    window.__nav = { frames: [], presented: [], rendered: [], covered: [] };
    const o = ctrl.renderFrame.bind(ctrl);
    ctrl.renderFrame = (input) => { const t = performance.now(); const r = o(input); window.__nav.frames.push({ ms: performance.now() - t, nav: input.navigationActive, presented: r.presented, rendered: r.rendered, covered: r.covered }); return r; };
  });

  const pt = await page.evaluate(() => { const r = window.__worldCanvasDebug.editor.renderAdapter.getView().getBoundingClientRect(); return { x: r.left + 700, y: r.top + 400 }; });
  const mk = (tag) => page.evaluate((t) => ({ tag: t, data: window.__nav.frames.splice(0) }), tag);

  await page.mouse.move(pt.x, pt.y);
  for (let i = 0; i < 50; i++) { await page.mouse.wheel(0, 35); await page.waitForTimeout(8); }
  const pan = await mk("pan");
  await page.waitForTimeout(900);
  const panSettle = await mk("panSettle");
  for (let i = 0; i < 50; i++) { await page.mouse.wheel(0, -30); await page.waitForTimeout(8); }
  const panBack = await mk("panBack");
  await page.screenshot({ path: "/tmp/tile-nav.png" }).catch(() => {});

  const summarize = (f) => {
    const nav = f.data.filter((x) => x.nav);
    const idle = f.data.filter((x) => !x.nav);
    const st = (a) => { const x = a.map((e) => e.ms).sort((p, q) => p - q); return { n: x.length, p50: x[Math.floor(x.length/2)]?.toFixed(2), p95: x[Math.floor(x.length*0.95)]?.toFixed(2), max: x[x.length-1]?.toFixed(2) }; };
    return { tag: f.tag, navFrames: nav.length, idleFrames: idle.length, navMs: st(nav), idleMs: st(idle), navRendered: nav.reduce((s, e) => s + e.rendered, 0), navPresented: nav.reduce((s, e) => s + e.presented, 0), navCovered: nav.filter((e) => e.covered).length };
  };
  console.log(JSON.stringify({ pan: summarize(pan), panSettle: summarize(panSettle), panBack: summarize(panBack), pageErrors }, null, 2));
} catch (e) { console.log("ERR", e); }
finally { if (browser) await browser.close().catch(() => {}); chrome.kill(); }
