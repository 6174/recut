/**
 * [INPUT]: 依赖 React CSSProperties。
 * [OUTPUT]: 对外提供 GradientFillText：渐变填充 + 独立描边底层（描边不吃填充）的展示字。
 * [POS]: runtime/components 文本组件的渐变展示字基座；HTML 文本的 -webkit-text-stroke 会盖住
 *        background-clip:text 的渐变填充，故把描边放到独立底层，前景只负责渐变填充。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { CSSProperties } from "react";

export function GradientFillText({
	text,
	fontFamily,
	fontSize,
	letterSpacing = 4,
	gradient,
	outline,
	strokeWidth = 14,
	italic = false,
	gradientStyle,
	style,
}: {
	text: string;
	fontFamily: string;
	fontSize: number;
	letterSpacing?: number;
	gradient: string;
	outline: string;
	strokeWidth?: number;
	italic?: boolean;
	/** 前景渐变层附加样式（扫光用 backgroundSize/backgroundPosition）。 */
	gradientStyle?: CSSProperties;
	style?: CSSProperties;
}) {
	return (
		<span
			style={{
				position: "relative",
				display: "inline-block",
				fontFamily: `"${fontFamily}", "Arial Black", Impact, "PingFang SC", "Microsoft YaHei", sans-serif`,
				fontSize,
				fontWeight: 900,
				fontStyle: italic ? "italic" : "normal",
				letterSpacing,
				lineHeight: 1,
				...style,
			}}
		>
			{/* 描边底层：只画描边（透明填充），被前景渐变覆盖内侧，形成干净外描边。 */}
			<span
				aria-hidden="true"
				style={{
					position: "absolute",
					left: 0,
					top: 0,
					color: "transparent",
					WebkitTextStroke: `${strokeWidth}px ${outline}`,
				}}
			>
				{text}
			</span>
			<span
				style={{
					position: "relative",
					backgroundImage: gradient,
					backgroundClip: "text",
					WebkitBackgroundClip: "text",
					WebkitTextFillColor: "transparent",
					color: "transparent",
					...gradientStyle,
				}}
			>
				{text}
			</span>
		</span>
	);
}
