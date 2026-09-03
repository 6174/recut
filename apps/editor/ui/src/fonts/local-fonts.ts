import { SYSTEM_FONTS } from "@/fonts/system-fonts";

export interface InstalledFont {
	family: string;
	weight: number;
	style: string;
	fullName: string;
	postscriptName: string;
	/** 枚举来源：queryLocalFonts 或 document.fonts.check 探测 */
	source: "queryLocalFonts" | "probe";
}

type QueryLocalFonts = () => Promise<
	{
		family: string;
		weight: string;
		style: string;
		fullName: string;
		postscriptName: string;
	}[]
>;

declare global {
	interface Window {
		queryLocalFonts?: QueryLocalFonts;
	}
}

/** 本机已装字体缓存（一次授权/一次探测即可）。 */
let cachedInstalled: InstalledFont[] | null = null;
let cachedSource: "queryLocalFonts" | "probe" | null = null;

export function hasLocalFontsAPI(): boolean {
	return typeof window.queryLocalFonts === "function";
}

/**
 * 枚举本机已装字体。优先 Chromium 桌面独有 API queryLocalFonts()（Local Font
 * Access）；不可用/未授权时回退到 document.fonts.check 探测常用候选清单
 * （含 SYSTEM_FONTS 中的中文字体）。结果会话内缓存。
 */
export async function listInstalledFonts(): Promise<InstalledFont[]> {
	if (cachedInstalled) return cachedInstalled;

	if (typeof window.queryLocalFonts === "function") {
		try {
			const entries = await window.queryLocalFonts();
			cachedInstalled = entries.map((entry) => ({
				family: entry.family,
				weight: Number.parseInt(entry.weight, 10) || 400,
				style: entry.style,
				fullName: entry.fullName,
				postscriptName: entry.postscriptName,
				source: "queryLocalFonts" as const,
			}));
			cachedSource = "queryLocalFonts";
			return cachedInstalled;
		} catch {
			// 用户拒绝授权或 API 异常 → 探测兜底
		}
	}

	cachedInstalled = await probeInstalledFonts();
	cachedSource = "probe";
	return cachedInstalled;
}

export function getInstalledFontsSource():
	| "queryLocalFonts"
	| "probe"
	| null {
	return cachedSource;
}

/**
 * 探测兜底：对一份跨平台候选清单逐一用 document.fonts.check 判断本机是否可用。
 * 候选 = SYSTEM_FONTS + 常见 Google CJK 家族名（本地安装场景）。
 */
const PROBE_CANDIDATES = new Set([
	...SYSTEM_FONTS,
	"Noto Sans SC",
	"Noto Serif SC",
	"Noto Sans CJK SC",
	"Noto Serif CJK SC",
	"Source Han Sans CN",
	"Source Han Serif CN",
	"思源黑体",
	"思源宋体",
	"FZSong",
	"FZHei",
	"方正书宋",
]);

async function probeInstalledFonts(): Promise<InstalledFont[]> {
	const installed: InstalledFont[] = [];
	for (const family of PROBE_CANDIDATES) {
		const available = document.fonts.check(`400 16px "${family}"`);
		if (available) {
			installed.push({
				family,
				weight: 400,
				style: "normal",
				fullName: family,
				postscriptName: family,
				source: "probe",
			});
		}
	}
	return installed;
}

export function clearInstalledFontsCache(): void {
	cachedInstalled = null;
	cachedSource = null;
}
