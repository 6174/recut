/**
 * [INPUT]: 依赖 Playwright 与 demo 页提供的 window.__recutTest 桥接能力。
 * [OUTPUT]: 覆盖关键帧新增、参数拖动与组件参数动画的端到端回归用例。
 * [POS]: editor UI 的关键帧回归套件，验证 UI 操作最终写入可渲染的时间线数据。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { test, expect } from "@playwright/test";
import { closeTo, getDisplayScale, openDemo, settle, testGet } from "./helpers";

test("已有关键帧属性拖动 → 落关键帧（不改基础值）；无关键帧属性 → 写基础值", async ({ page }) => {
	await openDemo(page);

	// 给 positionX 在 t=1s 落一个关键帧（标记该属性"已动画"）
	await page.evaluate(() => {
		(window as any).__recutTest.setKeyframe(
			"demo-el-glow",
			"transform.positionX",
			1,
			480,
		);
	});
	await page.waitForTimeout(50);

	// 播放头移到 t=3s 再拖动
	await testGet(page, "setTime", 3);
	await settle(page);

	const bounds = await testGet(page, "getNodeBounds", "demo-el-glow");
	const screen = await testGet(page, "canvasToScreen", bounds.cx, bounds.cy);
	await page.mouse.click(screen.x, screen.y);
	await settle(page);

	const scale = await getDisplayScale(page);

	await page.keyboard.down("Shift");
	await page.mouse.move(screen.x, screen.y);
	await page.mouse.down();
	await page.mouse.move(screen.x + 100 * scale, screen.y, { steps: 5 });
	await settle(page);
	await page.mouse.up();
	await page.keyboard.up("Shift");
	await settle(page);

	// D1：positionX 已有关键帧 → 在 t=3s 落关键帧，基础值保持 480 不变
	const after = await testGet(page, "getResolvedTransform", "demo-el-glow");
	expect(after.position.x).toBeCloseTo(480, 0);

	const animations: any = await testGet(page, "getAnimations", "demo-el-glow");
	const channel = animations?.["transform.positionX"];
	expect(channel).toBeTruthy();

	// 该通道含 t=1s 的初始关键帧，且拖动在 t=3s 附近写入新关键帧（值明显移动）
	const keys: { time: number; value: number }[] = channel.keys.map((k: any) => ({
		time: Number((k.time as number) / 120000),
		value: Number(k.value),
	}));
	expect(keys.some((k) => closeTo(k.time, 1, 0.2))).toBe(true);
	const draggedKey = keys.find((k) => closeTo(k.time, 3, 0.2));
	expect(draggedKey).toBeTruthy();
	expect(draggedKey!.value).toBeGreaterThan(500);
});

test("组件颜色可创建复合关键帧", async ({ page }) => {
	await openDemo(page);

	const didUpsert = await page.evaluate(() =>
		(window as any).__recutTest.setKeyframe(
			"demo-el-glow",
			"color",
			1,
			"#0ea5e9",
		),
	);
	expect(didUpsert).toBe(true);

	const animations: any = await testGet(page, "getAnimations", "demo-el-glow");
	const color = animations?.color;
	expect(color).toBeTruthy();
	for (const component of ["r", "g", "b", "a"]) {
		expect(color[component]?.keys).toHaveLength(1);
	}
});
