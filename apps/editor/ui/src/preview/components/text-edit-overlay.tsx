"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePreviewViewport } from "@/preview/components/preview-viewport";
import { useEditor } from "@/editor/use-editor";
import { t, useRecutLocale } from "@/i18n";
import type { TextElement } from "@/timeline";
import { DEFAULTS } from "@/timeline/defaults";
import { getElementLocalTime } from "@/animation";
import { resolveTransformAtTime } from "@/rendering/animation-values";
import { buildTransformFromParams } from "@/rendering";
import { resolveTextLayout } from "@/text/primitives";
import {
	buildTextBackgroundFromElement,
	buildTextLayoutParamsFromElement,
} from "@/text/measure-element";

export function TextEditOverlay({
	trackId,
	elementId,
	element,
	onCommit,
}: {
	trackId: string;
	elementId: string;
	element: TextElement;
	onCommit: () => void;
}) {
	const locale = useRecutLocale();
	const editor = useEditor();
	const viewport = usePreviewViewport();
	const divRef = useRef<HTMLDivElement>(null);
	const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// 挂载时一次性写入初始内容；之后 DOM 是主源（不受控），React 不再触碰内容，光标不会跳。
	useEffect(() => {
		const div = divRef.current;
		if (!div) return;
		div.textContent =
			typeof element.params.content === "string" ? element.params.content : "";
		div.focus();
		const range = document.createRange();
		range.selectNodeContents(div);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		return () => {
			if (previewTimer.current) {
				clearTimeout(previewTimer.current);
				previewTimer.current = null;
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const preview = useCallback(
		(text: string) => {
			editor.timeline.previewElements({
				updates: [{ trackId, elementId, updates: { params: { content: text } } }],
			});
		},
		[editor.timeline, trackId, elementId],
	);

	const handleInput = useCallback(() => {
		const div = divRef.current;
		if (!div) return;
		const text = div.innerText;
		// 输入即时反映在 DOM；store/渲染预览防抖，避免每键一次完整 round-trip。
		if (previewTimer.current) clearTimeout(previewTimer.current);
		previewTimer.current = setTimeout(() => preview(text), 80);
	}, [preview]);

	const commit = useCallback(() => {
		if (previewTimer.current) {
			clearTimeout(previewTimer.current);
			previewTimer.current = null;
		}
		const div = divRef.current;
		const text = div?.innerText ?? "";
		preview(text);
		onCommit();
	}, [preview, onCommit]);

	const handleKeyDown = useCallback(
		({ event }: { event: React.KeyboardEvent }) => {
			if (event.key === "Escape") {
				event.preventDefault();
				commit();
			}
		},
		[commit],
	);

	const canvasSize = editor.project.getActive().settings.canvasSize;

	if (!canvasSize) return null;

	const currentTime = editor.playback.getCurrentTime();
	const localTime = getElementLocalTime({
		timelineTime: currentTime,
		elementStartTime: element.startTime,
		elementDuration: element.duration,
	});
	const transform = resolveTransformAtTime({
		baseTransform: buildTransformFromParams({ params: element.params }),
		animations: element.animations,
		localTime,
	});

	const { x: posX, y: posY } = viewport.positionToOverlay({
		positionX: transform.position.x,
		positionY: transform.position.y,
	});

	const { x: displayScaleX } = viewport.getDisplayScale();
	const textParams = buildTextLayoutParamsFromElement({ element });
	const resolvedTextLayout = resolveTextLayout({
		text: textParams,
		canvasHeight: canvasSize.height,
	});

	const lineHeight = textParams.lineHeight ?? DEFAULTS.text.lineHeight;
	const canvasLetterSpacing = textParams.letterSpacing ?? 0;
	const lineHeightPx = resolvedTextLayout.lineHeightPx;

	const bg = buildTextBackgroundFromElement({ element });
	const shouldShowBackground =
		bg.enabled && bg.color && bg.color !== "transparent";
	const fontSizeRatio = resolvedTextLayout.fontSizeRatio;
	const canvasPaddingX = shouldShowBackground
		? (bg.paddingX ?? DEFAULTS.text.background.paddingX) * fontSizeRatio
		: 0;
	const canvasPaddingY = shouldShowBackground
		? (bg.paddingY ?? DEFAULTS.text.background.paddingY) * fontSizeRatio
		: 0;

	return (
		<div
			className="absolute"
			style={{
				left: posX,
				top: posY,
				transform: `translate(-50%, -50%) scale(${transform.scaleX * displayScaleX}, ${transform.scaleY * displayScaleX}) rotate(${transform.rotate}deg)`,
				transformOrigin: "center center",
			}}
		>
			<div
				ref={divRef}
				contentEditable
				suppressContentEditableWarning
				tabIndex={0}
				role="textbox"
				aria-label={t(locale, "preview.editText")}
				className="cursor-text select-text outline-none whitespace-pre"
				style={{
					fontSize: resolvedTextLayout.scaledFontSize,
					fontFamily: textParams.fontFamily,
					fontWeight: textParams.fontWeight === "bold" ? "bold" : "normal",
					fontStyle: textParams.fontStyle === "italic" ? "italic" : "normal",
					textAlign: textParams.textAlign,
					letterSpacing: `${canvasLetterSpacing}px`,
					lineHeight,
					color: "transparent",
					caretColor:
						typeof element.params.color === "string"
							? element.params.color
							: "#ffffff",
					backgroundColor: shouldShowBackground ? bg.color : "transparent",
					minHeight: lineHeightPx,
					textDecoration: textParams.textDecoration ?? "none",
					padding: shouldShowBackground
						? `${canvasPaddingY}px ${canvasPaddingX}px`
						: 0,
					minWidth: 1,
				}}
				onInput={handleInput}
				onBlur={commit}
				onKeyDown={(event) => handleKeyDown({ event })}
			/>
		</div>
	);
}
