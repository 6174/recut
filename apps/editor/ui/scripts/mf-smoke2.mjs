import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`);
});

// 1) gallery thumbnails render (WebGPU offscreen)
await page.goto("http://localhost:5193/metalforge.html", { waitUntil: "networkidle" });
await page.waitForTimeout(6000);
const thumbCount = await page.locator("section a img").count();
console.log("gallery thumbnails rendered:", thumbCount, "/ 64");

// 2) abyss (meshgradient) detail: canvas + filter swatch chips
await page.locator('a[href$="effect/abyss"]').click();
await page.waitForSelector("canvas", { timeout: 10000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/mf-abyss-detail.png", clip: { x: 0, y: 0, width: 1400, height: 900 } });
const chipImgs = await page.locator('aside button img').count();
console.log("filter chips rendered:", chipImgs, "/ 15");

// switch filter to blocks via chip click
const blocksChip = page.locator('aside button[title="Blocks"]');
if (await blocksChip.count()) {
  await blocksChip.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "/tmp/mf-abyss-blocks.png", clip: { x: 0, y: 0, width: 1400, height: 900 } });
  console.log("blocks filter applied");
}

// 3) particle-field detail
await page.goto("http://localhost:5193/metalforge.html#/effect/particle-field", { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 10000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/mf-particle.png", clip: { x: 0, y: 0, width: 1400, height: 900 } });
console.log("particle-field preview attempted");

// 4) unsupported kind shows fallback (cloth)
await page.goto("http://localhost:5193/metalforge.html#/effect/cloth", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const fallback = await page.locator("main div[style]").first().count();
console.log("cloth fallback block present:", fallback > 0);

console.log("errors:", errors.length ? errors.slice(0, 8) : "none");
await browser.close();
