import { test, expect } from "@playwright/test";
import { openDemo, settle, testGet } from "./helpers";

test("单击一次选中元素；点空白一次取消；点其它元素切换", async ({ page }) => {
	await openDemo(page);

	// 单击 glow box → 选中
	const bounds = await testGet(page, "getNodeBounds", "demo-el-glow");
	const screen = await testGet(page, "canvasToScreen", bounds.cx, bounds.cy);
	await page.mouse.click(screen.x, screen.y);
	await settle(page);
	expect(await testGet(page, "getSelection")).toContainEqual({
		trackId: "demo-graphic-track",
		elementId: "demo-el-glow",
	});

	// 单击 text → 切换选中
	const textBounds = await testGet(page, "getNodeBounds", "demo-el-text");
	const textScreen = await testGet(page, "canvasToScreen", textBounds.cx, textBounds.cy);
	await page.mouse.click(textScreen.x, textScreen.y);
	await settle(page);
	expect(await testGet(page, "getSelection")).toContainEqual({
		trackId: "demo-text-track",
		elementId: "demo-el-text",
	});

	// 单击空白（右下角）→ 取消选择
	const empty = await testGet(page, "canvasToScreen", 1800, 1000);
	await page.mouse.click(empty.x, empty.y);
	await settle(page);
	expect(await testGet(page, "getSelection")).toHaveLength(0);
});
