import { assetPath } from "@/utils/base-path";
import type { AudioLibraryCatalog } from "@/audio-library/types";

/**
 * 音频库 catalog 来源：优先 CDN（https://cdn.recut.video/audio/catalog.json），
 * 本地打包回退（ui/public/audio/catalog.json，用于离线/开发）。
 */
const CDN_CATALOG_URL = "https://cdn.recut.video/audio/catalog.json";
const LOCAL_CATALOG_URL = assetPath("/audio/catalog.json");

let cachedCatalog: AudioLibraryCatalog | null = null;
let inFlight: Promise<AudioLibraryCatalog> | null = null;

/** 返回资源绝对 URL：CDN 绝对地址，本地 assetPath 兜底。 */
export function audioAssetUrl(url: string): string {
	const clean = url.replace(/^\//, "");
	if (/^https?:\/\//.test(clean)) return clean;
	return `https://cdn.recut.video/${clean}`;
}

async function fetchCatalog(url: string): Promise<AudioLibraryCatalog | null> {
	try {
		const response = await fetch(url);
		if (!response.ok) return null;
		const catalog = (await response.json()) as AudioLibraryCatalog;
		catalog.music = catalog.music.map((item) => ({ ...item, kind: "music" }));
		catalog.sfx = catalog.sfx.map((item) => ({ ...item, kind: "sfx" }));
		return catalog;
	} catch {
		return null;
	}
}

export async function loadAudioCatalog(): Promise<AudioLibraryCatalog> {
	if (cachedCatalog) return cachedCatalog;
	if (inFlight) return inFlight;

	inFlight = (async () => {
		// 优先 CDN，失败回退本地打包 catalog。
		const catalog =
			(await fetchCatalog(CDN_CATALOG_URL)) ??
			(await fetchCatalog(LOCAL_CATALOG_URL));
		if (!catalog) {
			throw new Error("Failed to load audio catalog");
		}
		cachedCatalog = catalog;
		return catalog;
	})();

	try {
		return await inFlight;
	} finally {
		inFlight = null;
	}
}
