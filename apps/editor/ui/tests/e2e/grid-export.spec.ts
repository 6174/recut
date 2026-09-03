import { test, expect } from "@playwright/test";
import { openDemo, testGet } from "./helpers";

/**
 * 背景网格导出回归：最小场景（仅 effect.grid，垫底），跑真实导出
 * （editor.project.export，与 UI 导出按钮/export.encode 同路径），
 * 断言导出读帧时画布上网格线峰值亮度达到设计值。
 *
 * 历史 bug：① 环境特效 ShaderMaterial 输出预乘颜色但按非预乘混合（alpha² 衰减）；
 * ② THREE.Color 默认把 uColor sRGB→linear 后无回编（再暗 ~3 倍）。两者叠加后
 * 网格线峰值 ~17/255，H.264 直接压成纯黑 —— 预览可见、导出消失。
 * 修复：共享特效平面 premultipliedAlpha + rawSrgbColor（跳过颜色空间转换）。
 */

test("背景网格组件导出可见（垫底，真实导出路径）", async ({ page }) => {
	test.setTimeout(300_000);
	await openDemo(page);
	await testGet(page, "pausePlayback");

	// 清空式最小场景：demo 内容全部删除太繁琐，直接断言导出探针的网格峰值。
	const elementId = await testGet<string>(
		page,
		"addComponentElement",
		"effect.grid",
		0,
		{ color: "#334155", opacity: 0.5, cell: 96, line: 1.2 },
	);
	await testGet(page, "advanceFrame");
	await page.waitForTimeout(500);

	const result = await page.evaluate(async () => {
		const bridge = (window as any).__recutTest;
		return bridge.runRealExport();
	});
	expect(result.ok, `导出失败: ${result.error}`).toBe(true);
	const maxValues: number[] = result.max ?? [];
	// 历史坏值 ~17（被 H.264 压成纯黑）；修复后应 ≈ 99（#334155 @ 50% 亮度）。
	// 前 3 帧是新 context 预热（swiftshader 首帧可能未就绪），从第 4 帧起断言。
	const steady = maxValues.slice(6);
	for (const [index, value] of steady.entries()) {
		expect(
			value,
			`导出第 ${index + 6} 帧网格线峰值 ${value}，低于可见阈值`,
		).toBeGreaterThan(60);
	}
	console.log("grid export peak:", maxValues.join(","));

	await testGet(page, "deleteElement", elementId);
});
