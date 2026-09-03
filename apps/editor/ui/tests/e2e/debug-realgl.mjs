/**
 * 混合模式真机 GPU 验证（对照 swiftshader 的 E2E，需在真实 GPU 上跑）。
 *
 * 背景：blend-composite 管线曾有两个色彩空间 bug，都表现为「混合模式影响整个画面」：
 *   1. LINEAR_TO_SRGB 里 mix(b, a, 1.055) 外推（step 选择器被当标度）→ 全画布线性值被压暗一半
 *      （#888 背景 136 → 99，与文字区域是否重叠无关）。
 *   2. 最终 blit 对 sRGB 纹理 RT（快照/封面 target）双重编码 → 快照整体变亮。
 * 本脚本用 demo（背景 #888 + 红字 Darken）断言：
 *   - normal 基线：背景角落 = 136；
 *   - darken 后：背景角落仍 = 136（混合只作用于元素覆盖区），文字区 = darken(red, #888) = (136, 0, 0)。
 *
 * 用法：vite preview :5184 起服务后 `node tests/e2e/debug-realgl.mjs`
 * （Mac 自动走 ANGLE/Metal；如需 swiftshader 对照见 debug-darken.mjs）。
 */
import { chromium } from "@playwright/test";

const browser = await chromium.launch({
	headless: true,
	args: ["--use-gl=angle", "--use-angle=metal", "--enable-features=CanvasDrawElement"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", (m) => {
	const t = m.text();
	if (/blend|error|context lost|fail/i.test(t)) console.log("[console]", m.type(), t.slice(0, 200));
});

await page.goto("http://localhost:5184/demo.html?test=1&locale=en");
await page.waitForSelector("canvas[data-recut-canvas]", { timeout: 15000 });
await page.evaluate(() => window.__recutTest.pausePlayback());
await page.evaluate(() => window.__recutTest.setProjectBackground("#888888"));
await page.waitForTimeout(600);

const glInfo = await page.evaluate(() => {
	const gl = document.querySelector("canvas[data-recut-canvas]").getContext("webgl2");
	const dbg = gl.getExtension("WEBGL_debug_renderer_info");
	return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "n/a";
});
console.log("GL renderer:", glInfo);

await page.evaluate(() => {
	const t = window.__recutTest;
	t.setElementParam("demo-el-text", "color", "#ff0000");
	t.setElementParam("demo-el-text", "background.enabled", false);
	t.setElementParam("demo-el-text", "transform.positionX", 0);
	t.setElementParam("demo-el-text", "transform.positionY", 100);
	t.setElementParam("demo-el-text", "fontSize", 60);
});
await page.waitForTimeout(400);

/** 采样：左上角 40x40 背景 + 文字区 (960±200, 640±100) 的像素直方图。 */
const sample = () =>
	page.evaluate(() => {
		const source = document.querySelector("canvas[data-recut-canvas]");
		const image = new Image();
		image.src = source.toDataURL("image/png");
		return new Promise((resolve) => {
			image.onload = () => {
				const snap = document.createElement("canvas");
				snap.width = image.width;
				snap.height = image.height;
				const ctx = snap.getContext("2d", { willReadFrequently: true });
				ctx.drawImage(image, 0, 0);
				const w = snap.width;
				const h = snap.height;
				const px = ctx.getImageData(0, 0, w, h).data;
				const at = (x, y) => {
					const o = (y * w + x) * 4;
					return [px[o], px[o + 1], px[o + 2]];
				};
				const topHist = {};
				for (let y = 0; y < 40; y++)
					for (let x = 0; x < 40; x++) {
						const [r, g, b] = at(x, y);
						const k = `${r},${g},${b}`;
						topHist[k] = (topHist[k] || 0) + 1;
					}
				const textHist = {};
				for (let y = 540; y < 740; y += 4)
					for (let x = 760; x < 1160; x += 4) {
						const [r, g, b] = at(x, y);
						const k = `${r},${g},${b}`;
						textHist[k] = (textHist[k] || 0) + 1;
					}
				resolve({
					topMain: Object.entries(topHist).sort((a, b) => b[1] - a[1])[0][0],
					textTop: Object.entries(textHist)
						.sort((a, b) => b[1] - a[1])
						.slice(0, 3)
						.map(([k, v]) => `${k}:${v}`),
				});
			};
		});
	});

let failed = 0;
const check = (label, cond, detail) => {
	console.log(`${cond ? "PASS" : "FAIL"}  ${label}  ${detail}`);
	if (!cond) failed += 1;
};

const normal = await sample();
check(
	"normal：背景 #888 原样显示",
	normal.topMain === "136,136,136",
	`topMain=${normal.topMain}`,
);

await page.evaluate(() => window.__recutTest.selectElement("demo-el-text"));
await page.waitForTimeout(300);
const trigger = page.locator('label:has-text("Blend Mode")').first()
	.locator("..")
	.getByRole("combobox")
	.first();
await trigger.click();
await page.getByRole("option", { name: "Darken", exact: true }).click();
await page.waitForTimeout(1000);

const darken = await sample();
check(
	"darken：背景区域不受影响（历史 bug 是整体 136→99）",
	darken.topMain === "136,136,136",
	`topMain=${darken.topMain}`,
);
check(
	"darken：文字 = darken(#ff0000, #888888) = (136,0,0)",
	darken.textTop.some((e) => e.startsWith("136,0,0")),
	`textTop=${darken.textTop.join(" | ")}`,
);

console.log(failed === 0 ? "== ALL PASS ==" : `== ${failed} FAILED ==`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
