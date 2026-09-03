/**
 * [INPUT]: 依赖 Playwright、组件构建脚本与 component-harness 的渲染/封面测试接口。
 * [OUTPUT]: 覆盖 AI 组件三种 surface 的渲染像素、Motion Program 生产接入，以及内置 HTML/React 组件 PNG 封面生成。
 * [POS]: editor UI 的组件运行时端到端回归，阻止隐藏 harness viewport 裁切 DOM 封面。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDemo } from "./helpers";

/**
 * AI 临时组件渲染链路 E2E：
 * fixture 源码 → component-build.js（esbuild+tsc+确定性扫描）→ bundle →
 * harness 页 setComponent(注入 bundle) → blob import + prelude 共享实例 →
 * ensureComponent 注册 → WorldScene 渲染 → 像素断言。
 * L1 html / L2 react 依赖 html-in-canvas（Chrome 149+ flag），不支持时仅断言"渲染无异常"。
 */
const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SPEC_DIR, "../../../");
const BUILD_SCRIPT = path.join(APP_ROOT, "scripts", "component-build.js");
const SDK_DIR = path.join(APP_ROOT, "sdk");
const FIXTURES = path.join(SPEC_DIR, "fixtures", "components");

const FIXTURES_META: Record<string, { surface: string; inputs: Array<{ key: string; default: unknown }> }> = {
	"countdown": { surface: "html", inputs: [{ key: "color", default: "#0ea5e9" }] },
	"pulse-card": {
		surface: "react",
		inputs: [
			{ key: "text", default: "Recut" },
			{ key: "color", default: "#0ea5e9" },
		],
	},
	// 纯函数组件 default export（react）：loader 归一化后与 pulse-card 视觉等价。
	"pulse-card-fn": {
		surface: "react",
		inputs: [
			{ key: "text", default: "Recut" },
			{ key: "color", default: "#0ea5e9" },
		],
	},
	"pulse-cube": { surface: "r3f", inputs: [{ key: "color", default: "#ff2244" }] },
	"motion-text": { surface: "react", inputs: [{ key: "text", default: "ABC" }] },
};

function buildFixture(name: string): { bundle: string; bundleHash: string } {
	const sourcePath = path.join(FIXTURES, `${name}.tsx`);
	const outPath = path.join(os.tmpdir(), `recut-e2e-${name}.js`);
	const result = spawnSync("node", [BUILD_SCRIPT, sourcePath, outPath, SDK_DIR], {
		encoding: "utf8",
	});
	const parsed = JSON.parse(result.stdout || "{}");
	if (!parsed.ok) {
		throw new Error(`build ${name} 失败: ${JSON.stringify(parsed)}`);
	}
	return { bundle: fs.readFileSync(outPath, "utf8"), bundleHash: parsed.bundleHash };
}

const bundles: Record<string, { bundle: string; bundleHash: string }> = {};

// GSAP fixtures（react + r3f useTimeline）：验证确定性 seek 驱动 + 同 t 像素一致。
const GSAP_FIXTURES_META: Record<string, { surface: string; inputs: Array<{ key: string; default: unknown }> }> = {
	"gsap-reveal": {
		surface: "react",
		inputs: [
			{ key: "title", default: "Recut" },
			{ key: "color", default: "#6366f1" },
		],
	},
	"gsap-orbit": { surface: "r3f", inputs: [{ key: "color", default: "#6366f1" }] },
};
const gsapBundles: Record<string, { bundle: string; bundleHash: string }> = {};

test.beforeAll(() => {
	for (const name of Object.keys(FIXTURES_META)) {
		bundles[name] = buildFixture(name);
	}
	for (const name of Object.keys(GSAP_FIXTURES_META)) {
		gsapBundles[name] = buildFixture(name);
	}
});

test.beforeEach(async ({ page }) => {
	await page.goto("/component-harness.html");
});

for (const [name, meta] of Object.entries(FIXTURES_META)) {
	test(`渲染链路：${name}（${meta.surface}）`, async ({ page }) => {
		const htmlInCanvas = await page.evaluate(() => (window as any).__recutHarness.supported());
		const setOk = await page.evaluate(
			([componentId, surface, inputs, bundle, bundleHash]) =>
				(window as any).__recutHarness.setComponent({
					componentId,
					name: componentId,
					surface,
					inputs,
					bundle,
					bundleHash,
				}),
			[name, meta.surface, meta.inputs, bundles[name].bundle, bundles[name].bundleHash],
		);
		expect(setOk).toBe(true);

		const status = await page.evaluate(() => (window as any).__recutHarness.render(0.5, 5));
		expect(status.status).toBe("rendered");
		expect(status.surface).toBe(meta.surface);

		// 组件确实挂载了场景对象（非占位）
		const hasNode = await page.evaluate(() => (window as any).__recutHarness.hasNodeObject());
		expect(hasNode).toBe(true);

		if (meta.surface === "r3f") {
			// 中心像素 = 立方体色（红）；(380,180) 在 t=0（size 100→半 50）外、t=2.5（size 140→半 70）内 → 动画改变几何
			const pCenter = await page.evaluate(([x, y]) => (window as any).__recutHarness.readPixel(x, y), [320, 180]);
			expect(pCenter[0]).toBeGreaterThan(150);
			expect(pCenter[1]).toBeLessThan(120);
			const at0 = await page.evaluate(([x, y]) => (window as any).__recutHarness.readPixel(x, y), [380, 180]);
			await page.evaluate(() => (window as any).__recutHarness.render(2.5, 5));
			const at25 = await page.evaluate(([x, y]) => (window as any).__recutHarness.readPixel(x, y), [380, 180]);
			// 动画改变几何 → (380,180) 从背景变为立方体色
			expect(Math.abs(at0[0] - at25[0])).toBeGreaterThan(80);
		} else if (htmlInCanvas.htmlInCanvas) {
			// html/react 承载面：中心区域应出现非背景内容（capture 异步，轮询等待）
			await expect
				.poll(() =>
					page.evaluate(() => (window as any).__recutHarness.countNonBackground(280, 140, 80, 80)),
					{ timeout: 5000 },
				)
				.toBeGreaterThan(0);

			if (meta.surface === "react") {
				// 根节点铺满 512×512 承载面；作者声明的稳定 interaction box
				// 必须覆盖动画全程，且绝不能回退为透明承载面或整幅画布。
				const bounds = await page.evaluate(
					() => (window as any).__recutHarness.getNodeBounds(),
				);
				if (name === "motion-text") {
					expect(bounds.width).toBeGreaterThan(0);
					expect(bounds.height).toBeGreaterThan(0);
				} else {
					expect(bounds.width).toBeCloseTo(232, 0);
					expect(bounds.height).toBeCloseTo(100, 0);
				}
				if (name === "motion-text") {
					expect(Math.abs(bounds.cx - 320)).toBeLessThan(2);
					expect(Math.abs(bounds.cy - 180)).toBeLessThan(2);
				} else {
					expect(bounds.cx).toBeCloseTo(320, 0);
					expect(bounds.cy).toBeCloseTo(180, 0);
				}
			}
		} else {
			test.info().annotations.push({
				type: "skip",
				description: "html-in-canvas 不可用（Chrome 149+ flag），仅断言渲染无异常",
			});
		}
	});
}

for (const [name, meta] of Object.entries(GSAP_FIXTURES_META)) {
	test(`GSAP 渲染链路：${name}（${meta.surface}）`, async ({ page }) => {
		const setOk = await page.evaluate(
			([componentId, surface, inputs, bundle, bundleHash]) =>
				(window as any).__recutHarness.setComponent({
					componentId,
					name: componentId,
					surface,
					inputs,
					bundle,
					bundleHash,
				}),
			[name, meta.surface, meta.inputs, gsapBundles[name].bundle, gsapBundles[name].bundleHash],
		);
		expect(setOk).toBe(true);

		const status = await page.evaluate(() => (window as any).__recutHarness.render(0.5, 5));
		expect(status.status).toBe("rendered");
		expect(status.surface).toBe(meta.surface);

		// 组件确实挂载了场景对象（非占位）
		const hasNode = await page.evaluate(() => (window as any).__recutHarness.hasNodeObject());
		expect(hasNode).toBe(true);

		// 画面确实有内容（非全背景）
		const sample = () =>
			page.evaluate(
				() => {
					const canvas = document.querySelector("canvas") as HTMLCanvasElement;
					const out = document.createElement("canvas");
					out.width = canvas.width;
					out.height = canvas.height;
					const ctx = out.getContext("2d");
					if (!ctx) return 0;
					ctx.drawImage(canvas, 0, 0);
					const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
					let bright = 0;
					for (let i = 0; i < data.length; i += 40) {
						if (data[i + 3] > 16 && (data[i] > 32 || data[i + 1] > 32 || data[i + 2] > 32)) bright += 1;
					}
					return bright;
				},
			);
		await expect.poll(sample, { timeout: 5000 }).toBeGreaterThan(0);

		// 确定性：同 t 渲染两次 → 采样像素完全一致（GSAP seek 是 t 的纯函数）
		const hash = () =>
			page.evaluate(() => {
				const canvas = document.querySelector("canvas") as HTMLCanvasElement;
				const out = document.createElement("canvas");
				out.width = canvas.width;
				out.height = canvas.height;
				const ctx = out.getContext("2d");
				if (!ctx) return "";
				ctx.drawImage(canvas, 0, 0);
				const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
				let h = 0;
				for (let i = 0; i < data.length; i += 4) h = (h + data[i] + data[i + 1] + data[i + 2] + data[i + 3]) % 1000000;
				return String(h);
			});
		await page.evaluate(() => (window as any).__recutHarness.render(0.25, 5));
		await page.waitForTimeout(50);
		const first = await hash();
		await page.evaluate(() => (window as any).__recutHarness.render(0.25, 5));
		await page.waitForTimeout(50);
		const second = await hash();
		expect(first).toBe(second);
	});
}

test("生产 WorldScene 接入 Motion Program：Three transform 随局部时间移动画面", async ({ page }) => {
	const meta = FIXTURES_META["pulse-cube"];
	await page.evaluate(
		([componentId, surface, inputs, bundle, bundleHash]) =>
			(window as any).__recutHarness.setComponent({
				componentId,
				name: componentId,
				surface,
				inputs,
				bundle,
				bundleHash,
				motionProgram: {
					schemaVersion: 1,
					durationSec: 1,
					mode: "once",
					tracks: [
						{
							target: { kind: "three", ref: "object:root" },
							path: "position.x",
							blend: "replace",
							keys: [{ at: 0, value: -120 }, { at: 1, value: 120 }],
						},
					],
				},
			}),
		["pulse-cube", meta.surface, meta.inputs, bundles["pulse-cube"].bundle, bundles["pulse-cube"].bundleHash],
	);
	const status = await page.evaluate(() => (window as any).__recutHarness.render(0, 5));
	expect(status.status).toBe("rendered");
	expect(await page.evaluate(() => (window as any).__recutHarness.hasNodeObject())).toBe(true);
	const atStart = await page.evaluate(() => (window as any).__recutHarness.getMotionTransform());
	await page.evaluate(() => (window as any).__recutHarness.render(2.5, 5));
	const atEnd = await page.evaluate(() => (window as any).__recutHarness.getMotionTransform());
	expect(atStart.x).toBeCloseTo(-120);
	expect(atEnd.x).toBeCloseTo(120);
	expect(atEnd.identity).toBe(atStart.identity);
});

test("生产预设 catalog：slide enter + loop pulse 编译为 Three tracks", async ({ page }) => {
	const meta = FIXTURES_META["pulse-cube"];
	await page.evaluate(
		([componentId, surface, inputs, bundle, bundleHash]) =>
			(window as any).__recutHarness.setComponent({
				componentId,
				name: componentId,
				surface,
				inputs,
				bundle,
				bundleHash,
				motion: {
					version: 1,
					enter: { presetId: "slide-left", presetVersion: "1.0.0", durationSec: 0.5 },
					loop: { presetId: "pulse", presetVersion: "1.0.0", durationSec: 1.2 },
				},
			}),
		["pulse-cube", meta.surface, meta.inputs, bundles["pulse-cube"].bundle, bundles["pulse-cube"].bundleHash],
	);
	const startStatus = await page.evaluate(() => (window as any).__recutHarness.render(0, 5));
	expect(startStatus.status, startStatus.error).toBe("rendered");
	await expect.poll(() => page.evaluate(() => (window as any).__recutHarness.hasNodeObject()), { timeout: 5000 }).toBe(true);
	const atStart = await page.evaluate(() => (window as any).__recutHarness.getMotionTransform());
	await page.evaluate(() => (window as any).__recutHarness.render(0.5, 5));
	const atEnterEnd = await page.evaluate(() => (window as any).__recutHarness.getMotionTransform());
	expect(atStart.x).toBeCloseTo(-320);
	expect(atEnterEnd.x).toBeCloseTo(0);
});

test("生产文本预设：grapheme text fade-up 通过 CanvasDrawElement seek", async ({ page }) => {
	const meta = FIXTURES_META["motion-text"];
	await page.evaluate(
		([componentId, surface, inputs, bundle, bundleHash]) =>
			(window as any).__recutHarness.setComponent({
				componentId,
				name: componentId,
				surface,
				inputs,
				bundle,
				bundleHash,
				textMotion: {
					presetId: "text-fade-up",
					presetVersion: "1.0.0",
					segment: { mode: "grapheme", staggerSec: 0.08 },
				},
			}),
		["motion-text", meta.surface, meta.inputs, bundles["motion-text"].bundle, bundles["motion-text"].bundleHash],
	);
	const status = await page.evaluate(() => (window as any).__recutHarness.render(0.35, 5));
	expect(status.status).toBe("rendered");
	await expect.poll(() => page.evaluate(() => (window as any).__recutHarness.countNonBackground(260, 120, 120, 120)), { timeout: 5000 }).toBeGreaterThan(0);
});

test("生产 HTML-in-Canvas 文本：grapheme targets 随 MotionProgram seek", async ({ page }) => {
	const meta = FIXTURES_META["motion-text"];
	await page.evaluate(
		([componentId, surface, inputs, bundle, bundleHash]) =>
			(window as any).__recutHarness.setComponent({
				componentId,
				name: componentId,
				surface,
				inputs,
				bundle,
				bundleHash,
				motionProgram: {
					schemaVersion: 1,
					durationSec: 1,
					mode: "once",
					tracks: [
						{
							target: { kind: "dom", ref: "text:g-0" },
							path: "x",
							blend: "replace",
							keys: [{ at: 0, value: -80 }, { at: 1, value: 0 }],
						},
						{
							target: { kind: "dom", ref: "text:g-0" },
							path: "opacity",
							blend: "replace",
							keys: [{ at: 0, value: 0 }, { at: 1, value: 1 }],
						},
					],
				},
			}),
		["motion-text", meta.surface, meta.inputs, bundles["motion-text"].bundle, bundles["motion-text"].bundleHash],
	);
	const status = await page.evaluate(() => (window as any).__recutHarness.render(0, 5));
	expect(status.status).toBe("rendered");
	if ((await page.evaluate(() => (window as any).__recutHarness.supported())).htmlInCanvas) {
		await expect.poll(() => page.evaluate(() => (window as any).__recutHarness.countNonBackground(280, 140, 80, 80)), { timeout: 5000 }).toBeGreaterThan(0);
	}
});

for (const componentId of ["html-badge", "react-pulse-card"]) {
	test(`内置组件封面：${componentId} 不会裁切为透明 PNG`, async ({ page }) => {
		const cover = await page.evaluate(
			(id) => (window as any).__recutHarness.captureBuiltinCover(id),
			componentId,
		);
		expect(cover).toMatch(/^data:image\/png;base64,/);

		const opaquePixels = await page.evaluate(async (dataUrl) => {
			const image = new Image();
			image.src = dataUrl;
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = image.width;
			canvas.height = image.height;
			const context = canvas.getContext("2d", { willReadFrequently: true });
			if (!context) return 0;
			context.drawImage(image, 0, 0);
			const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
			let count = 0;
			for (let offset = 3; offset < pixels.length; offset += 4) {
				if (pixels[offset] > 16) count += 1;
			}
			return count;
		}, cover);
		expect(opaquePixels).toBeGreaterThan(500);
	});
}

test("内置 3D 组件预览有画面且不显示源码栏", async ({ page }, testInfo) => {
	await openDemo(page);
	await page.getByRole("button", { name: /^(组件|Components)$/ }).click();
	const cards = page.locator('[draggable="false"]');
	await expect(cards).toHaveCount(7);
	await cards.nth(2).click();

	const dialog = page.getByRole("dialog");
	const canvas = dialog.locator("canvas");
	await expect(canvas).toBeVisible();
	expect((await canvas.boundingBox())?.width).toBeGreaterThan(640);
	await expect(dialog.getByText("源码", { exact: true })).toHaveCount(0);
	await expect
		.poll(async () =>
			canvas.evaluate((element) => {
				const canvas = element as HTMLCanvasElement;
				const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
				if (!gl) return 0;
				const pixels = new Uint8Array(canvas.width * canvas.height * 4);
				gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
				let bright = 0;
				for (let offset = 0; offset < pixels.length; offset += 4) {
					if (Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) > 32) bright += 1;
				}
				return bright;
			}),
			{ timeout: 8_000 },
		)
		.toBeGreaterThan(500);
	await dialog.screenshot({ path: testInfo.outputPath("component-preview-r3f.png") });
});
