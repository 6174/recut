import { FONT_SIZE_SCALE_REFERENCE } from "@/text/typography";
import {
	getTextVisualRect,
	measureTextBlock,
	setCanvasLetterSpacing,
} from "@/text/layout";
import { DEFAULTS } from "@/timeline/defaults";
import type { ParamValue, ParamValues } from "@/params";
import type { TextBackground } from "@/text/background";
import type {
	TextAlign,
	TextDecoration,
	TextFontStyle,
	TextFontWeight,
} from "@/text/primitives";
import type { SubtitlePlacementStyle } from "./types";

export const SUBTITLE_MAX_WIDTH_RATIO = 1;
export const SUBTITLE_BOTTOM_MARGIN_RATIO = 0.05;
export const SUBTITLE_FONT_SIZE = 5;
export const MEASUREMENT_CANVAS_SIZE = 4096;

export const SUBTITLE_CONTENT_PARAM_KEY = "content";
export const SUBTITLE_POSITION_X_KEY = "transform.positionX";
export const SUBTITLE_POSITION_Y_KEY = "transform.positionY";

/** 从平铺 params（captionStyle / 元素 params）读取字幕排版参数，缺省补 DEFAULTS。 */
export interface ResolvedSubtitleTypography {
	fontFamily: string;
	fontSize: number;
	color: string;
	textAlign: TextAlign;
	fontWeight: TextFontWeight;
	fontStyle: TextFontStyle;
	textDecoration: TextDecoration;
	letterSpacing: number;
	lineHeight: number;
	background: TextBackground;
	scaleX: number;
	scaleY: number;
	rotate: number;
	opacity: number;
}

function readNumber(
	params: ParamValues,
	key: string,
	fallback: ParamValue,
): number {
	const value = params[key];
	if (typeof value === "number" && Number.isFinite(value)) return value;
	return typeof fallback === "number" && Number.isFinite(fallback)
		? fallback
		: 0;
}

function readString(
	params: ParamValues,
	key: string,
	fallback: ParamValue,
): string {
	const value = params[key];
	if (typeof value === "string" && value) return value;
	return typeof fallback === "string" && fallback ? fallback : "";
}export function resolveSubtitleTypography(
	params: ParamValues,
): ResolvedSubtitleTypography {
	const defaults = DEFAULTS.text.element.params;
	const backgroundDefaults = DEFAULTS.text.background;

	return {
		fontFamily: readString(params, "fontFamily", defaults.fontFamily),
		fontSize: readNumber(params, "fontSize", defaults.fontSize),
		color: readString(params, "color", defaults.color),
		textAlign: readString(
			params,
			"textAlign",
			defaults.textAlign,
		) as TextAlign,
		fontWeight: readString(
			params,
			"fontWeight",
			defaults.fontWeight,
		) as TextFontWeight,
		fontStyle: readString(
			params,
			"fontStyle",
			defaults.fontStyle,
		) as TextFontStyle,
		textDecoration: readString(
			params,
			"textDecoration",
			defaults.textDecoration,
		) as TextDecoration,
		letterSpacing: readNumber(params, "letterSpacing", defaults.letterSpacing),
		lineHeight: readNumber(params, "lineHeight", defaults.lineHeight),
		background: {
			enabled: params["background.enabled"] === true,
			color: readString(
				params,
				"background.color",
				backgroundDefaults.color,
			),
			cornerRadius: readNumber(
				params,
				"background.cornerRadius",
				backgroundDefaults.cornerRadius,
			),
			paddingX: readNumber(
				params,
				"background.paddingX",
				backgroundDefaults.paddingX,
			),
			paddingY: readNumber(
				params,
				"background.paddingY",
				backgroundDefaults.paddingY,
			),
			offsetX: readNumber(
				params,
				"background.offsetX",
				backgroundDefaults.offsetX,
			),
			offsetY: readNumber(
				params,
				"background.offsetY",
				backgroundDefaults.offsetY,
			),
		},
		scaleX: readNumber(params, "transform.scaleX", defaults["transform.scaleX"]),
		scaleY: readNumber(params, "transform.scaleY", defaults["transform.scaleY"]),
		rotate: readNumber(params, "transform.rotate", defaults["transform.rotate"]),
		opacity: readNumber(params, "opacity", defaults.opacity),
	};
}

function quoteFontFamily({ fontFamily }: { fontFamily: string }): string {
	return `"${fontFamily.replace(/"/g, '\\"')}"`;
}

function createMeasurementContext(): CanvasRenderingContext2D | null {
	const canvas = document.createElement("canvas");
	canvas.width = MEASUREMENT_CANVAS_SIZE;
	canvas.height = MEASUREMENT_CANVAS_SIZE;
	return canvas.getContext("2d");
}

function measureLineWidth({
	ctx,
	text,
}: {
	ctx: CanvasRenderingContext2D;
	text: string;
}): number {
	return ctx.measureText(text).width;
}

function wrapSubtitleText({
	ctx,
	text,
	maxWidth,
}: {
	ctx: CanvasRenderingContext2D;
	text: string;
	maxWidth: number;
}): string {
	const normalized = text.trim().replace(/\r\n/g, "\n");
	const paragraphs = normalized.split("\n");
	const wrappedParagraphs: string[] = [];

	for (const paragraph of paragraphs) {
		const trimmedParagraph = paragraph.trim();
		if (!trimmedParagraph) {
			wrappedParagraphs.push("");
			continue;
		}

		const words = trimmedParagraph.split(/\s+/);
		let currentLine = words[0] ?? "";
		const lines: string[] = [];

		for (let i = 1; i < words.length; i++) {
			const nextLine = `${currentLine} ${words[i]}`;
			if (measureLineWidth({ ctx, text: nextLine }) <= maxWidth) {
				currentLine = nextLine;
				continue;
			}

			lines.push(currentLine);
			currentLine = words[i];
		}

		lines.push(currentLine);
		wrappedParagraphs.push(lines.join("\n"));
	}

	return wrappedParagraphs.join("\n");
}

function measureWrappedTextBlock({
	ctx,
	content,
	canvasHeight,
	textAlign,
	background,
	fontSize,
	lineHeight,
}: {
	ctx: CanvasRenderingContext2D;
	content: string;
	canvasHeight: number;
	textAlign: TextAlign;
	background: TextBackground;
	fontSize: number;
	lineHeight: number;
}) {
	const scaledFontSize = fontSize * (canvasHeight / FONT_SIZE_SCALE_REFERENCE);
	const lineHeightPx = lineHeight * scaledFontSize;
	const lines = content.split("\n");
	const lineMetrics = lines.map((line) => ctx.measureText(line));

	const block = measureTextBlock({
		lineMetrics,
		lineHeightPx,
	});
	const visualRect = getTextVisualRect({
		textAlign,
		block,
		background,
		fontSizeRatio: fontSize / 15,
	});

	return {
		block,
		visualRect,
	};
}

export function resolveTargetWidth({
	canvasWidth,
	placement,
}: {
	canvasWidth: number;
	placement: SubtitlePlacementStyle;
}): number {
	const leftRatio = placement.marginLeftRatio ?? 0;
	const rightRatio = placement.marginRightRatio ?? 0;
	const hasExplicitMargins = leftRatio > 0 || rightRatio > 0;
	if (!hasExplicitMargins) {
		return canvasWidth * SUBTITLE_MAX_WIDTH_RATIO;
	}

	const availableWidth = canvasWidth * (1 - leftRatio - rightRatio);
	return Math.max(0, availableWidth);
}

function resolvePositionX({
	canvasWidth,
	textAlign,
	placement,
	visualRect,
}: {
	canvasWidth: number;
	textAlign: TextAlign;
	placement: SubtitlePlacementStyle;
	visualRect: { left: number; width: number };
}): number {
	const leftMargin = canvasWidth * (placement.marginLeftRatio ?? 0);
	const rightMargin = canvasWidth * (placement.marginRightRatio ?? 0);
	const canvasCenterX = canvasWidth / 2;

	if (textAlign === "left") {
		return leftMargin - visualRect.left - canvasCenterX;
	}

	if (textAlign === "right") {
		return (
			canvasWidth -
			rightMargin -
			(visualRect.left + visualRect.width) -
			canvasCenterX
		);
	}

	const availableWidth = canvasWidth - leftMargin - rightMargin;
	const targetCenterX = leftMargin + availableWidth / 2;
	return (
		targetCenterX - (visualRect.left + visualRect.width / 2) - canvasCenterX
	);
}

function resolvePositionY({
	canvasHeight,
	placement,
	visualRect,
}: {
	canvasHeight: number;
	placement: SubtitlePlacementStyle;
	visualRect: { top: number; height: number };
}): number {
	const margin =
		canvasHeight *
		(placement.marginVerticalRatio ?? SUBTITLE_BOTTOM_MARGIN_RATIO);
	const canvasCenterY = canvasHeight / 2;

	if (placement.verticalAlign === "top") {
		return margin - visualRect.top - canvasCenterY;
	}

	if (placement.verticalAlign === "middle") {
		const targetCenterY = canvasHeight / 2;
		return (
			targetCenterY - (visualRect.top + visualRect.height / 2) - canvasCenterY
		);
	}

	return (
		canvasHeight - margin - (visualRect.top + visualRect.height) - canvasCenterY
	);
}

export interface SubtitleCueLayout {
	content: string;
	positionX: number;
	positionY: number;
	blockHeight: number;
	visualRect: { left: number; top: number; width: number; height: number };
}

/** 按共享样式 + placement 排版一条字幕 cue，返回换行后的 content 与位置。 */
export function layoutSubtitleCue({
	canvasSize,
	styleParams,
	placement,
	content,
}: {
	canvasSize: { width: number; height: number };
	styleParams: ParamValues;
	placement: SubtitlePlacementStyle;
	content: string;
}): SubtitleCueLayout {
	const typography = resolveSubtitleTypography(styleParams);
	const ctx = createMeasurementContext();
	const fontFamily = quoteFontFamily({ fontFamily: typography.fontFamily });
	const fontWeight = typography.fontWeight;
	const fontStyle = typography.fontStyle === "italic" ? "italic" : "normal";
	const scaledFontSize =
		typography.fontSize * (canvasSize.height / FONT_SIZE_SCALE_REFERENCE);
	const fontString = `${fontStyle} ${fontWeight} ${scaledFontSize}px ${fontFamily}, sans-serif`;
	const maxWidth = resolveTargetWidth({
		canvasWidth: canvasSize.width,
		placement,
	});

	let wrappedContent = content;
	let positionX = 0;
	let positionY = 0;
	let blockHeight = 0;
	let visualRect = { left: 0, top: 0, width: 0, height: 0 };

	if (ctx) {
		ctx.font = fontString;
		setCanvasLetterSpacing({ ctx, letterSpacingPx: typography.letterSpacing });
		wrappedContent = wrapSubtitleText({
			ctx,
			text: content,
			maxWidth,
		});
		const measurement = measureWrappedTextBlock({
			ctx,
			content: wrappedContent,
			canvasHeight: canvasSize.height,
			textAlign: typography.textAlign,
			background: typography.background,
			fontSize: typography.fontSize,
			lineHeight: typography.lineHeight,
		});
		blockHeight = measurement.block.height;
		visualRect = measurement.visualRect;
		positionX = resolvePositionX({
			canvasWidth: canvasSize.width,
			textAlign: typography.textAlign,
			placement,
			visualRect: measurement.visualRect,
		});
		positionY = resolvePositionY({
			canvasHeight: canvasSize.height,
			placement,
			visualRect: measurement.visualRect,
		});
	}

	return {
		content: wrappedContent,
		positionX,
		positionY,
		blockHeight,
		visualRect,
	};
}

export function defaultSubtitlePlacement(): SubtitlePlacementStyle {
	return {
		verticalAlign: "bottom",
		marginVerticalRatio: SUBTITLE_BOTTOM_MARGIN_RATIO,
	};
}

/**
 * 从一条 cue 的当前排版位置反推出全轨 placement（锚点）。
 * verticalAlign 按垂直位置推断（上/下/中）；水平方向按 textAlign 反向求边距。
 */
export function derivePlacementFromCue({
	canvasSize,
	styleParams,
	content,
	positionX,
	positionY,
	provisionalPlacement,
}: {
	canvasSize: { width: number; height: number };
	styleParams: ParamValues;
	content: string;
	positionX: number;
	positionY: number;
	provisionalPlacement?: SubtitlePlacementStyle;
}): SubtitlePlacementStyle {
	const typography = resolveSubtitleTypography(styleParams);
	const canvasCenterX = canvasSize.width / 2;
	const canvasCenterY = canvasSize.height / 2;

	const layout = layoutSubtitleCue({
		canvasSize,
		styleParams,
		placement: provisionalPlacement ?? defaultSubtitlePlacement(),
		content,
	});
	const blockCenterX = canvasCenterX + positionX;
	const blockCenterY = canvasCenterY + positionY;
	const blockHalfHeight = layout.blockHeight / 2;
	const topEdge = blockCenterY - blockHalfHeight;
	const bottomEdge = blockCenterY + blockHalfHeight;

	let verticalAlign: "top" | "middle" | "bottom" = "bottom";
	let marginVerticalRatio: number | undefined;

	if (bottomEdge < canvasSize.height * 0.5) {
		verticalAlign = "top";
		marginVerticalRatio = Math.max(0, topEdge / canvasSize.height);
	} else if (topEdge > canvasSize.height * 0.5) {
		verticalAlign = "bottom";
		marginVerticalRatio = Math.max(
			0,
			(canvasSize.height - bottomEdge) / canvasSize.height,
		);
	} else {
		verticalAlign = "middle";
		marginVerticalRatio = undefined;
	}

	const visualRect = layout.visualRect;
	let marginLeftRatio: number | undefined;
	let marginRightRatio: number | undefined;

	switch (typography.textAlign) {
		case "left": {
			marginLeftRatio = Math.max(
				0,
				(positionX + canvasCenterX + visualRect.left) / canvasSize.width,
			);
			marginRightRatio =
				canvasSize.width - (positionX + canvasCenterX + visualRect.left) -
					visualRect.width === 0
					? undefined
					: undefined;
			marginRightRatio = Math.max(
				0,
				(canvasSize.width -
					(positionX + canvasCenterX + visualRect.left + visualRect.width)) /
					canvasSize.width,
			);
			break;
		}
		case "right": {
			marginRightRatio = Math.max(
				0,
				(canvasSize.width -
					(positionX + canvasCenterX + visualRect.left + visualRect.width)) /
					canvasSize.width,
			);
			marginLeftRatio = Math.max(
				0,
				(positionX + canvasCenterX + visualRect.left) / canvasSize.width,
			);
			break;
		}
		default: {
			// center：l - r = 2 * positionX（画布中心相对），保证重算时所有 cue 同锚点居中。
			const offsetX = positionX;
			if (offsetX >= 0) {
				marginLeftRatio = Math.min(
					0.5,
					(2 * offsetX) / canvasSize.width,
				);
				marginRightRatio = 0;
			} else {
				marginLeftRatio = 0;
				marginRightRatio = Math.min(
					0.5,
					(-2 * offsetX) / canvasSize.width,
				);
			}
			break;
		}
	}

	return {
		verticalAlign,
		marginVerticalRatio,
		marginLeftRatio,
		marginRightRatio,
	};
}

/** 生成一条字幕 cue 的完整 params（共享样式 + 换行 content + 按 placement 重算位置）。 */
export function buildSubtitleParams({
	canvasSize,
	styleParams,
	placement,
	content,
}: {
	canvasSize: { width: number; height: number };
	styleParams: ParamValues;
	placement: SubtitlePlacementStyle;
	content: string;
}): ParamValues {
	const layout = layoutSubtitleCue({
		canvasSize,
		styleParams,
		placement,
		content,
	});

	return {
		...styleParams,
		[SUBTITLE_CONTENT_PARAM_KEY]: layout.content,
		[SUBTITLE_POSITION_X_KEY]: layout.positionX,
		[SUBTITLE_POSITION_Y_KEY]: layout.positionY,
	};
}
