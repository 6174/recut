/**
 * [INPUT]: 依赖 Playwright、编辑器 demo（?test=1&locale=en）与属性面板/测试桥。
 * [OUTPUT]: 通过属性面板「混合模式」下拉逐一验证 17 种混合模式在预览画布产生真实像素变化，
 *           以及切回 normal 后画面回到基线（回归"面板改了但渲染无效果"的历史 bug）。
 * [POS]: 混合模式（blendMode）领域的端到端回归：UI 选择 → params 写入 → WorldScene 合成 → 画布像素。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { expect, test } from "@playwright/test";
import { openDemo, settle, testGet } from "./helpers";

const BLEND_MODES: Array<{ mode: string; label: string }> = [
	{ mode: "darken", label: "Darken" },
	{ mode: "multiply", label: "Multiply" },
	{ mode: "color-burn", label: "Color Burn" },
	{ mode: "lighten", label: "Lighten" },
	{ mode: "screen", label: "Screen" },
	{ mode: "plus-lighter", label: "Plus Lighter" },
	{ mode: "color-dodge", label: "Color Dodge" },
	{ mode: "overlay", label: "Overlay" },
	{ mode: "soft-light", label: "Soft Light" },
	{ mode: "hard-light", label: "Hard Light" },
	{ mode: "difference", label: "Difference" },
	{ mode: "exclusion", label: "Exclusion" },
	{ mode: "hue", label: "Hue" },
	{ mode: "saturation", label: "Saturation" },
	{ mode: "color", label: "Color" },
	{ mode: "luminosity", label: "Luminosity" },
];

/** 期望比 normal 变暗的模式（对不透明源逐通道单调下降）。 */
const DARKER_MODES = new Set(["darken", "multiply"]);
/** 期望比 normal 变亮的模式（对不透明源逐通道单调上升）。 */
const BRIGHTER_MODES = new Set(["lighten", "screen", "plus-lighter", "color-dodge"]);

type RegionMean = { r: number; g: number; b: number; count: number };
type Region = { x: number; y: number; width: number; height: number };

async function elementRegion(
	page: import("@playwright/test").Page,
	elementId: string,
	shrink = 0.88,
): Promise<Region> {
	const bounds = await testGet(page, "getNodeBounds", elementId);
	expect(bounds, `element ${elementId} should have rendered bounds`).not.toBeNull();
	const halfW = (bounds.width * shrink) / 2;
	const halfH = (bounds.height * shrink) / 2;
	return {
		x: bounds.cx - halfW,
		y: bounds.cy - halfH,
		width: halfW * 2,
		height: halfH * 2,
	};
}

async function sampleRegion(
	page: import("@playwright/test").Page,
	region: Region,
): Promise<RegionMean> {
	const mean = await testGet(
		page,
		"getCanvasRegionMean",
		region.x,
		region.y,
		region.width,
		region.height,
		400,
	);
	expect(mean, "canvas region mean should be readable").not.toBeNull();
	return mean as RegionMean;
}

/** 属性面板「混合模式」SelectTrigger（Radix Select 的 combobox 按钮）。 */
function blendModeTrigger(page: import("@playwright/test").Page) {
	return page
		.locator('label:has-text("Blend Mode")')
		.first()
		.locator("..")
		.getByRole("combobox")
		.first();
}

async function selectBlendMode(
	page: import("@playwright/test").Page,
	label: string,
): Promise<void> {
	await blendModeTrigger(page).click();
	await page.getByRole("option", { name: label, exact: true }).click();
	// 世界重建 + 纹理/合成管线需要若干帧才稳定。
	await settle(page);
	await settle(page);
}

async function setupDemo(
	page: import("@playwright/test").Page,
): Promise<void> {
	await openDemo(page, { query: "test=1&locale=en" });
	await testGet(page, "pausePlayback");
	await testGet(page, "setTime", 0);
	// 饱和的中调紫色背景：让 17 种混合模式对渐变 demo 图都产生可测的像素差异。
	await testGet(page, "setProjectBackground", "#9944dd");
	await settle(page);
	await settle(page);
}

test("属性面板混合模式：17 种模式在预览画布产生真实像素变化", async ({
	page,
}) => {
	await setupDemo(page);

	await testGet(page, "selectElement", "demo-el-image");
	await settle(page);
	// 面板必须真实渲染出混合模式下拉，且当前值为 Normal。
	const trigger = blendModeTrigger(page);
	await expect(trigger).toBeVisible();
	await expect(trigger).toContainText("Normal");

	const region = await elementRegion(page, "demo-el-image");
	const baseline = await sampleRegion(page, region);

	for (const { label } of BLEND_MODES) {
		await selectBlendMode(page, label);
		// 下拉必须回显所选值（UI 状态与 params 往返一致）。
		await expect(trigger).toContainText(label);

		const mean = await sampleRegion(page, region);
		const delta = { r: mean.r - baseline.r, g: mean.g - baseline.g, b: mean.b - baseline.b };
		const magnitude = (Math.abs(delta.r) + Math.abs(delta.g) + Math.abs(delta.b)) / 3;
		expect(
			magnitude,
			`blend mode "${label}" should visibly change the image region (Δ=${JSON.stringify(
				delta,
			)})`,
		).toBeGreaterThan(2);

		if (DARKER_MODES.has(label)) {
			expect(delta.r, `${label} should darken R`).toBeLessThanOrEqual(1);
			expect(delta.g, `${label} should darken G`).toBeLessThanOrEqual(1);
			expect(delta.b, `${label} should darken B`).toBeLessThanOrEqual(1);
		} else if (BRIGHTER_MODES.has(label)) {
			expect(delta.r, `${label} should brighten R`).toBeGreaterThanOrEqual(-1);
			expect(delta.g, `${label} should brighten G`).toBeGreaterThanOrEqual(-1);
			expect(delta.b, `${label} should brighten B`).toBeGreaterThanOrEqual(-1);
		}
	}

	// 切回 normal：画面必须回到基线（管线无残留状态）。
	await selectBlendMode(page, "Normal");
	const restored = await sampleRegion(page, region);
	expect(Math.abs(restored.r - baseline.r)).toBeLessThan(2);
	expect(Math.abs(restored.g - baseline.g)).toBeLessThan(2);
	expect(Math.abs(restored.b - baseline.b)).toBeLessThan(2);
});

test("文本元素混合模式（Multiply）同样生效", async ({ page }) => {
	await setupDemo(page);

	// 把文本移到右下纯色区（避开 demo 图与 demo 视频的深色带），使胶囊+白字完全落在背景上。
	await testGet(page, "setElementParam", "demo-el-text", "transform.positionX", 320);
	await testGet(page, "setElementParam", "demo-el-text", "transform.positionY", 350);
	await settle(page);
	await settle(page);

	await testGet(page, "selectElement", "demo-el-text");
	await settle(page);
	await expect(blendModeTrigger(page)).toBeVisible();

	// 取文本区域中部（胶囊 + 白字，一定不与 demo 图/视频重叠）。
	const bounds = await testGet(page, "getNodeBounds", "demo-el-text");
	const region: Region = {
		x: bounds.cx - bounds.width * 0.4,
		y: bounds.cy - bounds.height * 0.4,
		width: bounds.width * 0.8,
		height: bounds.height * 0.8,
	};
	const baseline = await sampleRegion(page, region);

	await selectBlendMode(page, "Multiply");
	const mean = await sampleRegion(page, region);
	const magnitude =
		(Math.abs(mean.r - baseline.r) +
			Math.abs(mean.g - baseline.g) +
			Math.abs(mean.b - baseline.b)) /
		3;
	expect(
		magnitude,
		`text multiply should change the pill/text region (baseline=${JSON.stringify(
			baseline,
		)}, after=${JSON.stringify(mean)})`,
	).toBeGreaterThan(2);
});

test("帧快照（封面链路）与预览一致地应用混合模式", async ({ page }) => {
	await setupDemo(page);

	await testGet(page, "selectElement", "demo-el-image");
	await settle(page);

	const region = await elementRegion(page, "demo-el-image");
	const base = {
		x: region.x,
		y: region.y,
		width: region.width,
		height: region.height,
	};

	// normal 基线帧
	const baseline = await testGet(page, "renderFrameMean", 0, base.x, base.y, base.width, base.height, 160);
	expect(baseline, "frame snapshot should render").not.toBeNull();

	// 切到 multiply 后，同一帧快照必须与预览一样产生真实像素变化
	await selectBlendMode(page, "Multiply");
	const multiplied = await testGet(page, "renderFrameMean", 0, base.x, base.y, base.width, base.height, 160);
	expect(multiplied, "frame snapshot should render").not.toBeNull();

	const delta = {
		r: multiplied.r - baseline.r,
		g: multiplied.g - baseline.g,
		b: multiplied.b - baseline.b,
	};
	const magnitude = (Math.abs(delta.r) + Math.abs(delta.g) + Math.abs(delta.b)) / 3;
	expect(
		magnitude,
		`snapshot multiply should change the image region (baseline=${JSON.stringify(
			baseline,
		)}, after=${JSON.stringify(multiplied)})`,
	).toBeGreaterThan(2);
	// 方向与预览一致：不透明图 × 暗背景逐通道变暗。
	expect(delta.r).toBeLessThanOrEqual(1);
	expect(delta.g).toBeLessThanOrEqual(1);
	expect(delta.b).toBeLessThanOrEqual(1);
});
