/**
 * [INPUT]: demo 时间线、属性面板 Animation 区域、window.__recutTest bridge。
 * [OUTPUT]: 验证用户可选中元素并通过 UI 应用/清除预设，绑定写入项目数据，且同一 Loop Glitch 可驱动 GlowBox 与 Canvas Text 材质。
 * [POS]: 预设动画产品层 UI E2E；浏览器由 playwright.config 启用 CanvasDrawElement。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { expect, test } from "@playwright/test";
import { openDemo, settle, testGet } from "./helpers";

function sampleDiff(a: number[], b: number[]): number {
	const length = Math.min(a.length, b.length);
	let total = 0;
	for (let index = 0; index < length; index += 1) total += Math.abs(a[index] - b[index]);
	return total / (length / 3);
}

test("选择文本元素后可从 Animation 面板应用并清除文本预设", async ({ page }) => {
	await openDemo(page);
	await page.getByText("Recut Demo", { exact: true }).last().click();

	const selection = await testGet<Array<{ elementId: string }>>(page, "getSelection");
	expect(selection).toHaveLength(1);
	await expect(page.locator('[data-properties-block="visual"]')).toBeVisible();
	await expect(page.locator('[data-properties-nav-target="visual"]')).toHaveAttribute("data-properties-nav-active", "true");
	await page.locator('[data-properties-nav-target="motion"]').click();
	await expect(page.locator('[data-properties-nav-target="motion"]')).toHaveAttribute("data-properties-nav-active", "true");
	await expect(page.locator('[data-properties-nav-target="visual"]')).toHaveAttribute("data-properties-nav-active", "false");
	await expect(page.locator('[data-properties-block="visual"]')).toHaveCount(0);
	const enterGroup = page.locator('[data-motion-group="enter"]');
	await expect(enterGroup).toBeVisible();
	await expect(enterGroup).toContainText("Enter");
	await expect(enterGroup.locator('[data-motion-preset="text-fade-up"]')).toBeVisible();
	await enterGroup.locator('[data-motion-preset="text-fade-up"]').click();
	await expect(enterGroup.locator('[data-motion-preset="text-fade-up"]')).toContainText("Playing");
	await expect(enterGroup.locator('[data-motion-option="text-fade-up"]')).toHaveAttribute("data-motion-active", "true");
	await expect.poll(async () => testGet<{ active: boolean; isPlaying: boolean }>(page, "getPreviewState")).toMatchObject({ active: true, isPlaying: true });
	await page.waitForTimeout(750);
	await expect.poll(async () => testGet<{ active: boolean; isPlaying: boolean }>(page, "getPreviewState")).toMatchObject({ active: false, isPlaying: false });
	await expect(enterGroup.locator('[data-motion-preset="text-fade-up"]')).toHaveAttribute("aria-pressed", "true");

	const applied = await testGet<{ textMotion: { presetId: string; segment: { mode: string } } }>(page, "getMotion", selection[0].elementId);
	expect(applied.textMotion.presetId).toBe("text-fade-up");
	expect(applied.textMotion.segment.mode).toBe("grapheme");

	await enterGroup.locator('[data-motion-preset="none"]').click();
	await settle(page);
	const cleared = await testGet<{ textMotion: unknown }>(page, "getMotion", selection[0].elementId);
	expect(cleared.textMotion).toBeNull();

	const loopGroup = page.locator('[data-motion-group="loop"]');
	await loopGroup.locator('[data-motion-preset="text-color-shift"]').click();
	await expect.poll(async () => testGet<{ active: boolean; isPlaying: boolean }>(page, "getPreviewState")).toMatchObject({ active: true, isPlaying: true });
	await page.waitForTimeout(1_800);
	await expect.poll(async () => testGet<{ active: boolean; isPlaying: boolean; time: number }>(page, "getPreviewState")).toMatchObject({ active: true, isPlaying: true });
	await expect.poll(async () => (await testGet<{ time: number }>(page, "getPreviewState")).time).toBeGreaterThan(1);
	await loopGroup.locator('[data-motion-preset="none"]').click();
	await expect.poll(async () => testGet<{ active: boolean }>(page, "getPreviewState")).toMatchObject({ active: false });
});

test("元素 Loop Glitch 会驱动元素材质并在画布中产生 RGB 撕裂", async ({ page }) => {
	await openDemo(page);
	const elementId = await testGet<string>(page, "addTextElement", "UNIFIED EFFECT GLITCH", 0, {
		fontSize: 180,
		color: "#aab4c8",
	});
	expect(await testGet(page, "selectElement", elementId)).toBe(true);
	await page.waitForSelector('[data-properties-nav-target="motion"]');
	await page.locator('[data-properties-nav-target="motion"]').click();
	const loopGroup = page.locator('[data-motion-group="loop"]');
	const glitchPreset = loopGroup.locator('[data-motion-preset="effect-glitch-loop"]');
	await expect(glitchPreset).toBeVisible();
	await glitchPreset.click();
	const binding = await testGet<{ motion: { loop: { presetId: string } } }>(page, "getMotion", elementId);
	expect(binding.motion.loop.presetId).toBe("effect-glitch-loop");
	await testGet(page, "pausePlayback");
	await testGet(page, "setTime", 1.3);
	await testGet(page, "advanceFrame");
	await page.waitForTimeout(120);
	const baseline = await testGet<{ data: number[] }>(page, "getCanvasSample");
	await testGet(page, "setTime", 1.42);
	await testGet(page, "advanceFrame");
	await page.waitForTimeout(120);
	const uniforms = await testGet<{ "glitch.progress": number; "glitch.intensity": number }>(page, "getShaderUniforms", elementId);
	expect(uniforms).not.toBeNull();
	expect(uniforms["glitch.progress"]).toBeGreaterThan(0);
	expect(uniforms["glitch.intensity"]).toBeGreaterThan(0);
	expect((await testGet<{ hasMotionShader: boolean }>(page, "getMaterialDebug", elementId)).hasMotionShader).toBe(true);
	const burst = await testGet<{ data: number[] }>(page, "getCanvasSample");
	expect(baseline).not.toBeNull();
	expect(burst).not.toBeNull();
	expect(sampleDiff(baseline.data, burst.data)).toBeGreaterThan(8);
	await testGet(page, "deleteElement", elementId);
});

test("同一 Loop Glitch 可复用于 Canvas Text 材质", async ({ page }) => {
	await openDemo(page);
	const elementId = await testGet<string>(page, "addTextElement", "GENERIC SHADER TEXT", 0, {
		fontSize: 180,
		color: "#aab4c8",
	});
	expect(await testGet(page, "selectElement", elementId)).toBe(true);
	await page.locator('[data-properties-nav-target="motion"]').click();
	const loopGroup = page.locator('[data-motion-group="loop"]');
	const glitchPreset = loopGroup.locator('[data-motion-preset="effect-glitch-loop"]');
	await expect(glitchPreset).toBeVisible();
	await glitchPreset.click();
	const binding = await testGet<{ motion: { loop: { presetId: string } } }>(page, "getMotion", elementId);
	expect(binding.motion.loop.presetId).toBe("effect-glitch-loop");
	await testGet(page, "pausePlayback");
	await testGet(page, "setTime", 1.42);
	await testGet(page, "advanceFrame");
	await page.waitForTimeout(120);
	const uniforms = await testGet<{ "glitch.progress": number; "glitch.intensity": number }>(page, "getShaderUniforms", elementId);
	expect(uniforms["glitch.progress"]).toBeGreaterThan(0);
	expect(uniforms["glitch.intensity"]).toBeGreaterThan(0);
	await testGet(page, "deleteElement", elementId);
});

test("Element Animation 通过统一 Effect Shader 驱动元素纹理", async ({ page }) => {
	await openDemo(page);
	const elementId = await testGet<string>(page, "addTextElement", "UNIFIED EFFECT GLITCH", 0, { fontSize: 180, color: "#aab4c8" });
	expect(await testGet(page, "selectElement", elementId)).toBe(true);
	await page.locator('[data-properties-nav-target="motion"]').click();
	await page.locator('[data-motion-group="loop"] [data-motion-preset="effect-glitch-loop"]').click();
	await testGet(page, "pausePlayback");
	await testGet(page, "setTime", 1.1);
	await testGet(page, "advanceFrame");
	await page.waitForTimeout(120);
	const baseline = await testGet<{ data: number[] }>(page, "getCanvasSample");
	await testGet(page, "setTime", 1.6);
	await testGet(page, "advanceFrame");
	await page.waitForTimeout(120);
	const uniforms = await testGet<{ "glitch.progress": number; "glitch.intensity": number }>(page, "getShaderUniforms", elementId);
	const debug = await testGet<{ fragmentLength: number }>(page, "getMaterialDebug", elementId);
	const burst = await testGet<{ data: number[] }>(page, "getCanvasSample");
	expect(uniforms["glitch.progress"]).toBeGreaterThan(0);
	expect(uniforms["glitch.intensity"]).toBeGreaterThan(0);
	expect(debug.fragmentLength).toBeGreaterThan(0);
	expect(sampleDiff(baseline.data, burst.data)).toBeGreaterThan(4);
	await testGet(page, "deleteElement", elementId);
});

test("Spline Scene 不展示不支持的 Shader 动画", async ({ page }) => {
	await openDemo(page);
	const elementId = await testGet<string>(page, "addComponentElement", "spline-scene");
	expect(await testGet(page, "selectElement", elementId)).toBe(true);
	await page.locator('[data-properties-nav-target="motion"]').click();
	const loopGroup = page.locator('[data-motion-group="loop"]');
	await expect(loopGroup.locator('[data-motion-preset="effect-glitch-loop"]')).toHaveCount(0);
	await expect(loopGroup.locator('[data-motion-preset="effect-ripple-loop"]')).toHaveCount(0);
	await expect(loopGroup.locator('[data-motion-preset="pulse"]')).toBeVisible();
	await testGet(page, "deleteElement", elementId);
});

test("Shape 不展示不支持的 Shader 动画", async ({ page }) => {
	await openDemo(page);
	const elementId = await testGet<string>(page, "addComponentElement", "shape", 0, { size: 420, color: "#ff3355" });
	expect(await testGet(page, "selectElement", elementId)).toBe(true);
	await page.locator('[data-properties-nav-target="motion"]').click();
	const loopGroup = page.locator('[data-motion-group="loop"]');
	await expect(loopGroup.locator('[data-motion-preset="effect-glitch-loop"]')).toHaveCount(0);
	await expect(loopGroup.locator('[data-motion-preset="effect-vhs-loop"]')).toHaveCount(0);
	await expect(loopGroup.locator('[data-motion-preset="pulse"]')).toBeVisible();
	await testGet(page, "deleteElement", elementId);
});
