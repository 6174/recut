/**
 * [INPUT]: 文本字符串与分段模式。
 * [OUTPUT]: Unicode 安全、顺序稳定的 TextSegment 列表。
 * [POS]: runtime 文本的纯函数层；不依赖 React、GSAP、DOM 或 Canvas。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export type TextSegmentMode = "whole" | "line" | "word" | "grapheme";

export interface TextSegment {
	id: string;
	text: string;
	index: number;
}

function fallbackSegments(text: string, mode: TextSegmentMode): string[] {
	if (mode === "whole") return [text];
	if (mode === "line") return text.split("\n");
	if (mode === "grapheme") return Array.from(text);
	return text.match(/\s+|[^\s]+/gu) ?? [];
}

/** Unicode-aware, deterministic segmentation. IDs are positional for a fixed text/mode pair. */
export function segmentText(text: string, mode: TextSegmentMode): TextSegment[] {
	const segments =
		mode === "whole"
			? [text]
			: mode === "line"
				? text.split("\n")
				: typeof Intl !== "undefined" && "Segmenter" in Intl
					? Array.from(
							new Intl.Segmenter(undefined, {
								granularity: mode === "grapheme" ? "grapheme" : "word",
							}).segment(text),
						).map((part) => part.segment)
					: fallbackSegments(text, mode);
	const prefix = mode === "whole" ? "whole" : mode[0];
	return segments.map((value, index) => ({
		id: `${prefix}-${index}`,
		text: value,
		index,
	}));
}
