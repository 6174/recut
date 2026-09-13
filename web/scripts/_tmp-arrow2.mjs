import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.PORT || 9386);
const profile = mkdtempSync(join(tmpdir(), "arrow2-"));
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
    const view = a.getView();
    const st = d.store.getState();
    const rel = st.relations.find((r) => st.entities.some((e) => e.id === r.fromEntityId) && st.entities.some((e) => e.id === r.toEntityId));
    const rect = (id) => { const b = d.editor.state.getBlockById(`entity:${id}`); return { x: b.attrs.x, y: b.attrs.y, w: b.attrs.width || 264, h: b.attrs.height || 328 }; };
    const rf = rect(rel.fromEntityId), rt = rect(rel.toEntityId);
    const minX = Math.min(rf.x, rt.x), minY = Math.min(rf.y, rt.y);
    const maxX = Math.max(rf.x + rf.w, rt.x + rt.w), maxY = Math.max(rf.y + rf.h, rt.y + rt.h);
    const pad = 60;
    const zoom = Math.min((view.clientWidth) / (maxX - minX + 2 * pad), (view.clientHeight) / (maxY - minY + 2 * pad), 1.5);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    a.setTransform(view.clientWidth / 2 - cx * zoom, view.clientHeight / 2 - cy * zoom, zoom);
    a.renderNow();
    return { zoom, world: { minX, minY, maxX, maxY }, canvasW: view.width, cssW: view.clientWidth, dpr: a.viewport.dpr, devicePixelRatio: window.devicePixelRatio };
  });
  console.log("OUT", JSON.stringify(out));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "scripts/_tmp-arrow2.png" });
  console.log("saved");
} catch (e) { console.log("ERR", String(e)); }
finally { if (browser) await browser.close().catch(() => {}); chrome.kill(); }
