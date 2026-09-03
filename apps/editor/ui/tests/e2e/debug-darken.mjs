import { chromium } from "@playwright/test";

const args = [
	"--use-gl=swiftshader",
	"--enable-unsafe-swiftshader",
	"--enable-features=CanvasDrawElement",
];
const browser = await chromium.launch({ headless: true, args });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", (m) => {
	const t = m.text();
	if (/blend|snapshot|compos|error/i.test(t)) console.log("[console]", m.type(), t.slice(0, 160));
});

await page.goto("http://localhost:5184/demo.html?test=1&locale=en");
await page.waitForSelector("canvas[data-recut-canvas]", { timeout: 15000 });
await page.evaluate(() => window.__recutTest.pausePlayback());
await page.evaluate(() => window.__recutTest.setTime(0));
await page.evaluate(() => window.__recutTest.setProjectBackground("#888888")); // 中灰，便于观察变暗
await page.waitForTimeout(400);

// 红色文字：去掉胶囊背景，放大，居中
await page.evaluate(() => {
	const t = window.__recutTest;
	t.setElementParam("demo-el-text", "color", "#ff0000");
	t.setElementParam("demo-el-text", "background.enabled", false);
	t.setElementParam("demo-el-text", "transform.positionX", 0);
	t.setElementParam("demo-el-text", "transform.positionY", 100);
	t.setElementParam("demo-el-text", "fontSize", 60);
});
await page.waitForTimeout(600);

const sample = (x, y, w, h) =>
	page.evaluate(
		([sx, sy, sw, sh]) =>
			window.__recutTest.getCanvasRegionMean(sx, sy, sw, sh, 60).then((m) =>
				m ? { r: +m.r.toFixed(1), g: +m.g.toFixed(1), b: +m.b.toFixed(1) } : null,
			),
		[x, y, w, h],
	);

// 画面：1920x1080。角落（远离任何元素）+ 文字区域
const corner = (name, x, y) => sample(x, y, 120, 120).then((m) => console.log(`NORMAL ${name}:`, JSON.stringify(m)));
const textRegion = () => sample(760, 390, 400, 300).then((m) => console.log(`NORMAL textArea:`, JSON.stringify(m)));

console.log("== normal ==");
await Promise.all([corner("topLeft", 40, 40), corner("bottomRight", 1760, 900), textRegion()]);

// 文字物体的几何/纹理诊断
const diag = await page.evaluate(() => {
	const obj = window.__recutTest.getRenderedNodeObject?.("demo-el-text");
	if (!obj) return "no node object (bridge method missing?)";
	const out = [];
	obj.updateWorldMatrix(true, true);
	const box = new (obj.geometry?.type ? Object.getPrototypeOf(obj).__proto__.constructor : Object)();
	obj.traverse((n) => {
		const g = n.geometry;
		const mat = n.material;
		if (!g || !mat) return;
		let geoSize = null;
		try {
			if (!g.boundingBox) g.computeBoundingBox();
			geoSize = { w: g.boundingBox.max.x - g.boundingBox.min.x, h: g.boundingBox.max.y - g.boundingBox.min.y };
		} catch {}
		let texStats = null;
		const img = mat.map?.image;
		if (img && img.getContext) {
			const ctx = img.getContext("2d");
			const px = ctx.getImageData(0, 0, img.width, img.height).data;
			let opaque = 0, semi = 0, total = 0;
			for (let i = 3; i < px.length; i += 4 * 37) {
				total++;
				if (px[i] > 250) opaque++;
				else if (px[i] > 10) semi++;
			}
			texStats = {
				w: img.width, h: img.height,
				opaqueFrac: (opaque / total).toFixed(2), semiFrac: (semi / total).toFixed(2),
				corners: [0, Math.floor(px.length / 4) - 1, Math.floor(px.length / 8), Math.floor(px.length / 4) - Math.floor(5120 / 4) - 1].map((i) => px.slice(i * 4, i * 4 + 4)),
			};
		}
		out.push({ type: n.type, geoSize, tex: mat.map ? { uuid: mat.map.uuid, colorSpace: mat.map.colorSpace, ...texStats } : null });
	});
	return out;
});
console.log("== text object diag ==");
console.log(JSON.stringify(diag, null, 1));

// 选文字 + 变暗
await page.evaluate(() => window.__recutTest.selectElement("demo-el-image")); // 先别选
await page.evaluate(() => window.__recutTest.selectElement("demo-el-text"));
await page.waitForTimeout(300);
// 用面板下拉选 Darken（真实用户路径）
const trigger = page.locator('label:has-text("Blend Mode")').first().locator("..").getByRole("combobox").first();
await trigger.click();
await page.getByRole("option", { name: "Darken", exact: true }).click();
await page.evaluate(() => { window.__recutDebugBlend = true; });
await page.waitForTimeout(900);
console.log("== darken ==");
const dbg = await page.evaluate(() => (window).__recutLastBlendDebug);
console.log("== buffer debug ==");
for (const f of (dbg ?? [])) console.log(JSON.stringify(f));
await Promise.all([corner("topLeft", 40, 40), corner("bottomRight", 1760, 900), textRegion()]);

await browser.close();
