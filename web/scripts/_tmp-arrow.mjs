import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.PORT || 9384);
const profile = mkdtempSync(join(tmpdir(), "arrow-"));
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
  const meta = await page.evaluate(() => {
    const d = window.__worldCanvasDebug;
    const a = d.editor.renderAdapter;
    const view = a.getView();
    const v = a.viewport;
    const st = d.store.getState();
    const rel = st.relations.find((r) => st.entities.some((e) => e.id === r.fromEntityId) && st.entities.some((e) => e.id === r.toEntityId));
    const from = st.entities.find((e) => e.id === rel.fromEntityId);
    const to = st.entities.find((e) => e.id === rel.toEntityId);
    const rect = (e) => { const b = d.editor.state.getBlockById(`entity:${e.id}`); return { x: b.attrs.x, y: b.attrs.y, w: b.attrs.width || 264, h: b.attrs.height || 328 }; };
    const rf = rect(from), rt = rect(to);
    const mid = { x: (rf.x + rf.w / 2 + rt.x + rt.w / 2) / 2, y: (rf.y + rf.h / 2 + rt.y + rt.h / 2) / 2 };
    const zoom = 3;
    const t = { x: view.clientWidth / 2 - mid.x * zoom, y: view.clientHeight / 2 - mid.y * zoom, scale: zoom };
    a.setTransform(t.x, t.y, t.scale);
    a.renderNow();
    return { rel: rel.type, from: from.name, to: to.name, canvasW: view.width, cssW: view.clientWidth, dpr: v.dpr, devicePixelRatio: window.devicePixelRatio };
  });
  console.log("META", JSON.stringify(meta));
  await page.waitForTimeout(1500);
  const vr = await page.evaluate(() => { const r = window.__worldCanvasDebug.editor.renderAdapter.getView().getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; });
  await page.screenshot({ path: "scripts/_tmp-arrow-crop.png", clip: { x: vr.left + vr.w / 2 - 200, y: vr.top + vr.h / 2 - 130, width: 400, height: 260 } });
  console.log("saved");
} catch (e) { console.log("ERR", String(e)); }
finally { if (browser) await browser.close().catch(() => {}); chrome.kill(); }
