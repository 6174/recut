import { chromium } from "@playwright/test";

const BASE = "http://localhost:5193/metalforge.html";

const browser = await chromium.launch({ headless: false,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

const groups = await page.locator("section h2").allTextContents();
const cards = await page.locator("section a").count();
console.log("groups:", groups.join(", "));
console.log("cards:", cards);

// enter a simple metal effect (starfield) and verify canvas renders non-black pixels
await page.goto(`${BASE}#/effect/starfield`, { waitUntil: "networkidle" });
await page.waitForSelector("canvas", { timeout: 10000 });
await page.waitForTimeout(2500);
const pixelCheck = await page.evaluate(() => {
  const src = document.querySelector("canvas");
  if (!src) return { ok: false, reason: "no canvas" };
  const c2 = document.createElement("canvas");
  c2.width = src.width;
  c2.height = src.height;
  const g = c2.getContext("2d");
  g.drawImage(src, 0, 0);
  const d = g.getImageData(0, 0, c2.width, c2.height).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
  }
  return { ok: lit > 50, lit, total: d.length / 4 };
});
console.log("starfield pixels:", JSON.stringify(pixelCheck));

// param interaction: tweak a slider then check no crash
const slider = page.locator('input[type="range"]').first();
if (await slider.count()) {
  await slider.fill("0.5");
  await page.waitForTimeout(400);
  console.log("slider tweak ok");
}
const paramLabels = await page.locator("aside .text-\\[12px\\]").allTextContents();
console.log("param labels sample:", paramLabels.slice(0, 8).join(" | "));

// code tab loads swift source
await page.goto(`${BASE}#/effect/abyss`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "代码" }).click();
await page.waitForTimeout(1500);
const pre = await page.locator("pre").first().textContent();
console.log("abyss code head:", (pre || "").slice(0, 90).replace(/\n/g, "⏎"));

// orb preview via real click navigation
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.locator('a[href$="orb-magenta"]').click();
await page.waitForSelector("canvas", { timeout: 10000 });
await page.waitForTimeout(2500);
const orbCheck = await page.evaluate(() => {
  const src = document.querySelector("canvas");
  const c2 = document.createElement("canvas");
  c2.width = src.width;
  c2.height = src.height;
  const g = c2.getContext("2d");
  g.drawImage(src, 0, 0);
  const d = g.getImageData(0, 0, c2.width, c2.height).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
  return { lit, total: d.length / 4 };
});
console.log("orb-magenta pixels:", JSON.stringify(orbCheck));

console.log("errors:", errors.length ? errors.slice(0, 10) : "none");
await browser.close();
