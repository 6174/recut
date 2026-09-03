import type { FontAtlas } from "@/fonts/types";
import { SYSTEM_FONTS } from "@/fonts/system-fonts";
import { assetPath } from "@/utils/base-path";

const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com/css2";
const FONT_ATLAS_PATH = assetPath("/fonts/font-atlas.json");
const FONT_CHUNK_PATH_PREFIX = assetPath("/fonts/font-chunk-");

const fullLoaded = new Set<string>();

let cachedAtlas: FontAtlas | null = null;
let atlasFetchPromise: Promise<FontAtlas | null> | null = null;

/**
 * 字体 API 基址：嵌入宿主时用 service 同源（/v1/fonts*）；无宿主 demo/测试页
 * 通过 window.__recutTest.fontsAPIBase 注入。与 recut.sdk 的 media content URL
 * 同源约定保持一致。
 */
export function fontsAPIBase(): string {
	const seam = (window as Window & {
		__recutTest?: { fontsAPIBase?: string };
		__recutFontsAPIBase?: string;
	}).__recutFontsAPIBase;
	if (seam) return seam;
	const bridge = (window as Window & {
		__recutTest?: { fontsAPIBase?: string };
	}).__recutTest?.fontsAPIBase;
	return bridge || window.location.origin;
}

/** 家族名 → 目录 id（kebab-case，与 cdn/scripts/fetch-fonts.mjs slugify 一致）。 */
export function fontFamilyToID(family: string): string {
	return family
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function getCachedFontAtlas(): FontAtlas | null {
	return cachedAtlas;
}

export function clearFontAtlasCache(): void {
	cachedAtlas = null;
	atlasFetchPromise = null;
	fullLoaded.clear();
}

export function loadFontAtlas(): Promise<FontAtlas | null> {
	if (cachedAtlas) return Promise.resolve(cachedAtlas);
	if (atlasFetchPromise) return atlasFetchPromise;

	atlasFetchPromise = fetch(FONT_ATLAS_PATH)
		.then(async (response) => {
			if (!response.ok) return null;
			const data: FontAtlas = await response.json();
			cachedAtlas = data;
			preloadChunkImages({ atlas: data });
			return data;
		})
		.catch(() => null);

	return atlasFetchPromise;
}

function preloadChunkImages({ atlas }: { atlas: FontAtlas }): void {
	const maxChunk = Math.max(
		...Object.values(atlas.fonts).map((entry) => entry.ch),
	);
	for (let i = 0; i <= maxChunk; i++) {
		// hint browser to preload chunk images without blocking
		const img = new Image();
		img.src = `${FONT_CHUNK_PATH_PREFIX}${i}.avif`;
	}
}

/**
 * 加载一个 Google 家族的真字重。优先走本地 service 的自托管 /v1/fonts（首次
 * 从 Recut 自有 CDN 抓取并缓存，离线可用）；service 不可用时回退 Google CDN
 * CSS（旧路径，仅兜底）。
 */
export async function loadFullFont({
	family,
	weights = [400, 700],
}: {
	family: string;
	weights?: number[];
}): Promise<void> {
	if (fullLoaded.has(family)) return;

	const base = fontsAPIBase();
	const id = fontFamilyToID(family);
	const cssURL = `${base}/v1/fonts/google/${encodeURIComponent(id)}/css`;
	const cssLink = `${GOOGLE_FONTS_CSS}?family=${family.replace(
		/ /g,
		"+",
	)}:wght@${weights.join(";")}&display=swap`;

	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = cssURL;
	document.head.appendChild(link);
	await new Promise<void>((resolve) => {
		link.addEventListener("load", () => resolve(), { once: true });
		link.addEventListener("error", () => resolve(), { once: true });
	});
	try {
		await Promise.all(
			weights.map((weight) =>
				document.fonts.load(`${weight} 16px "${family.replace(/"/g, '\\"')}"`),
			),
		);
	} catch {
		// fall through: font may render as fallback
	}

	// Service css is served with a long cache header; if the document-level
	// fetch failed (service offline / unknown family), retry against Google CSS
	// as a last resort so existing projects keep rendering.
	const serviceLoaded = await Promise.all(
		weights.map((weight) =>
			document.fonts.check(`${weight} 16px "${family.replace(/"/g, '\\"')}"`),
		),
	);
	if (!serviceLoaded.every(Boolean)) {
		const fallbackLink = document.createElement("link");
		fallbackLink.rel = "stylesheet";
		fallbackLink.href = cssLink;
		document.head.appendChild(fallbackLink);
		await new Promise<void>((resolve) => {
			fallbackLink.addEventListener("load", () => resolve(), { once: true });
			fallbackLink.addEventListener("error", () => resolve(), { once: true });
		});
		try {
			await Promise.all(
				weights.map((weight) =>
					document.fonts.load(
						`${weight} 16px "${family.replace(/"/g, '\\"')}"`,
					),
				),
			);
		} catch {
			// ignore
		}
	}
	fullLoaded.add(family);
}

export async function loadFonts({
	families,
}: {
	families: string[];
}): Promise<void> {
	const googleFonts = families.filter(
		(family) => !SYSTEM_FONTS.has(family),
	);
	await Promise.all(googleFonts.map((family) => loadFullFont({ family })));
}

/**
 * 按来源回灌项目用到的字体：system 家族跳过（本机可用）；upload 家族从 service
 * 读字节注册到 document.fonts；其余走 Google 自托管 css。
 */
export async function loadFontsBySource({
	families,
	uploaded,
}: {
	families: string[];
	uploaded: Map<string, string>;
}): Promise<void> {
	const tasks: Promise<void>[] = [];
	for (const family of families) {
		if (SYSTEM_FONTS.has(family)) continue;
		const uploadedId = uploaded.get(family);
		if (uploadedId) {
			const { registerUploadedFont } = await import(
				"@/fonts/service-catalog"
			);
			tasks.push(registerUploadedFont(family, uploadedId));
			continue;
		}
		tasks.push(loadFullFont({ family }));
	}
	await Promise.all(tasks);
}