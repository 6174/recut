import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:3000/projects/c8323fb54bec736787c826fc";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const mediaResponses = [];
page.on("response", async (r) => {
  const u = r.url();
  if (u.includes("/v1/media/assets") && !u.includes("/content")) {
    let n = "";
    try {
      const j = await r.json();
      n = Array.isArray(j) ? `array:${j.length}` : typeof j;
    } catch {}
    mediaResponses.push(`${r.status()} ${u} -> ${n}`);
  }
});
page.on("requestfailed", (r) => {
  if (r.url().includes("/v1/media/assets")) console.log("[reqfail]", r.url(), r.failure()?.errorText);
});
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => console.log("goto err", e.message));
await page.waitForTimeout(5000);
console.log("=== media responses ===");
console.log(mediaResponses.join("\n") || "(none)");

const atBtn = page.locator('button[title]').filter({ hasText: "" });
// open the @ panel via the reference button
const refBtn = page.getByRole("button", { name: /引用|reference/i }).first();
try {
  await refBtn.click({ timeout: 5000 });
} catch (e) {
  console.log("refBtn click failed:", e.message);
}
await page.waitForTimeout(1500);

// click 素材 chip
const chip = page.getByRole("button", { name: "素材", exact: true }).first();
try {
  await chip.click({ timeout: 5000 });
} catch (e) {
  console.log("chip click failed:", e.message);
}
await page.waitForTimeout(1500);

const bodyText = await page.locator(".z-\\[200\\]").first().innerText().catch(() => "(no panel)");
console.log("=== panel text ===\n" + bodyText.slice(0, 1500));

await browser.close();
