/**
 * [INPUT]: 依赖 i18n 键、参数值与文本分组词表。
 * [OUTPUT]: 对外提供 TextPresetDef、TEXT_PRESETS 与文本样式预设的缩略预览样式。
 * [POS]: text 模块的原生文本样式目录；每个预设插入一个带完整样式的原生 text 元素。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { CSSProperties } from "react";
import type { ParamValues } from "@timeline/params";
import type { I18nKey } from "@timeline/i18n";
import type { TextGroupId } from "./groups";

export interface TextPresetDef {
	id: string;
	nameKey: I18nKey;
	group: TextGroupId;
	keywords?: string[];
	/** 插入时的示例文案（可含 \n 多行）。 */
	content: string;
	/** 覆盖 DEFAULTS.text.element.params 的样式参数（含 fontSize / boxWidth）。 */
	params: ParamValues;
}

export const TEXT_PRESETS: TextPresetDef[] = [
	// ── 标题 ─────────────────────────────────────────────
	{
		id: "title-hero",
		nameKey: "textLib.preset.titleHero",
		group: "title",
		keywords: ["title", "标题", "hero"],
		content: "大标题",
		params: {
			fontSize: 44,
			fontWeight: "bold",
			color: "#ffffff",
			lineHeight: 1.15,
			"stroke.enabled": true,
			"stroke.color": "#0b0f19",
			"stroke.width": 0.5,
		},
	},
	{
		id: "title-outline",
		nameKey: "textLib.preset.titleOutline",
		group: "title",
		keywords: ["title", "标题", "描边", "outline"],
		content: "描边标题",
		params: {
			fontSize: 40,
			fontWeight: "bold",
			color: "#ffffff",
			lineHeight: 1.15,
			"stroke.enabled": true,
			"stroke.color": "#000000",
			"stroke.width": 1,
		},
	},
	{
		id: "title-boxed",
		nameKey: "textLib.preset.titleBoxed",
		group: "title",
		keywords: ["title", "标题", "色块", "背景"],
		content: "色块标题",
		params: {
			fontSize: 30,
			fontWeight: "bold",
			color: "#ffffff",
			"background.enabled": true,
			"background.color": "#111827",
			"background.cornerRadius": 14,
			"background.paddingX": 36,
			"background.paddingY": 22,
		},
	},
	{
		id: "title-neon",
		nameKey: "textLib.preset.titleNeon",
		group: "title",
		keywords: ["title", "标题", "霓虹", "neon"],
		content: "霓虹标题",
		params: {
			fontSize: 40,
			fontWeight: "bold",
			color: "#00e5ff",
			letterSpacing: 2,
			"stroke.enabled": true,
			"stroke.color": "#003a4a",
			"stroke.width": 1,
		},
	},
	// ── 正文 ─────────────────────────────────────────────
	{
		id: "body-clean",
		nameKey: "textLib.preset.bodyClean",
		group: "body",
		keywords: ["body", "正文", "描述", "description"],
		content: "在这里输入正文描述，支持换行与自动排版。",
		params: {
			fontSize: 16,
			color: "#f8fafc",
			lineHeight: 1.4,
			boxWidth: 60,
		},
	},
	{
		id: "body-strong",
		nameKey: "textLib.preset.bodyStrong",
		group: "body",
		keywords: ["body", "正文", "强调", "strong"],
		content: "重点描述文字",
		params: {
			fontSize: 20,
			fontWeight: "bold",
			color: "#ffffff",
			"stroke.enabled": true,
			"stroke.color": "#000000",
			"stroke.width": 0.5,
		},
	},
	{
		id: "body-caption",
		nameKey: "textLib.preset.bodyCaption",
		group: "body",
		keywords: ["body", "字幕条", "caption", "条"],
		content: "底部说明文字",
		params: {
			fontSize: 18,
			color: "#ffffff",
			lineHeight: 1.3,
			"background.enabled": true,
			"background.color": "#000000bf",
			"background.cornerRadius": 24,
			"background.paddingX": 34,
			"background.paddingY": 20,
		},
	},
	{
		id: "body-mono",
		nameKey: "textLib.preset.bodyMono",
		group: "body",
		keywords: ["body", "等宽", "mono", "说明"],
		content: "// 技术说明或代码注释",
		params: {
			fontFamily: "Courier New",
			fontSize: 15,
			color: "#d1fae5",
			textAlign: "left",
			lineHeight: 1.4,
			"background.enabled": true,
			"background.color": "#0f172a",
			"background.cornerRadius": 8,
			"background.paddingX": 26,
			"background.paddingY": 16,
		},
	},
	// ── 引用 ─────────────────────────────────────────────
	{
		id: "quote-line",
		nameKey: "textLib.preset.quoteLine",
		group: "quote",
		keywords: ["quote", "引用", "引言"],
		content: "“真正的好剪辑，是让人忘记剪辑的存在。”\n—— 佚名",
		params: {
			fontSize: 22,
			fontStyle: "italic",
			color: "#f8fafc",
			lineHeight: 1.5,
			boxWidth: 64,
		},
	},
	{
		id: "quote-serif",
		nameKey: "textLib.preset.quoteSerif",
		group: "quote",
		keywords: ["quote", "引用", "衬线", "serif"],
		content: "好的画面自己会说话。\n—— 纪录片手记",
		params: {
			fontFamily: "Georgia",
			fontSize: 24,
			color: "#f5e9d0",
			lineHeight: 1.6,
			boxWidth: 64,
		},
	},
	// ── 标签 ─────────────────────────────────────────────
	{
		id: "label-solid",
		nameKey: "textLib.preset.labelSolid",
		group: "label",
		keywords: ["label", "标签", "徽章", "badge"],
		content: "NEW",
		params: {
			fontSize: 16,
			fontWeight: "bold",
			color: "#ffffff",
			letterSpacing: 1,
			"background.enabled": true,
			"background.color": "#ef4444",
			"background.cornerRadius": 40,
			"background.paddingX": 26,
			"background.paddingY": 14,
		},
	},
	{
		id: "label-outline",
		nameKey: "textLib.preset.labelOutline",
		group: "label",
		keywords: ["label", "标签", "描边", "胶囊"],
		content: "限时",
		params: {
			fontSize: 16,
			fontWeight: "bold",
			color: "#22d3ee",
			"background.enabled": true,
			"background.color": "#0f172a",
			"background.cornerRadius": 40,
			"background.paddingX": 26,
			"background.paddingY": 14,
		},
	},
	{
		id: "label-hashtag",
		nameKey: "textLib.preset.labelHashtag",
		group: "label",
		keywords: ["label", "标签", "话题", "hashtag"],
		content: "#视频剪辑 #技巧",
		params: {
			fontSize: 18,
			fontWeight: "bold",
			color: "#60a5fa",
		},
	},
	// ── 列表 ─────────────────────────────────────────────
	{
		id: "list-numbered",
		nameKey: "textLib.preset.listNumbered",
		group: "list",
		keywords: ["list", "列表", "编号", "numbered"],
		content: "01  第一步说明\n02  第二步说明\n03  第三步说明",
		params: {
			fontSize: 18,
			color: "#f8fafc",
			textAlign: "left",
			lineHeight: 1.8,
		},
	},
	{
		id: "list-bullet",
		nameKey: "textLib.preset.listBullet",
		group: "list",
		keywords: ["list", "列表", "要点", "bullet"],
		content: "• 核心要点一\n• 核心要点二\n• 核心要点三",
		params: {
			fontSize: 18,
			color: "#f8fafc",
			textAlign: "left",
			lineHeight: 1.8,
		},
	},
	// ── 标注 ─────────────────────────────────────────────
	{
		id: "annotation-arrow",
		nameKey: "textLib.preset.annotationArrow",
		group: "annotation",
		keywords: ["annotation", "标注", "箭头", "arrow"],
		content: "→ 关键细节",
		params: {
			fontSize: 20,
			fontWeight: "bold",
			color: "#facc15",
			"stroke.enabled": true,
			"stroke.color": "#000000",
			"stroke.width": 0.5,
		},
	},
	{
		id: "annotation-note",
		nameKey: "textLib.preset.annotationNote",
		group: "annotation",
		keywords: ["annotation", "提示", "说明", "note"],
		content: "提示：双击文字即可编辑",
		params: {
			fontSize: 15,
			color: "#e2e8f0",
			textAlign: "left",
			"background.enabled": true,
			"background.color": "#111827e6",
			"background.cornerRadius": 6,
			"background.paddingX": 20,
			"background.paddingY": 12,
		},
	},
];

function quoteFontFamily({ fontFamily }: { fontFamily: string }): string {
	return /\s/.test(fontFamily) && !fontFamily.includes(",")
		? `"${fontFamily}", sans-serif`
		: fontFamily;
}

/** 预设卡片的 CSS 缩略样式：把文本参数折算为小尺寸预览。 */
export function getTextPresetPreviewStyle({
	preset,
}: {
	preset: TextPresetDef;
}): CSSProperties {
	const params = preset.params;
	const style: CSSProperties = {};

	if (typeof params.color === "string") style.color = params.color;
	if (typeof params.fontFamily === "string") {
		style.fontFamily = quoteFontFamily({ fontFamily: params.fontFamily });
	}
	if (params.fontWeight === "bold") style.fontWeight = 700;
	if (params.fontStyle === "italic") style.fontStyle = "italic";
	if (typeof params.letterSpacing === "number") {
		style.letterSpacing = `${Math.min(2, Math.max(0, params.letterSpacing))}px`;
	}
	if (typeof params.lineHeight === "number") style.lineHeight = params.lineHeight;
	if (typeof params.textAlign === "string") {
		style.textAlign = params.textAlign as CSSProperties["textAlign"];
	}
	if (params["stroke.enabled"] === true) {
		const width = Number(params["stroke.width"] ?? 0.5);
		style.WebkitTextStroke = `${Math.min(1.2, Math.max(0.3, width))}px ${String(
			params["stroke.color"] ?? "#000000",
		)}`;
		style.paintOrder = "stroke fill";
	}
	if (params["background.enabled"] === true) {
		style.backgroundColor = String(params["background.color"] ?? "#000000");
		const radius = Number(params["background.cornerRadius"] ?? 0);
		style.borderRadius = `${Math.max(2, Math.min(12, radius * 0.4))}px`;
		const paddingX = Number(params["background.paddingX"] ?? 0);
		const paddingY = Number(params["background.paddingY"] ?? 0);
		style.padding = `${Math.max(1, Math.min(6, paddingY * 0.15))}px ${Math.max(
			2,
			Math.min(10, paddingX * 0.2),
		)}px`;
	}

	return style;
}

/** 预览文案：最多两行，避免小卡片溢出。 */
export function getTextPresetPreviewText({
	preset,
}: {
	preset: TextPresetDef;
}): string {
	const lines = preset.content.split("\n").slice(0, 2);
	return lines.join("\n");
}
