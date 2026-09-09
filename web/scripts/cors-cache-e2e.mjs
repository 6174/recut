import { chromium } from "playwright";
const URL = process.env.E2E_URL || "http://app.localhost:3000/worlds/6ab9ebc7ec45066f91c1c5dc";
const COVER = "http://app.localhost:17373/v1/media/assets/a955a5bcd7e774377f507a49/content";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__worldCanvasDebug), null, { timeout: 30000 });
await page.waitForTimeout(1500);
// 1) 面板行为：裸 <img> 无 crossorigin 预载（污染 HTTP 缓存条目）
const polluted = await page.evaluate((src) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve("loaded");
  img.onerror = () => resolve("error");
  img.src = src;
}), COVER);
console.log("plain img preload:", polluted);
// 2) 画布行为：同 URL + crossOrigin=anonymous（未加隔离 query 的旧路径在 Chromium 会失败）
const canvasStyle = await page.evaluate((src) => new Promise((resolve) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => resolve("ok");
  img.onerror = (event) => resolve("cors-fail");
  img.src = src;
}), COVER);
console.log("crossOrigin same-URL:", canvasStyle);
// 3) 画布实际路径（textureURL 隔离 query）
const isolated = await page.evaluate((src) => new Promise((resolve) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => resolve("ok");
  img.onerror = () => resolve("cors-fail");
  img.src = src.includes("?") ? `${src}&t=pixi` : `${src}?t=pixi`;
}), COVER);
console.log("crossOrigin isolated-query:", isolated);
await browser.close();
if (isolated !== "ok") { console.log("FAIL"); process.exit(1); }
console.log("PASS: 隔离 query 后 crossOrigin 加载稳定成功");
