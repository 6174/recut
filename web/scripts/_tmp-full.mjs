import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9385;
const profile = mkdtempSync(join(tmpdir(), "full-"));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--no-first-run", "--no-default-browser-check", "--window-size=1600,900", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
try {
  for (let i = 0; i < 30; i++) { await sleep(500); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch {} }
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://app.localhost:3000/worlds/ac5009d9fdc748643ebb06fe?renderer=vello`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__worldCanvasDebug), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__worldCanvasDebug.store.getState().entities.length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(5000);
  const out = await page.evaluate(() => {
    const d = window.__worldCanvasDebug;
    const a = d.editor.renderAdapter;
    const tx = d.editor.pluginRegistry.get("CanvasBindsPlugin");
    const view = a.getView();
    // 适配全部实体 + 一点边距
    const st = d.store.getState();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of st.entities) {
      const b = d.editor.state.getBlockById(`entity:${e.id}`);
      if (!b) continue;
      minX = Math.min(minX, b.attrs.x); minY = Math.min(minY, b.attrs.y);
      maxX = Math.max(maxX, b.attrs.x + (b.attrs.width || 264)); maxY = Math.max(maxY, b.attrs.y + (b.attrs.height || 328));
    }
    const pad = 120;
    const zoom = Math.min((view.clientWidth - 2 * pad) / (maxX - minX), (view.clientHeight - 2 * pad) / (maxY - minY), 1.2);
    const t = { x: view.clientWidth / 2 - (minX + maxX) / 2 * zoom, y: view.clientHeight / 2 - (minY + maxY) / 2 * zoom, scale: zoom };
    a.setTransform(t.x, t.y, t.scale);
    a.renderNow();
    const r = view.getBoundingClientRect();
    return { zoom, left: r.left, top: r.top, w: r.width, h: r.height, dpr: a.viewport.dpr, canvasW: view.width, cssW: view.clientWidth };
  });
  console.log("OUT", JSON.stringify(out));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "scripts/_tmp-full-canvas.png", clip: { x: out.left, y: out.top, width: out.w, height: out.h } });
  console.log("saved");
} catch (e) { console.log("ERR", String(e)); }
finally { if (browser) await browser.close().catch(() => {}); chrome.kill(); }
