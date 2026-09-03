import { test, expect } from "@playwright/test";
import { closeTo, getDisplayScale, openDemo, settle, testGet } from "./helpers";

test("左右/上下拖拽：数据位移 == delta，选择框（bounds）跟手", async ({ page }) => {
	await openDemo(page);

	// 选中 glow box
	const bounds = await testGet(page, "getNodeBounds", "demo-el-glow");
	const screen = await testGet(page, "canvasToScreen", bounds.cx, bounds.cy);
	await page.mouse.click(screen.x, screen.y);
	await settle(page);

	const before = await testGet(page, "getResolvedTransform", "demo-el-glow");
	const scale = await getDisplayScale(page);

	// Shift 关闭吸附；拖 +120,+60 canvas px
	await page.keyboard.down("Shift");
	await page.mouse.move(screen.x, screen.y);
	await page.mouse.down();
	await page.mouse.move(screen.x + 120 * scale, screen.y + 60 * scale, {
		steps: 6,
	});
	await settle(page);
	const during = await testGet(page, "getResolvedTransform", "demo-el-glow");
	expect(closeTo(during.position.x, before.position.x + 120)).toBe(true);
	expect(closeTo(during.position.y, before.position.y + 60)).toBe(true);

	// 拖拽中（未松手）选择框中心应跟随数据
	const dragBounds = await testGet(page, "getNodeBounds", "demo-el-glow");
	expect(closeTo(dragBounds.cx, 960 + during.position.x)).toBe(true);
	expect(closeTo(dragBounds.cy, 540 + during.position.y)).toBe(true);

	await page.mouse.up();
	await page.keyboard.up("Shift");
	await settle(page);

	// 松手后提交到 Model：数据保持
	const after = await testGet(page, "getResolvedTransform", "demo-el-glow");
	expect(closeTo(after.position.x, before.position.x + 120)).toBe(true);
	expect(closeTo(after.position.y, before.position.y + 60)).toBe(true);
});
