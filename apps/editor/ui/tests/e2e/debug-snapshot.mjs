import { chromium } from "@playwright/test";
const args = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--enable-features=CanvasDrawElement"];
async function launchEditorBrowser() {
	return chromium.launch({ headless: true, args });
}

const browser = await launchEditorBrowser();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", (msg) => {
	const t = msg.text();
	if (t.includes("error") || t.includes("Error") || t.includes("warn") || t.includes("blend") || t.includes("snapshot") || t.includes("Snapshot")) {
		console.log("[console]", msg.type(), t.slice(0, 200));
	}
});
await page.goto("http://localhost:5184/demo.html?test=1&locale=en");
await page.waitForSelector("canvas[data-recut-canvas]", { timeout: 15000 });
await page.evaluate(() =>
	window.__recutTest.setTime(0),
);
await page.evaluate(() => window.__recutTest.pausePlayback());
await page.evaluate(() => window.__recutTest.setProjectBackground("#9944dd"));
await page.waitForTimeout(500);

console.log("--- baseline frame mean (normal):");
const t0 = Date.now();
try {
	const baseline = await page.evaluate(
		() => window.__recutTest.renderFrameMean(0, 300, 120, 300, 200, 100),
		{ timeout: 60000 },
	);
	console.log("baseline:", baseline, "took", Date.now() - t0, "ms");
} catch (e) {
	console.log("BASELINE HUNG:", String(e).slice(0, 120));
}

// now set multiply via panel-free bridge
await page.evaluate(() => window.__recutTest.setElementParam("demo-el-image", "blendMode", "multiply"));
await page.waitForTimeout(800);
console.log("--- multiply frame mean:");
const t1 = Date.now();
try {
	const multiplied = await page.evaluate(
		() => window.__recutTest.renderFrameMean(0, 300, 120, 300, 200, 100),
		{ timeout: 60000 },
	);
	console.log("multiplied:", multiplied, "took", Date.now() - t1, "ms");
} catch (e) {
	console.log("MULTIPLY HUNG:", String(e).slice(0, 120));
}

await browser.close();
