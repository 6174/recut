/**
 * [INPUT]: 依赖 runtime 组件契约与参数定义类型。
 * [OUTPUT]: 对外提供文本组件共享的字体栈、参数输入工厂、固定尺寸/居中样式与确定性动画原语。
 * [POS]: runtime/components 文本组件的公共基座；text-library 与 text-effects 共用，避免重复定义。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { CSSProperties } from "react";
import type { ParamDefinition } from "@timeline/params";
import type { ComponentDefinition } from "../types";

export function fontStack({ fontFamily }: { fontFamily: string }): string {
	return `"${fontFamily}", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
}

export const fontInput = (): ParamDefinition => ({
	key: "fontFamily",
	type: "font",
	default: "Arial",
	label: "Font family",
	labelKey: "component.param.fontFamily",
});

export const colorInput = ({
	key = "color",
	defaultValue,
}: {
	key?: string;
	defaultValue: string;
}): ParamDefinition => ({
	key,
	type: "color",
	default: defaultValue,
	label: "Color",
	labelKey: "component.param.color",
});

export const accentInput = ({
	defaultValue,
}: {
	defaultValue: string;
}): ParamDefinition => ({
	key: "accent",
	type: "color",
	default: defaultValue,
	label: "Accent",
	labelKey: "component.param.mainColor",
});

/** 固定设计尺寸的组件：base = content bounds，避免逐像素 alpha 扫描。 */
export function fixedSize({
	width,
	height,
}: {
	width: number;
	height: number;
}): Pick<ComponentDefinition, "getBaseSize" | "getContentBounds"> {
	return {
		getBaseSize: () => ({ width, height }),
		getContentBounds: () => ({ x: 0, y: 0, width, height }),
	};
}

export function centerBox(style?: CSSProperties): CSSProperties {
	return {
		width: "100%",
		height: "100%",
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		...style,
	};
}

// ── 确定性动画原语（localTime 的纯函数，Preview == Export）────────────
export function clamp01(value: number): number {
	return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/** 归一化到 [0,1] 的分段进度。 */
export function segment(t: number, delay: number, duration: number): number {
	return clamp01((t - delay) / (duration <= 0 ? 0.0001 : duration));
}

export function easeOutCubic(u: number): number {
	return 1 - Math.pow(1 - u, 3);
}

export function easeOutBack(u: number): number {
	const c1 = 1.70158;
	const c3 = c1 + 1;
	const x = u - 1;
	return 1 + c3 * x * x * x + c1 * x * x;
}

/** 入场：延迟 delay 后用时 duration 缓出到 1。 */
export function reveal(t: number, delay: number, duration = 0.5): number {
	return easeOutCubic(segment(t, delay, duration));
}

/** 弹入：带轻微过冲（scale 类）。 */
export function pop(t: number, delay: number, duration = 0.45): number {
	return easeOutBack(segment(t, delay, duration));
}

/** 环境脉冲：周期 0..1。 */
export function pulse(t: number, speed: number): number {
	return 0.5 - 0.5 * Math.cos(t * speed * Math.PI * 2);
}

export function slideUp(r: number, distance = 24): string {
	return `translateY(${(1 - r) * distance}px)`;
}

// ── SVG 装饰几何 ────────────────────────────────────────
/** 星芒多边形点集（外/内半径交替）。 */
export function burstPoints({
	cx,
	cy,
	rOuter,
	rInner,
	spikes,
}: {
	cx: number;
	cy: number;
	rOuter: number;
	rInner: number;
	spikes: number;
}): string {
	const points: string[] = [];
	for (let i = 0; i < spikes * 2; i += 1) {
		const radius = i % 2 === 0 ? rOuter : rInner;
		const angle = (Math.PI * i) / spikes - Math.PI / 2;
		points.push(
			`${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`,
		);
	}
	return points.join(" ");
}

/** 四角星（凹边）路径。 */
export function sparklePath({
	cx,
	cy,
	r,
}: {
	cx: number;
	cy: number;
	r: number;
}): string {
	return [
		`M ${cx} ${cy - r}`,
		`Q ${cx} ${cy} ${cx + r} ${cy}`,
		`Q ${cx} ${cy} ${cx} ${cy + r}`,
		`Q ${cx} ${cy} ${cx - r} ${cy}`,
		`Q ${cx} ${cy} ${cx} ${cy - r}`,
		"Z",
	].join(" ");
}

/** 无 id 的 CSS drop-shadow 滤镜串，避免多实例 SVG filter id 冲突。 */
export function dropShadow({
	color,
	blur,
	x = 0,
	y = 0,
}: {
	color: string;
	blur: number;
	x?: number;
	y?: number;
}): string {
	return `drop-shadow(${x}px ${y}px ${blur}px ${color})`;
}

/**
 * 剪映式「粗描边 + 挤出投影」展示字：单一元素用 -webkit-text-stroke（paint-order: stroke fill）
 * 出厚描边，再用两层无模糊 text-shadow 出右下挤出，配合 900 字重 / 斜体形成高辨识度贴纸字。
 */
export function chunkyText({
	fontFamily,
	fontSize,
	color,
	outline = "#0b0f19",
	strokeWidth = 14,
	shadowColor = "rgba(0,0,0,0.55)",
	shadowOffset = 8,
	letterSpacing = 2,
	lineHeight = 1,
	italic = true,
}: {
	fontFamily: string;
	fontSize: number;
	color: string;
	outline?: string;
	strokeWidth?: number;
	shadowColor?: string;
	shadowOffset?: number;
	letterSpacing?: number;
	lineHeight?: number;
	italic?: boolean;
}): CSSProperties {
	return {
		fontFamily: `"${fontFamily}", "Arial Black", Impact, "PingFang SC", "Microsoft YaHei", sans-serif`,
		fontSize,
		fontWeight: 900,
		fontStyle: italic ? "italic" : "normal",
		letterSpacing,
		lineHeight,
		color,
		WebkitTextStroke: `${strokeWidth}px ${outline}`,
		paintOrder: "stroke fill",
		textShadow: `${shadowOffset * 0.5}px ${shadowOffset * 0.6}px 0 ${shadowColor}, ${shadowOffset}px ${shadowOffset * 1.3}px 0 ${shadowColor}`,
	};
}

