/**
 * [INPUT]: 依赖 motion-runtime-harness.html、Playwright Chromium CanvasDrawElement 与 window.__recutAnimationHarness。
 * [OUTPUT]: 验证 DOM/Three/Shader 三类目标由同一个 MotionRuntime seek，状态、对象 identity 和画布结果稳定。
 * [POS]: Editor 动画 runtime 的第一条真实浏览器垂直测试；不依赖内置浏览器，不复用生产编辑器 demo 状态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { expect, test } from "@playwright/test";
import { assertCanvasDrawElement } from "./helpers";

type HarnessState = {
	getTextSegments(): Promise<Array<{ id: string; x: number; opacity: number }>>;
	getThreeState(): Promise<{ identity: string; x: number; rotationY: number }>;
	getShaderState(): Promise<{ identity: string; uProgress: number }>;
	getCanvasHashes(): Promise<{ dom: string; three: string }>;
};

async function harness(page: import("@playwright/test").Page): Promise<HarnessState & { setTime(seconds: number): Promise<void> }> {
	await page.goto("/motion-runtime-harness.html");
	await page.waitForSelector("[data-motion-dom]");
	await page.waitForFunction(() => Boolean((window as any).__recutAnimationHarness));
	await assertCanvasDrawElement(page);
	const call = (name: string, ...args: unknown[]) =>
		page.evaluate(
			([method, values]) => (window as any).__recutAnimationHarness[method](...values),
			[name, args],
		);
	return {
		setTime: (seconds) => call("setTime", seconds),
		getTextSegments: () => call("getTextSegments"),
		getThreeState: () => call("getThreeState"),
		getShaderState: () => call("getShaderState"),
		getCanvasHashes: () => call("getCanvasHashes"),
	};
}

test.describe("MotionRuntime DOM / Three / Shader harness", () => {
	test("同一个 seek 同时驱动三类目标，并保持对象 identity", async ({ page }) => {
		const api = await harness(page);
		await api.setTime(0);
		const startText = (await api.getTextSegments())[0];
		const startThree = await api.getThreeState();
		const startShader = await api.getShaderState();

		await api.setTime(0.5);
		const middleText = (await api.getTextSegments())[0];
		const middleThree = await api.getThreeState();
		const middleShader = await api.getShaderState();

		expect(startText.opacity).toBeCloseTo(0, 2);
		expect(middleText.opacity).toBeGreaterThan(0.4);
		expect(middleText.opacity).toBeLessThan(0.6);
		expect(startThree.x).toBeLessThan(middleThree.x);
		expect(startShader.uProgress).toBeCloseTo(0, 2);
		expect(middleShader.uProgress).toBeCloseTo(0.5, 2);
		expect(middleThree.identity).toBe(startThree.identity);
		expect(middleShader.identity).toBe(startShader.identity);
	});

	test("往返 seek 后 DOM/Three/Shader 状态与画布 hash 可重复", async ({ page }) => {
		const api = await harness(page);
		await api.setTime(0.5);
		const stateA = {
			text: (await api.getTextSegments())[0],
			three: await api.getThreeState(),
			shader: await api.getShaderState(),
			hash: await api.getCanvasHashes(),
		};
		await api.setTime(0);
		await api.setTime(0.5);
		const stateB = {
			text: (await api.getTextSegments())[0],
			three: await api.getThreeState(),
			shader: await api.getShaderState(),
			hash: await api.getCanvasHashes(),
		};
		expect(stateB.text).toEqual(stateA.text);
		expect(stateB.three.x).toBeCloseTo(stateA.three.x, 5);
		expect(stateB.three.rotationY).toBeCloseTo(stateA.three.rotationY, 5);
		expect(stateB.shader.uProgress).toBeCloseTo(stateA.shader.uProgress, 5);
		expect(stateB.hash.dom).toBe(stateA.hash.dom);
		expect(stateB.hash.three).toBe(stateA.hash.three);
	});
});
