/**
 * [INPUT]: 依赖文本默认样式、编辑器时间线预览通道、Section 容器与 i18n。
 * [OUTPUT]: 对外提供 TextStylePresets；以 10 个小卡片网格提供文本样式预设。
 * [POS]: properties/components 的文本预设区，渲染在文本参数表单之上，点击即整体套用样式。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import type { CSSProperties } from "react";
import type { ParamValues } from "@/params";
import type { TextElement } from "@/timeline";
import { DEFAULTS } from "@/timeline/defaults";
import { Section, SectionHeader, SectionTitle } from "@/components/section";
import { t, useRecutLocale } from "@/i18n";
import { useEditor } from "@/editor/use-editor";
import type { I18nKey } from "@/i18n";

interface TextStylePreset {
	id: string;
	labelKey: I18nKey;
	overrides: ParamValues;
	sampleStyle: CSSProperties;
}

const SAMPLE_TEXT = "Aa字";

/** 预设覆盖的完整样式键集（不含 content / fontSize / transform / opacity / blendMode）。 */
const STYLE_PARAM_KEYS = [
	"fontFamily",
	"color",
	"textAlign",
	"fontWeight",
	"fontStyle",
	"textDecoration",
	"letterSpacing",
	"lineHeight",
	"background.enabled",
	"background.color",
	"background.cornerRadius",
	"background.paddingX",
	"background.paddingY",
	"background.offsetX",
	"background.offsetY",
	"stroke.enabled",
	"stroke.color",
	"stroke.width",
] as const;

function buildPresetParams(overrides: ParamValues): ParamValues {
	const base: ParamValues = {};
	for (const key of STYLE_PARAM_KEYS) {
		base[key] = DEFAULTS.text.element.params[key];
	}
	return { ...base, ...overrides };
}

const TEXT_PRESETS: TextStylePreset[] = [
	{
		id: "default",
		labelKey: "prop.textPreset.default",
		overrides: {},
		sampleStyle: { color: "#ffffff" },
	},
	{
		id: "classic-outline",
		labelKey: "prop.textPreset.classicOutline",
		overrides: {
			fontWeight: "bold",
			color: "#ffffff",
			"stroke.enabled": true,
			"stroke.color": "#000000",
			"stroke.width": 0.6,
		},
		sampleStyle: {
			color: "#ffffff",
			fontWeight: 700,
			WebkitTextStroke: "0.7px #000000",
			paintOrder: "stroke fill",
		},
	},
	{
		id: "yellow-pop",
		labelKey: "prop.textPreset.yellowPop",
		overrides: {
			fontWeight: "bold",
			color: "#ffdd00",
			"stroke.enabled": true,
			"stroke.color": "#000000",
			"stroke.width": 0.8,
		},
		sampleStyle: {
			color: "#ffdd00",
			fontWeight: 700,
			WebkitTextStroke: "0.9px #000000",
			paintOrder: "stroke fill",
		},
	},
	{
		id: "boxed",
		labelKey: "prop.textPreset.boxed",
		overrides: {
			color: "#ffffff",
			"background.enabled": true,
			"background.color": "#000000",
			"background.cornerRadius": 30,
		},
		sampleStyle: {
			color: "#ffffff",
			backgroundColor: "#000000",
			borderRadius: 4,
			padding: "1px 4px",
		},
	},
	{
		id: "inverse-box",
		labelKey: "prop.textPreset.inverseBox",
		overrides: {
			color: "#000000",
			"background.enabled": true,
			"background.color": "#ffffff",
			"background.cornerRadius": 30,
		},
		sampleStyle: {
			color: "#000000",
			backgroundColor: "#ffffff",
			borderRadius: 4,
			padding: "1px 4px",
		},
	},
	{
		id: "title-bold",
		labelKey: "prop.textPreset.titleBold",
		overrides: {
			fontWeight: "bold",
			color: "#ffffff",
			letterSpacing: 2,
			"stroke.enabled": true,
			"stroke.color": "#000000",
			"stroke.width": 0.4,
		},
		sampleStyle: {
			color: "#ffffff",
			fontWeight: 700,
			letterSpacing: 1,
			WebkitTextStroke: "0.5px #000000",
			paintOrder: "stroke fill",
		},
	},
	{
		id: "red-pop",
		labelKey: "prop.textPreset.redPop",
		overrides: {
			fontWeight: "bold",
			color: "#ff4d4d",
			"stroke.enabled": true,
			"stroke.color": "#ffffff",
			"stroke.width": 0.6,
		},
		sampleStyle: {
			color: "#ff4d4d",
			fontWeight: 700,
			WebkitTextStroke: "0.7px #ffffff",
			paintOrder: "stroke fill",
		},
	},
	{
		id: "neon-cyan",
		labelKey: "prop.textPreset.neonCyan",
		overrides: {
			fontWeight: "bold",
			color: "#00e5ff",
			letterSpacing: 1,
			"stroke.enabled": true,
			"stroke.color": "#003a4a",
			"stroke.width": 0.8,
		},
		sampleStyle: {
			color: "#00e5ff",
			fontWeight: 700,
			letterSpacing: 1,
			WebkitTextStroke: "0.8px #003a4a",
			paintOrder: "stroke fill",
		},
	},
	{
		id: "serif-elegant",
		labelKey: "prop.textPreset.serifElegant",
		overrides: {
			fontFamily: "Georgia",
			color: "#f5e9d0",
			"stroke.enabled": true,
			"stroke.color": "#2a1d10",
			"stroke.width": 0.4,
		},
		sampleStyle: {
			color: "#f5e9d0",
			fontFamily: "Georgia, serif",
			WebkitTextStroke: "0.5px #2a1d10",
			paintOrder: "stroke fill",
		},
	},
	{
		id: "mono-code",
		labelKey: "prop.textPreset.monoCode",
		overrides: {
			fontFamily: "Courier New",
			color: "#e2e8f0",
			"background.enabled": true,
			"background.color": "#1a1a1a",
			"background.cornerRadius": 12,
		},
		sampleStyle: {
			color: "#e2e8f0",
			fontFamily: "'Courier New', monospace",
			backgroundColor: "#1a1a1a",
			borderRadius: 3,
			padding: "1px 4px",
		},
	},
];

export function TextStylePresets({
	element,
	trackId,
}: {
	element: TextElement;
	trackId: string;
}) {
	const editor = useEditor();
	const locale = useRecutLocale();

	const applyPreset = (preset: TextStylePreset) => {
		editor.timeline.previewElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					updates: {
						params: {
							...element.params,
							...buildPresetParams(preset.overrides),
						},
					},
				},
			],
		});
		editor.timeline.commitPreview();
	};

	return (
		<Section collapsible sectionKey={`${element.id}:text-style-presets`}>
			<SectionHeader>
				<SectionTitle>{t(locale, "prop.text.stylePresets")}</SectionTitle>
			</SectionHeader>
			<div
				className="grid grid-cols-5 gap-1.5 px-3 pb-3"
				role="listbox"
				aria-label={t(locale, "prop.text.stylePresets")}
			>
				{TEXT_PRESETS.map((preset) => (
					<button
						key={preset.id}
						type="button"
						title={t(locale, preset.labelKey)}
						onClick={() => applyPreset(preset)}
						className="bg-muted/30 hover:bg-muted/60 flex h-14 min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-transparent px-1 transition-colors hover:border-border"
					>
						<span
							className="max-w-full truncate text-[11px] leading-none font-medium select-none"
							style={preset.sampleStyle}
						>
							{SAMPLE_TEXT}
						</span>
						<span className="text-foreground/50 w-full truncate text-center text-[9px] leading-none">
							{t(locale, preset.labelKey)}
						</span>
					</button>
				))}
			</div>
		</Section>
	);
}
