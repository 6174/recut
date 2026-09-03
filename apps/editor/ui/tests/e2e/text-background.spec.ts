/**
 * [INPUT]: 依赖 Playwright、编辑器 demo 与文本面板/时间线测试桥。
 * [OUTPUT]: 覆盖文本背景渲染，以及单项文本资源卡片的稳定网格尺寸。
 * [POS]: text 领域的端到端回归，防止单一资源卡片被面板宽度拉伸。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { expect, test } from "@playwright/test";
import { openDemo, settle, testGet } from "./helpers";

async function countTextBackgroundPixels(page: import("@playwright/test").Page) {
	return page.evaluate(async () => {
		const canvas = document.querySelector<HTMLCanvasElement>(
			"canvas[data-recut-canvas]",
		);
		if (!canvas) return 0;

		const image = new Image();
		image.src = canvas.toDataURL();
		await image.decode();

		const snapshot = document.createElement("canvas");
		snapshot.width = canvas.width;
		snapshot.height = canvas.height;
		const context = snapshot.getContext("2d", { willReadFrequently: true });
		if (!context) return 0;
		context.drawImage(image, 0, 0);
		const pixels = context.getImageData(0, 0, snapshot.width, snapshot.height).data;
		let count = 0;

		for (let y = 350; y < 740; y++) {
			for (let x = 300; x < 1620; x++) {
				const offset = (y * snapshot.width + x) * 4;
				if (
					pixels[offset] > 220 &&
					pixels[offset + 1] < 80 &&
					pixels[offset + 2] < 80
				) {
					count += 1;
				}
			}
		}

		return count;
	});
}

test("文字背景开关不会拉伸文字或残留旧颜色", async ({ page }) => {
	await openDemo(page);
	await testGet(
		page,
		"setElementParam",
		"demo-el-text",
		"transform.positionY",
		0,
	);
	await testGet(
		page,
		"setElementParam",
		"demo-el-text",
		"background.enabled",
		false,
	);
	await settle(page);
	await settle(page);
	const baselineRedPixels = await countTextBackgroundPixels(page);

	await testGet(
		page,
		"setElementParam",
		"demo-el-text",
		"background.color",
		"#ff0000",
	);
	await testGet(
		page,
		"setElementParam",
		"demo-el-text",
		"background.enabled",
		true,
	);
	await settle(page);
	await settle(page);
	const enabledBounds = await testGet(page, "getNodeBounds", "demo-el-text");
	expect(await countTextBackgroundPixels(page)).toBeGreaterThan(
		baselineRedPixels + 10_000,
	);

	await testGet(
		page,
		"setElementParam",
		"demo-el-text",
		"background.enabled",
		false,
	);
	await settle(page);
	await settle(page);
	const disabledBounds = await testGet(page, "getNodeBounds", "demo-el-text");
	expect(disabledBounds.width).toBeLessThan(enabledBounds.width);
	expect(disabledBounds.height).toBeLessThan(enabledBounds.height);
	expect(await countTextBackgroundPixels(page)).toBe(baselineRedPixels);
});

test("单项文本资源保持卡片尺寸，不撑满面板", async ({ page }) => {
	await openDemo(page);
	await page.getByRole("button", { name: /^(文本|Text)$/ }).click();
	const label = page.getByText(/^(默认文本|Default text)$/).first();
	const card = label.locator("xpath=ancestor::*[@draggable='true']").first();
	await expect(card).toBeVisible();
	const box = await card.boundingBox();
	expect(box?.width).toBeGreaterThan(80);
	// Demo 左侧面板宽约 288px，单项应占一条网格轨道，而非撑满整个内容区。
	expect(box?.width).toBeLessThan(160);
	expect(box?.height).toBeLessThan(160);
});
