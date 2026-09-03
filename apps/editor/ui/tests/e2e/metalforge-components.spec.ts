/**
 * [INPUT]: component-harness 的渲染测试接口与内置 MetalForge 组件注册表
 * [OUTPUT]: mf.bg.wallpaper（WGSL→GLSL 移植案例）的端到端像素与参数断言
 * [POS]: MetalForge 内置组件链路回归：注册 → harness 渲染 → GLSL 输出非空、style preset 生效
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { test, expect } from "@playwright/test";
import { inflateSync } from "node:zlib";

/** zlib (node 内置) + 手解 PNG IDAT：零依赖像素统计。 */
function decodePng(buf: Buffer): { width: number; height: number; data: Buffer } {
	const w = buf.readUInt32BE(16);
	const h = buf.readUInt32BE(20);
	const bitDepth = buf[24];
	if (bitDepth !== 8 || buf[25] !== 6) throw new Error(`unsupported png: depth=${bitDepth} type=${buf[25]}`);
	let idat = Buffer.alloc(0);
	let pos = 8;
	while (pos < buf.length) {
		const len = buf.readUInt32BE(pos);
		const type = buf.toString("ascii", pos + 4, pos + 8);
		if (type === "IDAT") idat = Buffer.concat([idat, buf.subarray(pos + 8, pos + 8 + len)]);
		pos += 12 + len;
	}
	const raw = inflateSync(idat);
	const stride = w * 4 + 1;
	const out = Buffer.alloc(w * h * 4);
	for (let y = 0; y < h; y++) {
		const filter = raw[y * stride];
		const row = raw.subarray(y * stride + 1, (y + 1) * stride);
		const prev = y > 0 ? out.subarray((y - 1) * w * 4, y * w * 4) : Buffer.alloc(w * 4);
		const cur = out.subarray(y * w * 4, (y + 1) * w * 4);
		for (let x = 0; x < w * 4; x++) {
			const a = x >= 4 ? cur[x - 4] : 0;
			const b = prev[x];
			const c = x >= 4 ? prev[x - 4] : 0;
			let val = row[x];
			if (filter === 1) val += a;
			else if (filter === 2) val += b;
			else if (filter === 3) val += (a + b) >> 1;
			else if (filter === 4) {
				const pp = a + b - c;
				const pa = Math.abs(pp - a);
				const pb = Math.abs(pp - b);
				const pc = Math.abs(pp - c);
				val += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			cur[x] = val & 0xff;
		}
	}
	return { width: w, height: h, data: out };
}

async function canvasStats(page: import("@playwright/test").Page): Promise<{ litRatio: number; mean: number }> {
	const dataUrl = await page.evaluate(() => (window as any).__recutHarness.capturePng() as string);
	const base64 = dataUrl.split(",")[1];
	const png = decodePng(Buffer.from(base64, "base64"));
	let lit = 0;
	let sum = 0;
	const total = png.width * png.height;
	for (let i = 0; i < png.data.length; i += 4) {
		const v = (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
		sum += v;
		if (v > 20) lit++;
	}
	return { litRatio: lit / total, mean: sum / total };
}

test.describe("MetalForge builtin components", () => {
	test("mf.bg.wallpaper 渲染非空像素（abyss 预设）", async ({ page }) => {
		await page.goto("/component-harness.html");
		await page.waitForFunction(() => (window as any).__recutHarness != null, { timeout: 15000 });

		const status = await page.evaluate(() => {
			const h = (window as any).__recutHarness;
			h.setComponent({
				componentId: "mf.bg.wallpaper",
				name: "MF Wallpaper 壁纸",
				surface: "r3f",
				inputs: [{ key: "style", default: "abyss" }],
			});
			return h.render(2.5, 5);
		});
		expect(status.status, status.error).toBe("rendered");
		expect(status.surface).toBe("r3f");
		await expect
			.poll(() => page.evaluate(() => (window as any).__recutHarness.hasNodeObject()), { timeout: 5000 })
			.toBe(true);

		const stats = await canvasStats(page);
		console.log("wallpaper abyss pixels:", JSON.stringify(stats));
		// abyss：深蓝底 + bloom 光池。画面必须非空（GLSL 编译失败/NaN 会黑屏或全亮异常）。
		expect(stats.litRatio, JSON.stringify(stats)).toBeGreaterThan(0.3);
		expect(stats.mean, JSON.stringify(stats)).toBeGreaterThan(8);
		expect(stats.mean, "not blown out").toBeLessThan(250);
	});

	test("mf.bg.wallpaper silk 预设渲染（参数响应性）", async ({ page }) => {
		await page.goto("/component-harness.html");
		await page.waitForFunction(() => (window as any).__recutHarness != null, { timeout: 15000 });

		const status = await page.evaluate(() => {
			const h = (window as any).__recutHarness;
			h.setComponent({
				componentId: "mf.bg.wallpaper",
				name: "MF Wallpaper 壁纸",
				surface: "r3f",
				inputs: [{ key: "style", default: "silk" }],
			});
			return h.render(1.5, 5);
		});
		expect(status.status, status.error).toBe("rendered");
		const silk = await canvasStats(page);
		console.log("wallpaper silk pixels:", JSON.stringify(silk));
		// silk 接近深黑背景 + 亮带：非空、非全白即可
		expect(silk.litRatio).toBeGreaterThan(0.02);
		expect(silk.mean).toBeLessThan(250);
	});

	test("编辑器组件库面板可见 mf.bg.wallpaper 并可插入", async ({ page }) => {
		await page.goto("/demo.html?test=1");
		await page.waitForSelector("canvas[data-recut-canvas]", { timeout: 15000 });
		await page.waitForFunction(() => (window as any).__recutTest != null, { timeout: 15000 });

		// mf.bg.wallpaper 是内容型组件（group=bg）→ Components 面板「背景」二级 tab
		await page.evaluate(() => (window as any).__recutTest.setAssetsPanelTab("components"));
		await page.waitForTimeout(600);
		const componentsPanel = await page.locator('[data-recut-panel-assets], [class*="panel"]').first().innerText();
		expect(componentsPanel).toContain("MF Wallpaper");
		expect(componentsPanel).toContain("背景");

		// Effects 面板只含"调整已有内容"的后处理，不再含内容型组件
		await page.evaluate(() => (window as any).__recutTest.setAssetsPanelTab("effects"));
		await page.waitForTimeout(400);
		const effectsPanel = await page.locator('[data-recut-panel-assets], [class*="panel"]').first().innerText();
		expect(effectsPanel).not.toContain("MF Wallpaper");

		// 背景语义：插入 wallpaper 后，上层元素（demo text，白色字+绿条）仍可见——
		// 采样 text 元素实际 bounds 的中心区域，亮度必须显著高于 wallpaper 深蓝角落。
		await page.evaluate(() => window.__recutTest.addComponentElement("mf.bg.wallpaper"));
		await page.waitForTimeout(1800);
		const corner = await page.evaluate(() => window.__recutTest.getCanvasRegionMean(0.02, 0.02, 0.12, 0.12));
		const sampled = await page.evaluate(() => {
			const bounds = (window as any).__recutTest.getNodeBounds("demo-el-text");
			const size = (window as any).__recutTest.getCanvasSize();
			if (!bounds || !size) return null;
			// bounds 为 {cx, cy, width, height}（画布坐标，y 向下）
			return window.__recutTest.getCanvasRegionMean(
				Math.max(0, Math.round(bounds.cx - size.width * 0.1)),
				Math.max(0, Math.round(bounds.cy - size.height * 0.05)),
				Math.round(size.width * 0.2),
				Math.round(size.height * 0.1),
			);
		});
		console.log("bg layering corner/text:", JSON.stringify({ corner, sampled }));
		const cornerLum = (corner.r + corner.g + corner.b) / 3;
		expect(cornerLum, "wallpaper background rendered").toBeGreaterThan(3);
		expect(sampled, "text element bounds available").not.toBeNull();
		const textLum = (sampled!.r + sampled!.g + sampled!.b) / 3;
		expect(textLum, "upper-layer text visible above background").toBeGreaterThan(cornerLum * 1.5);
	});
});
