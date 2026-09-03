import type { NormalizedCubicBezier } from "@/animation/types";
import type { I18nKey } from "@/i18n";

export const PRESET_MATCH_TOLERANCE = 0.02;

export interface EasingPreset {
	id: string;
	label: string;
	labelKey?: I18nKey;
	value: NormalizedCubicBezier;
	isCustom?: boolean;
}

export const BUILTIN_PRESETS: EasingPreset[] = [
	{ id: "smooth", label: "Smooth", labelKey: "graph.easing.smooth", value: [0.25, 0.1, 0.25, 1] },
	{ id: "ease-out", label: "Ease out", labelKey: "graph.easing.easeOut", value: [0, 0, 0.2, 1] },
	{ id: "ease-in", label: "Ease in", labelKey: "graph.easing.easeIn", value: [0.8, 0, 1, 1] },
	{ id: "ease-in-out", label: "In out", labelKey: "graph.easing.inOut", value: [0.4, 0, 0.2, 1] },
	{ id: "pop", label: "Pop", labelKey: "graph.easing.pop", value: [0.175, 0.885, 0.32, 1.275] },
	{ id: "linear", label: "Linear", labelKey: "graph.easing.linear", value: [0, 0, 1, 1] },
];
