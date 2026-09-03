import type { TextBackground } from "@/text/background";
import type {
	TextAlign,
	TextDecoration,
	TextFontStyle,
	TextFontWeight,
} from "@/text/primitives";
import type { CaptionChunk } from "@/transcription/types";

export interface SubtitlePlacementStyle {
	verticalAlign?: "top" | "middle" | "bottom";
	marginLeftRatio?: number;
	marginRightRatio?: number;
	marginVerticalRatio?: number;
}

export interface SubtitleStyleOverrides {
	/**
	 * Font size in app units (same coordinate space as TextElement.fontSize).
	 * Use fontSizeRatioOfPlayHeight when the source coordinate space is unknown
	 * (e.g. ASS files, where font size is relative to the script's play resolution).
	 */
	fontSize?: number;
	/**
	 * Font size expressed as a fraction of the reference canvas height.
	 * Set by the ASS parser so the builder can convert to app units without
	 * the parser needing to know about the app's coordinate system.
	 * Takes precedence over fontSize when both are present.
	 */
	fontSizeRatioOfPlayHeight?: number;
	fontFamily?: string;
	color?: string;
	background?: Pick<TextBackground, "enabled" | "color"> &
		Partial<Omit<TextBackground, "enabled" | "color">>;
	textAlign?: TextAlign;
	fontWeight?: TextFontWeight;
	fontStyle?: TextFontStyle;
	textDecoration?: TextDecoration;
	letterSpacing?: number;
	lineHeight?: number;
	stroke?: {
		enabled?: boolean;
		color?: string;
		width?: number;
	};
	placement?: SubtitlePlacementStyle;
}

export interface SubtitleCue extends CaptionChunk {
	style?: SubtitleStyleOverrides;
}

/**
 * 字幕轨对全局 transcript 素材的引用（项目只存引用，不复制 srt/json 字节）。
 * cue 由引用资产派生，可自由编辑；assetId 用于跨项目复用/重新物化。
 */
export interface CaptionSource {
	assetId: string;
	sourceAssetId?: string;
	model?: string;
	language?: string;
	generatedAt?: string;
}

export interface ParseSubtitleResult {
	captions: SubtitleCue[];
	skippedCueCount: number;
	warnings: string[];
}
