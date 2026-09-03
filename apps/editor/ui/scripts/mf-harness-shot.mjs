import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--enable-features=CanvasDrawElement"] });
const page = await browser.newPage({ viewport: { width: 800, height: 520 } });
await page.goto("http://localhost:5184/component-harness.html");
await page.waitForFunction(() => window.__recutHarness != null);
await page.evaluate(() => {
  window.__recutHarness.setComponent({
    componentId: "mf.bg.wallpaper",
    name: "MF Wallpaper",
    surface: "r3f",
    inputs: [{ key: "style", default: "abyss" }],
  });
  return window.__recutHarness.render(2.5, 5);
});
await page.waitForTimeout(1200);
const png = await page.evaluate(() => window.__recutHarness.capturePng());
writeFileSync("/tmp/mf-editor-wallpaper.png", Buffer.from(png.split(",")[1], "base64"));
console.log("saved");
await browser.close();
