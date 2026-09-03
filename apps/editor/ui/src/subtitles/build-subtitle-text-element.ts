import { FONT_SIZE_SCALE_REFERENCE } from "@/text/typography";
import { DEFAULTS } from "@/timeline/defaults";
import { addMediaTime, mediaTimeFromSeconds, ZERO_MEDIA_TIME } from "@/wasm";
import type { CreateTextElement } from "@/timeline";
import type { ParamValues } from "@/params";
import type { TextBackground } from "@/text/background";
import type {
	TextAlign,
	TextDecoration,
	TextFontStyle,
	TextFontWeight,
} from "@/text/primitives";
import type { SubtitleCue, SubtitleStyleOverrides } from "./types";
import type { SubtitlePlacementStyle } from "./types";
import type { MediaTime } from "@/wasm";
import {
	SUBTITLE_BOTTOM_MARGIN_RATIO,
	SUBTITLE_FONT_SIZE,
	buildSubtitleParams,
} from "./layout";

function resolveSubtitleStyle({
	style,
	baseStyle,
	basePlacement,
}: {
	style: SubtitleStyleOverrides | undefined;
	baseStyle: ParamValues | undefined;
	basePlacement: SubtitlePlacementStyle | undefined;
}): { styleParams: ParamValues; placement: SubtitlePlacementStyle } {
	const defaults = DEFAULTS.text.element.params;
	const { content: _ignored, ...styleDefaults } = defaults;
	const backgroundDefaults = DEFAULTS.text.background;

	const background = (style?.background ?? {}) as Partial<TextBackground>;
	const baseBackgroundColor = baseStyle?.["background.color"];

	const fontSize =
		style?.fontSizeRatioOfPlayHeight != null
			? style.fontSizeRatioOfPlayHeight * FONT_SIZE_SCALE_REFERENCE
			: (style?.fontSize ?? baseStyle?.fontSize ?? SUBTITLE_FONT_SIZE);

	const styleParams: ParamValues = {
		...styleDefaults,
		...(baseStyle ?? {}),
		fontSize,
		...(style?.fontFamily ? { fontFamily: style.fontFamily } : {}),
		...(style?.color ? { color: style.color } : {}),
		...(style?.textAlign ? { textAlign: style.textAlign } : {}),
		...(style?.fontWeight ? { fontWeight: style.fontWeight } : {}),
		...(style?.fontStyle ? { fontStyle: style.fontStyle } : {}),
		...(style?.textDecoration
			? { textDecoration: style.textDecoration }
			: {}),
		...(style?.letterSpacing !== undefined
			? { letterSpacing: style.letterSpacing }
			: {}),
		...(style?.lineHeight !== undefined
			? { lineHeight: style.lineHeight }
			: {}),
		"stroke.enabled":
			style?.stroke?.enabled ??
			baseStyle?.["stroke.enabled"] ??
			true,
		"stroke.color":
			style?.stroke?.color ??
			(typeof baseStyle?.["stroke.color"] === "string"
				? (baseStyle["stroke.color"] as string)
				: DEFAULTS.text.stroke.color),
		"stroke.width":
			style?.stroke?.width ??
			baseStyle?.["stroke.width"] ??
			DEFAULTS.text.stroke.width,
		"background.enabled":
			background.enabled ??
			baseStyle?.["background.enabled"] ??
			styleDefaults["background.enabled"],
		"background.color":
			background.color ??
			(typeof baseBackgroundColor === "string"
				? baseBackgroundColor
				: backgroundDefaults.color),
		"background.cornerRadius":
			background.cornerRadius ??
			baseStyle?.["background.cornerRadius"] ??
			backgroundDefaults.cornerRadius,
		"background.paddingX":
			background.paddingX ??
			baseStyle?.["background.paddingX"] ??
			backgroundDefaults.paddingX,
		"background.paddingY":
			background.paddingY ??
			baseStyle?.["background.paddingY"] ??
			backgroundDefaults.paddingY,
		"background.offsetX":
			background.offsetX ??
			baseStyle?.["background.offsetX"] ??
			backgroundDefaults.offsetX,
		"background.offsetY":
			background.offsetY ??
			baseStyle?.["background.offsetY"] ??
			backgroundDefaults.offsetY,
	};

	const placement: SubtitlePlacementStyle = {
		verticalAlign:
			style?.placement?.verticalAlign ??
			basePlacement?.verticalAlign ??
			"bottom",
		marginLeftRatio:
			style?.placement?.marginLeftRatio ??
			basePlacement?.marginLeftRatio,
		marginRightRatio:
			style?.placement?.marginRightRatio ??
			basePlacement?.marginRightRatio,
		marginVerticalRatio:
			style?.placement?.marginVerticalRatio ??
			basePlacement?.marginVerticalRatio ??
			SUBTITLE_BOTTOM_MARGIN_RATIO,
	};

	return { styleParams, placement };
}

export function buildSubtitleTextElement({
	index,
	caption,
	canvasSize,
	baseStyle,
	basePlacement,
	source = "srt",
	startOffset = ZERO_MEDIA_TIME,
}: {
	index: number;
	caption: SubtitleCue;
	canvasSize: { width: number; height: number };
	baseStyle?: ParamValues;
	basePlacement?: SubtitlePlacementStyle;
	source?: "srt" | "ass" | "transcript";
	startOffset?: MediaTime;
}): CreateTextElement {
	const { styleParams, placement } = resolveSubtitleStyle({
		style: caption.style,
		baseStyle,
		basePlacement,
	});
	const params = buildSubtitleParams({
		canvasSize,
		styleParams,
		placement,
		content: caption.text,
	});

	return {
		...DEFAULTS.text.element,
		name: `Caption ${index + 1}`,
		duration: mediaTimeFromSeconds({ seconds: caption.duration }),
		startTime: addMediaTime({
			a: mediaTimeFromSeconds({ seconds: caption.startTime }),
			b: startOffset,
		}),
		subtitle: { source, cueIndex: index },
		params,
	};
}
