import type { Browser, BrowserType, Page } from "@playwright/test";
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * 统一浏览器启动：编辑器渲染 HTML-in-Canvas 组件（html/react surface 的 DOM→纹理
 * 捕获）依赖 Chromium 的 `CanvasDrawElement` 特性。不开启时捕获不到 DOM 内容，
 * 预览/封面/导出都会是纯黑画面。所有 e2e 调试与测试必须经此启动。
 */
export const CANVAS_DRAW_ELEMENT_FLAG = "--enable-features=CanvasDrawElement";

/** 启动带必需 flag 的 Chromium；headless 也适用。 */
export async function launchEditorBrowser(
	options: {
		headless?: boolean;
		args?: string[];
	} = {},
): Promise<Browser> {
	return chromium.launch({
		headless: options.headless ?? true,
		args: [
			"--use-gl=swiftshader",
			"--enable-unsafe-swiftshader",
			CANVAS_DRAW_ELEMENT_FLAG,
			...(options.args ?? []),
		],
	});
}

/** 断言当前浏览器已启用 CanvasDrawElement（captureElementImage 存在）。 */
export async function assertCanvasDrawElement(page: Page): Promise<void> {
	const enabled = await page.evaluate(
		() => typeof HTMLCanvasElement.prototype.captureElementImage === "function",
	);
	if (!enabled) {
		throw new Error(
			"CanvasDrawElement 未启用：编辑器 HTML-in-Canvas 组件渲染为黑屏。请用 launchEditorBrowser() 启动浏览器。",
		);
	}
}

export function closeTo(received: number, expected: number, tolerance = 2): boolean {
	return Math.abs(received - expected) <= tolerance;
}

export async function openDemo(
	page: Page,
	{ query = "test=1" } = {},
): Promise<void> {
	await page.goto(`/demo.html?${query}`);
	await page.waitForSelector("canvas[data-recut-canvas]", { timeout: 15_000 });
	await page.waitForFunction(
		() => (window as any).__recutTest?.getNodeBounds("demo-el-glow") != null,
		{ timeout: 15_000 },
	);
	await testGet(page, "setTime", 0);
	await testGet(page, "advanceFrame");
}

/** 调用 window.__recutTest 桥。 */
export async function testGet<T = any>(
	page: Page,
	method: string,
	...args: any[]
): Promise<T> {
	return page.evaluate(
		([name, rest]) => (window as any).__recutTest[name](...rest),
		[method, args],
	);
}

/** 等待一个交互后的渲染稳定。 */
export async function settle(page: Page): Promise<void> {
	await testGet(page, "advanceFrame");
	await page.waitForTimeout(80);
}

/** 当前画布显示缩放（canvas 像素 → 屏幕像素）。 */
export async function getDisplayScale(page: Page): Promise<number> {
	return page.evaluate(() => {
		const c = document.querySelector("canvas[data-recut-canvas]") as HTMLCanvasElement;
		return c.getBoundingClientRect().width / c.width;
	});
}

/* --- 字体 E2E 辅助 ------------------------------------------------------ */

const FIXTURE_FONT_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"fonts",
);

/**
 * 给 /v1/fonts/* 装一个本地 fixture mock：目录、@font-face css（重写到
 * /v1/fonts/google/{id}/{file}）、woff2 分片字节。同时把 fontsAPIBase 注入
 * window.__recutFontsAPIBase，让编辑器 demo 页走同源 mock。
 */
export async function installFontAPIMock(page: Page): Promise<void> {
	const inter400 = readFileSync(join(FIXTURE_FONT_DIR, "inter-400.woff2"));
	const nssc400 = readFileSync(
		join(FIXTURE_FONT_DIR, "noto-sans-sc-400.woff2"),
	);

	await page.addInitScript(() => {
		(window as any).__recutFontsAPIBase = window.location.origin;
	});

	await page.route("**/v1/fonts**", async (route) => {
		const url = new URL(route.request().url());
		const parts = url.pathname.split("/").filter(Boolean); // v1/fonts/google/{id}/...
		const [, , source, id, ...rest] = parts;
		if (source === "google") {
			const file = rest.join("/");
			// id → 真实 family 名（与 service catalog 一致）。
			const FAMILY_BY_ID: Record<string, string> = {
				inter: "Inter",
				"noto-sans-sc": "Noto Sans SC",
				"zcool-xiaowei": "ZCOOL XiaoWei",
			};
			const family = FAMILY_BY_ID[id] ?? id;
			if (file.endsWith("/css") || file === "css") {
				const familyFile = `${id}-400.woff2`;
				await route.fulfill({
					contentType: "text/css",
					body: `@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(/v1/fonts/google/${id}/${familyFile}) format('woff2');
  unicode-range: U+0000-00FF;
}`,
				});
				return;
			}
			// css 的 src 只引用 {id}-400.woff2 与 slice-*-400.woff2 两类 fixture。
			if (file === `${id}-400.woff2`) {
				const body =
					id.includes("noto-sans-sc") || id.includes("noto-serif") ? nssc400 : inter400;
				await route.fulfill({
					contentType: "font/woff2",
					headers: { "Access-Control-Allow-Origin": "*" },
					body,
				});
				return;
			}
			await route.fulfill({
				contentType: "font/woff2",
				headers: { "Access-Control-Allow-Origin": "*" },
				body: nssc400,
			});
			return;
		}
		if (source === "local") {
			if (!id || rest[0] === "content") {
				await route.fulfill({
					contentType: "application/json",
					body: "[]",
				});
				return;
			}
			await route.fulfill({
				contentType: "application/json",
				body: "[]",
			});
			return;
		}
		await route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({
				version: 1,
				sources: ["google", "local"],
				google: [
					{
						id: "inter",
						family: "Inter",
						category: "sans-serif",
						scripts: ["latin"],
						weights: [400, 700],
					},
					{
						id: "noto-sans-sc",
						family: "Noto Sans SC",
						category: "sans-serif",
						scripts: ["latin", "zh"],
						weights: [400, 700],
					},
					{
						id: "zcool-xiaowei",
						family: "ZCOOL XiaoWei",
						category: "serif",
						scripts: ["zh"],
						weights: [400],
					},
				],
				local: [],
			}),
		});
	});
}

/** 断言字体已注册且加载完成（检查 document.fonts 的 loaded face 列表）。 */
export async function assertFontRegistered(
	page: Page,
	family: string,
): Promise<boolean> {
	const loaded = (await testGet(page, "loadedFontFamilies")) as string[];
	return loaded.some(
		(entry) => entry.toLowerCase() === family.toLowerCase(),
	);
}

/** 等待字体加载完成并注册（轮询 loaded face 列表）。 */
export async function expectFontRegistered(
	page: Page,
	family: string,
	timeout = 8000,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (await assertFontRegistered(page, family)) return;
		await page.waitForTimeout(100);
	}
	throw new Error(
		`font "${family}" never loaded into document.fonts (loaded: ${JSON.stringify(
			await testGet(page, "loadedFontFamilies"),
		)})`,
	);
}

/**
 * 经测试桥加载一个字体并应用到文本元素（等价于面板选中字体后的完整路径：
 * loadFullFont + 写入 fontFamily 参数）。系统字体跳过加载（本机原生可用）。
 */
export async function applyFont(
	page: Page,
	elementId: string,
	family: string,
): Promise<void> {
	const SYSTEM = new Set([
		"Arial",
		"Helvetica",
		"Times New Roman",
		"Courier New",
		"Verdana",
		"Georgia",
		"monospace",
		"sans-serif",
		"serif",
		"PingFang SC",
		"Microsoft YaHei",
	]);
	if (!SYSTEM.has(family)) {
		await testGet(page, "loadFont", family);
	}
	await setTextParam(page, elementId, "fontFamily", family);
}

/** 设置文本元素的字符串参数（复用 __recutTest.setElementParam）。 */
export async function setTextParam(
	page: Page,
	elementId: string,
	key: string,
	value: string,
): Promise<void> {
	await testGet(page, "setElementParam", elementId, key, value);
	await settle(page);
	await settle(page);
}

/** 统计预览画布指定区域的非透明像素（文字存在性粗检）。 */
export async function countOpaquePixels(
	page: Page,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
): Promise<number> {
	return page.evaluate(
		([rx0, ry0, rx1, ry1]) => {
			const canvas = document.querySelector<HTMLCanvasElement>(
				"canvas[data-recut-canvas]",
			);
			if (!canvas) return 0;
			const image = new Image();
			image.src = canvas.toDataURL();
			return image.decode().then(() => {
				const snapshot = document.createElement("canvas");
				snapshot.width = canvas.width;
				snapshot.height = canvas.height;
				const context = snapshot.getContext("2d", {
					willReadFrequently: true,
				});
				if (!context) return 0;
				context.drawImage(image, 0, 0);
				const pixels = context.getImageData(
					0,
					0,
					snapshot.width,
					snapshot.height,
				).data;
				let count = 0;
				const width = snapshot.width;
				for (let y = ry0; y < ry1; y++) {
					for (let x = rx0; x < rx1; x++) {
						const offset = (y * width + x) * 4;
						if (pixels[offset + 3] > 16) count += 1;
					}
				}
				return count;
			});
		},
		[x0, y0, x1, y1],
	);
}

/** 统计整个预览画布的亮像素（白色文字字形）总量；WebGL toDataURL 全图不透明，须按亮度而非 alpha 计数。 */
export async function countCanvasOpaquePixels(page: Page): Promise<number> {
	return page.evaluate(() => {
		const canvas = document.querySelector<HTMLCanvasElement>(
			"canvas[data-recut-canvas]",
		);
		if (!canvas) return 0;
		return new Promise<number>((resolve) => {
			const image = new Image();
			image.src = canvas.toDataURL();
			image.onload = () => {
				const snapshot = document.createElement("canvas");
				snapshot.width = canvas.width;
				snapshot.height = canvas.height;
				const context = snapshot.getContext("2d", {
					willReadFrequently: true,
				});
				if (!context) return resolve(0);
				context.drawImage(image, 0, 0);
				const pixels = context.getImageData(
					0,
					0,
					snapshot.width,
					snapshot.height,
				).data;
				let count = 0;
				for (let offset = 0; offset < pixels.length; offset += 4) {
					const luma =
						pixels[offset] * 0.299 +
						pixels[offset + 1] * 0.587 +
						pixels[offset + 2] * 0.114;
					if (luma > 120) count += 1;
				}
				resolve(count);
			};
			image.onerror = () => resolve(0);
		});
	});
}
