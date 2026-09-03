import type { I18nKey } from "@/i18n";

export const BACKGROUND_BLUR_INTENSITY_PRESETS: Array<{
	label: string;
	labelKey: I18nKey;
	value: number;
}> = [
	{ label: "Light", labelKey: "settings.bg.blurLight", value: 100 },
	{ label: "Medium", labelKey: "settings.bg.blurMedium", value: 200 },
	{ label: "Heavy", labelKey: "settings.bg.blurHeavy", value: 500 },
] as const;

export const DEFAULT_BACKGROUND_BLUR_INTENSITY = 10;
