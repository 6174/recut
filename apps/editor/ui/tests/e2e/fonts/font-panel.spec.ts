import { test, expect } from "@playwright/test";
import {
	openDemo,
	settle,
	testGet,
	installFontAPIMock,
	expectFontRegistered,
	applyFont,
	countCanvasOpaquePixels,
} from "../helpers";

/**
 * 字体系统 E2E：Google 字体经 /v1/fonts 自托管加载并注册、本地系统字体枚举、
 * 中文字形渲染（非 tofu 回退）。全部走 installFontAPIMock 的本地 fixture
 * （hermetic，不依赖真实 service/CDN）。
 */

test.describe("font loading & rendering", () => {
	/** 把 demo 文本元素移到画布中心，避免位置依赖的像素区域采样。 */
	async function centerText(page: import("@playwright/test").Page) {
		await testGet(page, "setTime", 0);
		await testGet(page, "setElementParam", "demo-el-text", "transform.positionX", 0);
		await testGet(page, "setElementParam", "demo-el-text", "transform.positionY", 0);
		await settle(page);
		await settle(page);
	}

	test("字体目录经 /v1/fonts 返回 curated 家族（含 CJK）", async ({ page }) => {
		await installFontAPIMock(page);
		await page.goto("/demo.html?test=1", { waitUntil: "domcontentloaded" });
		const body = await page.evaluate(() =>
			fetch("/v1/fonts").then((r) => r.json()),
		);
		expect(body.sources).toEqual(["google", "local"]);
		const families = body.google.map((f: { family: string }) => f.family);
		expect(families).toContain("Inter");
		expect(families).toContain("Noto Sans SC");
		const cjk = body.google.find(
			(f: { id: string }) => f.id === "noto-sans-sc",
		);
		expect(cjk.scripts).toContain("zh");
	});

	test("Google 字体加载走本服务 CSS 且注册到 document.fonts", async ({
		page,
	}) => {
		await installFontAPIMock(page);
		await openDemo(page);
		await centerText(page);

		await applyFont(page, "demo-el-text", "Inter");
		await expectFontRegistered(page, "Inter");
		await settle(page);
		const interOpaque = await countCanvasOpaquePixels(page);

		await applyFont(page, "demo-el-text", "Arial");
		await settle(page);
		const arialOpaque = await countCanvasOpaquePixels(page);

		// 渲染真实生效：Inter 与默认 Arial 的像素直方图不同（字体真实加载而非回退）。
		expect(interOpaque).toBeGreaterThan(0);
		expect(arialOpaque).toBeGreaterThan(0);
		expect(Math.abs(interOpaque - arialOpaque)).toBeGreaterThan(0);
	});

	test("CJK 中文字形经选中的中文字体真实渲染（非 tofu 回退）", async ({
		page,
	}) => {
		await installFontAPIMock(page);
		await openDemo(page);
		await centerText(page);

		// 文本内容改为中文。
		await page.evaluate(() =>
			(window as any).__demoEditText("中文测试字体你好世界"),
		);
		await settle(page);

		// 未选中中文字体时（Arial 缺 CJK）中文渲染为 tofu 方框。
		await applyFont(page, "demo-el-text", "Arial");
		await settle(page);
		const tofuOpaque = await countCanvasOpaquePixels(page);

		// 选中 Noto Sans SC 后中文应渲染为真实字形。
		await applyFont(page, "demo-el-text", "Noto Sans SC");
		await expectFontRegistered(page, "Noto Sans SC");
		await settle(page);
		const cjkOpaque = await countCanvasOpaquePixels(page);

		// tofu 方框与真实字形的像素密度显著不同（判定非回退）。
		expect(cjkOpaque).toBeGreaterThan(0);
		expect(Math.abs(cjkOpaque - tofuOpaque)).toBeGreaterThan(500);
	});

	test("Local Fonts 源（系统字体枚举）可选且直接渲染", async ({ page }) => {
		await installFontAPIMock(page);
		await openDemo(page);
		await centerText(page);

		// 注入 queryLocalFonts 假实现：模拟本机有 PingFang SC。
		await page.addInitScript(() => {
			(window as any).queryLocalFonts = async () => [
				{
					family: "PingFang SC",
					weight: "400",
					style: "normal",
					fullName: "PingFang SC Regular",
					postscriptName: "PingFangSC-Regular",
				},
			];
		});
		await page.reload();
		await openDemo(page);
		await centerText(page);

		// PingFang SC 是本机系统字体，直接以 family 名渲染（无需加载）。
		await applyFont(page, "demo-el-text", "PingFang SC");
		await settle(page);
		const opaque = await countCanvasOpaquePixels(page);
		expect(opaque).toBeGreaterThan(1000);
	});
});
