/* 临时探针：看世界画布页在 headless 下的实际状态（用完即删） */
import { chromium } from "playwright";

const URL = process.env.E2E_URL || "http://app.localhost:3000/worlds/6ab9ebc7ec45066f91c1c5dc";
const SHOTS = process.env.COMMANDCODE_SCRATCHPAD || ".";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on("console", (message) => logs.push(`${message.type()}: ${message.text()}`.slice(0, 200)));
page.on("pageerror", (error) => logs.push(`pageerror: ${String(error)}`.slice(0, 300)));
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(20000);
const info = await page.evaluate(() => ({
  url: location.href,
  hasDebug: Boolean(window.__worldCanvasDebug),
  hasGpu: Boolean(navigator.gpu),
  text: document.body.innerText.replace(/\s+/g, " ").slice(0, 700),
  canvases: document.querySelectorAll("canvas").length,
}));
console.log(JSON.stringify(info, null, 1));
console.log("--- console ---");
console.log(logs.slice(-25).join("\n"));
await page.screenshot({ path: `${SHOTS}/probe.png`, fullPage: false });
await browser.close();
