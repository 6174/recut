import { test, expect } from "@playwright/test";
import { openDemo, testGet } from "./helpers";

/**
 * 特效预览回归：
 * 1. 素材面板「特效」分类点击卡片 → 对话框预览必须有可见内容。
 *    后处理特效采样底层场景纹理，预览世界若无底图内容（案例内容：渐变底图 + 文字 + 形状），
 *    玻璃/放大镜/CRT 等只能作用在纯色背景上 → 预览接近空白。此测试锁定底图 + 特效都出图。
 * 2. 时间线添加特效（案例内容铺满为底图）→ 预览画布必须发生超过噪声底的像素变化。
 *
 * 阈值来源：swiftshader 下 27 个特效全量校准（2026-08-22）：
 * - 对话框：与纯色背景的平均像素差 252–443（修复前 0–21）→ 断言 > 100。
 * - 时间线：相对基线平均差见 TIMELINE_DIFF_THRESHOLD（约校准值的 40%，噪声底 ~3）。
 */

const EFFECT_IDS = [
	"effect.glass",
	"effect.magnify",
	"effect.frost",
	"effect.glitch",
	"effect.crt",
	"effect.vintage",
	"effect.vhs",
	"effect.bubble",
	"effect.displacement",
	"effect.droplets",
	"effect.asciify",
	"effect.retro-dither",
	"effect.ripple",
	"effect.text-focus",
	"effect.article-highlight",
	"effect.decrypt-reveal",
	"effect.particle-reveal",
	"effect.bend",
	"effect.cloth",
	"effect.store-peel",
	"effect.clouds",
	"effect.grid",
	"effect.liquid",
	"effect.glyph-rain",
	"effect.laser",
	"effect.blaze",
	"effect.particle-scroll",
];

/**
 * 时间线隔离断言排除项：粒子漂浮是稀疏微光，平均差落在渲染噪声带内
 * （校准：diff 2.9 vs 噪声底 ~3），无法稳定区分「特效生效」与「噪声」。
 * 其可见性由对话框预览测试（底图内容 + 粒子出图）覆盖。
 */
const TIMELINE_EXCLUDED = new Set(["effect.particle-scroll"]);

/** 特效库卡片 label（= 组件 name）。 */
const CARD_TITLE_BY_ID: Record<string, string> = {
	"effect.glass": "Glass 玻璃",
	"effect.magnify": "Magnify 放大镜",
	"effect.frost": "Frost 霜玻璃",
	"effect.glitch": "Glitch 故障",
	"effect.crt": "CRT 显像管",
	"effect.vintage": "Vintage 复古",
	"effect.vhs": "VHS 录像带",
	"effect.bubble": "Bubble 气泡",
	"effect.displacement": "Displacement 位移",
	"effect.droplets": "Droplets 雨滴",
	"effect.asciify": "Asciify 字符化",
	"effect.retro-dither": "Dither 抖动",
	"effect.ripple": "Ripple 涟漪",
	"effect.text-focus": "Text Focus 焦点",
	"effect.article-highlight": "Highlight 高亮",
	"effect.decrypt-reveal": "Decrypt 解密",
	"effect.particle-reveal": "Particles 粒子",
	"effect.bend": "Bend 卷曲",
	"effect.cloth": "Cloth 布料",
	"effect.store-peel": "Peel 撕页",
	"effect.clouds": "Clouds 云雾",
	"effect.grid": "Grid 网格",
	"effect.liquid": "Liquid 液态",
	"effect.glyph-rain": "Glyph Rain 字符雨",
	"effect.laser": "Laser 激光",
	"effect.blaze": "Blaze 烈焰",
	"effect.particle-scroll": "Particles 漂浮",
};

/**
 * 预览画布降采样采样（64×36 RGB 网格）：
 * - flatDiff：与纯色背景 #101014（sRGB ≈ 16,16,20）的平均像素差 —— 内容是否存在；
 * - baselineDiff 由 Node 侧与基线网格比较。
 */
const SAMPLE_JS = (selector: string) => `(() => {
	const c = document.querySelector(${JSON.stringify(selector)});
	if (!c) return null;
	const s = document.createElement("canvas");
	s.width = c.width;
	s.height = c.height;
	const ctx = s.getContext("2d", { willReadFrequently: true });
	ctx.drawImage(c, 0, 0);
	const d = ctx.getImageData(0, 0, s.width, s.height).data;
	const gw = 64, gh = 36;
	const grid = new Float32Array(gw * gh * 3);
	for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
		const x = Math.min(s.width - 1, Math.floor(((gx + 0.5) * s.width) / gw));
		const y = Math.min(s.height - 1, Math.floor(((gy + 0.5) * s.height) / gh));
		const o = (y * s.width + x) * 4, g = (gy * gw + gx) * 3;
		grid[g] = d[o]; grid[g + 1] = d[o + 1]; grid[g + 2] = d[o + 2];
	}
	return Array.from(grid);
})()`;

async function sampleCanvas(
	page: import("@playwright/test").Page,
	selector: string,
): Promise<number[] | null> {
	return page.evaluate(SAMPLE_JS(selector));
}

function flatDiff(grid: number[] | null): number {
	if (!grid) return -1;
	let sum = 0;
	for (let i = 0; i < grid.length; i += 3) {
		sum +=
			Math.abs(grid[i] - 16) +
			Math.abs(grid[i + 1] - 16) +
			Math.abs(grid[i + 2] - 20);
	}
	return sum / (grid.length / 3);
}

function gridDiff(a: number[] | null, b: number[] | null): number {
	if (!a || !b) return -1;
	const n = Math.min(a.length, b.length);
	let sum = 0;
	for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
	return sum / (n / 3);
}

/**
 * 时间线断言阈值（swiftshader 校准值的 ~40%）。
 * glass / magnify 默认作用区（中心）在平滑渐变上无高频细节，必须对准文字内容（见下）。
 */
const TIMELINE_DIFF_THRESHOLD: Record<string, number> = {
	"effect.glass": 10, // 对准文字后校准 ~16.7（静态场景噪声底 0）
	"effect.magnify": 10, // 对准文字后校准 ~15.9
	"effect.frost": 25,
	"effect.glitch": 6,
	"effect.crt": 20,
	"effect.vintage": 30,
	"effect.vhs": 6,
	"effect.bubble": 6,
	"effect.displacement": 9,
	"effect.droplets": 6,
	"effect.asciify": 6,
	"effect.retro-dither": 28,
	"effect.ripple": 10,
	"effect.text-focus": 24,
	"effect.article-highlight": 18,
	"effect.decrypt-reveal": 6,
	"effect.particle-reveal": 6,
	"effect.bend": 9,
	"effect.cloth": 6,
	"effect.store-peel": 6,
	"effect.clouds": 3,
	"effect.grid": 6,
	"effect.liquid": 55,
	"effect.glyph-rain": 12,
	"effect.laser": 3.5,
	"effect.blaze": 40,
};

/**
 * 局部特效默认作用区对准案例文字：demo 文字位于屏幕上方 27% 处；
 * 特效 UV 原点在左下角（vUv，同 remotion-kit 材质语义）→ 从下计 0.73。
 */
const TIMELINE_PARAMS_BY_ID: Record<string, Record<string, number>> = {
	"effect.glass": { centerX: 0.5, centerY: 0.73, half: 240 },
	"effect.magnify": { centerX: 0.5, centerY: 0.73, radius: 220 },
};

test.describe("特效预览", () => {
	test("素材面板特效卡片点击后对话框预览有可见内容（底图案例 + 特效出图）", async ({
		page,
	}) => {
		test.setTimeout(600_000);
		await openDemo(page);
		await testGet(page, "setAssetsPanelTab", "effects");
		await page.waitForTimeout(500);

		const failures: string[] = [];
		for (const id of EFFECT_IDS) {
			const title = CARD_TITLE_BY_ID[id];
			try {
				await page.locator(`[title="${title}"]`).first().click({ timeout: 8_000 });
				await page.waitForSelector("[role=dialog] canvas", { timeout: 8_000 });
				// 时间循环 + 底图纹理捕获稳定后，内容必须可见（与纯色背景的平均差 > 100）。
				await page.waitForFunction(
					`(() => {
						const grid = (${SAMPLE_JS("[role=dialog] canvas")});
						if (!grid) return false;
						let s = 0;
						for (let i = 0; i < grid.length; i += 3) {
							s += Math.abs(grid[i] - 16) + Math.abs(grid[i + 1] - 16) + Math.abs(grid[i + 2] - 20);
						}
						return s / (grid.length / 3) > 100;
					})()`,
					undefined,
					{ timeout: 15_000 },
				);
			} catch (error) {
				failures.push(`${id}（${title}）: ${String(error).slice(0, 120)}`);
			} finally {
				await page.keyboard.press("Escape");
				await page.waitForTimeout(300);
			}
		}
		expect(failures, `以下特效对话框预览不可见:\n${failures.join("\n")}`).toEqual([]);
	});

	test("时间线添加特效后预览画布发生可见变化（案例内容铺满为底图）", async ({
		page,
	}) => {
		test.setTimeout(600_000);
		await openDemo(page);
		await testGet(page, "setTime", 2);

		// 案例内容铺满画布：demo 渐变底图放大为全画布背景（特效背后始终有内容）。
		await testGet(page, "setElementParam", "demo-el-image", "transform.scaleX", 3.5);
		await testGet(page, "setElementParam", "demo-el-image", "transform.scaleY", 3.5);
		await testGet(page, "setElementParam", "demo-el-image", "transform.positionX", 0);
		await testGet(page, "setElementParam", "demo-el-image", "transform.positionY", 0);
		// demo 视频的源仅 2s（元素 5s）：t=2 恰为源结束，纹理会被清空，
		// 引入与特效无关的像素漂移 —— 移除，让场景完全静态（噪声底 = 0）。
		await testGet(page, "deleteElement", "demo-el-video");
		await testGet(page, "advanceFrame");

		// 等底图纹理就绪（全屏亮色渐变，亮度显著高于深色空态）。
		await page.waitForFunction(
			() => {
				const c = document.querySelector(
					"canvas[data-recut-canvas]",
				) as HTMLCanvasElement | null;
				if (!c) return false;
				const s = document.createElement("canvas");
				s.width = c.width;
				s.height = c.height;
				const ctx = s.getContext("2d", { willReadFrequently: true });
				if (!ctx) return false;
				ctx.drawImage(c, 0, 0);
				const d = ctx.getImageData(0, 0, s.width, s.height).data;
				let sum = 0;
				for (let i = 0; i < d.length; i += 4 * 61) sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
				return sum / (d.length / 4 / 61) > 80;
			},
			undefined,
			{ timeout: 15_000 },
		);
		await testGet(page, "advanceFrame");
		await page.waitForTimeout(800);

		const baseline = await sampleCanvas(page, "canvas[data-recut-canvas]");
		expect(baseline).not.toBeNull();

		const failures: string[] = [];
		for (const id of EFFECT_IDS) {
			if (TIMELINE_EXCLUDED.has(id)) continue;
			const params = TIMELINE_PARAMS_BY_ID[id];
			const threshold = TIMELINE_DIFF_THRESHOLD[id];
			const elementId = await testGet<string>(
				page,
				"addComponentElement",
				id,
				0,
				params,
			);
			await testGet(page, "advanceFrame");
			await page.waitForTimeout(1_200);
			const after = await sampleCanvas(page, "canvas[data-recut-canvas]");
			const d = gridDiff(baseline, after);
			if (!(d > threshold)) {
				failures.push(`${id}: diff=${d.toFixed(1)} ≤ ${threshold}`);
			}
			await testGet(page, "deleteElement", elementId);
			await testGet(page, "advanceFrame");
			await page.waitForTimeout(400);
		}
		expect(failures, `以下特效加入时间线后预览无可测变化:\n${failures.join("\n")}`).toEqual([]);
	});
});
