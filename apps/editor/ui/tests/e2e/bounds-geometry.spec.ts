import { test, expect } from "@playwright/test";
import { openDemo, settle, testGet } from "./helpers";

test("选择框 bounds 与渲染几何（Object3D AABB）同源一致", async ({ page }) => {
	await openDemo(page);
	await settle(page);

	// 数据中心 = canvas 中心 + transform.position
	const bounds = await testGet(page, "getNodeBounds", "demo-el-glow");
	expect(bounds.cx).toBeCloseTo(960 + 480, 0);
	expect(bounds.cy).toBeCloseTo(540 + 260, 0);

	// 尺寸来自渲染几何：glow-box size=240，含倾角投影，落在合理区间
	expect(bounds.width).toBeGreaterThan(200);
	expect(bounds.width).toBeLessThan(420);
	expect(bounds.height).toBeGreaterThan(200);
	expect(bounds.height).toBeLessThan(420);

	// 渲染 AABB 中心与数据中心同步（world y = -position.y）
	const box = await testGet(page, "getObject3DBox", "demo-el-glow");
	const boxCx = (box.minX + box.maxX) / 2;
	const boxCy = (box.minY + box.maxY) / 2;
	expect(boxCx).toBeCloseTo(480, 0);
	expect(boxCy).toBeCloseTo(-260, 0);

	// 文本：plane 按内容定尺寸（D6），bounds 应明显小于画布
	const textBounds = await testGet(page, "getNodeBounds", "demo-el-text");
	expect(textBounds.width).toBeLessThan(1920);
	expect(textBounds.width).toBeGreaterThan(0);
});
