/**
 * [INPUT]: 依赖 runtime 组件契约、文本共享基座（动画原语 / SVG 几何 / chunky 展示字 / 参数工厂）与参数取值工具。
 * [OUTPUT]: 对外提供 TEXT_VARIANT_COMPONENTS：资讯条/辉光/心动/对勾/胶囊/星芒/数据+1/小字花边/缎带/空心/对角标/目录标签等风格多样型文本组件。
 * [POS]: runtime/components 文本组件的「风格多样」批次；与 text-library、text-effects 合并进文本面板。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { ComponentDefinition } from "../types";
import { str } from "../utils";
import {
	accentInput,
	centerBox,
	chunkyText,
	clamp01,
	colorInput,
	dropShadow,
	fixedSize,
	fontInput,
	fontStack,
	pop,
	pulse,
	reveal,
	slideUp,
	sparklePath,
} from "./text-shared";
import { GradientFillText } from "./text-fill";

const DARK = "#0b0f19";

const HEART_PATH =
	"M50 88 C20 66 8 48 8 32 C8 18 19 8 32 8 C40 8 47 12 50 19 C53 12 60 8 68 8 C81 8 92 18 92 32 C92 48 80 66 50 88 Z";

// ── 资讯条 ──────────────────────────────────────────────
const newsBar: ComponentDefinition = {
	id: "text-news-bar",
	name: "News Bar",
	nameKey: "textLib.comp.newsBar",
	textGroup: "annotation",
	surface: "react",
	keywords: ["news", "资讯", "资讯条", "标题", "播报"],
	color: "#3b82f6",
	inputs: [
		{ key: "text", type: "text", default: "最新资讯速递", label: "Text", labelKey: "component.param.text" },
		colorInput({ defaultValue: "#ffffff" }),
		accentInput({ defaultValue: "#3b82f6" }),
		fontInput(),
	],
	...fixedSize({ width: 1100, height: 180 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#3b82f6");
		const color = str(params.color, "#ffffff");
		const bar = reveal(localTime, 0, 0.45);
		const text = reveal(localTime, 0.18, 0.4);
		const dot = pulse(localTime, 1.2);
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						width: 1000,
						height: 110,
						borderRadius: 14,
						background: "#0b0f19ee",
						overflow: "hidden",
						transformOrigin: "left center",
						transform: `scaleX(${bar})`,
						opacity: clamp01(bar + 0.2),
						boxShadow: "0 14px 34px rgba(0,0,0,0.45)",
					}}
				>
					<div
						style={{
							width: 14,
							height: "100%",
							background: accent,
							boxShadow: `0 0 22px ${accent}`,
						}}
					/>
					<div
						style={{
							width: 18,
							height: 18,
							borderRadius: 9,
							background: accent,
							marginLeft: 26,
							opacity: 0.5 + 0.5 * dot,
							boxShadow: `0 0 16px ${accent}`,
						}}
					/>
					<div
						style={{
							marginLeft: 20,
							fontFamily: `"${fontFamily}", "Arial Black", "PingFang SC", sans-serif`,
							fontSize: 52,
							fontWeight: 800,
							letterSpacing: 4,
							color,
							opacity: text,
							transform: slideUp(text, 12),
							whiteSpace: "nowrap",
						}}
					>
						{str(params.text, "最新资讯速递")}
					</div>
				</div>
			</div>
		);
	},
};

// ── 辉光标题 ────────────────────────────────────────────
const glowTitle: ComponentDefinition = {
	id: "text-glow-title",
	name: "Glow Title",
	nameKey: "textLib.comp.glowTitle",
	textGroup: "title",
	surface: "react",
	keywords: ["glow", "辉光", "光晕", "标题", "闪光"],
	color: "#f472b6",
	inputs: [
		{ key: "text", type: "text", default: "闪光时刻", label: "Text", labelKey: "component.param.text" },
		accentInput({ defaultValue: "#f472b6" }),
		fontInput(),
	],
	...fixedSize({ width: 1200, height: 280 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#f472b6");
		const e = reveal(localTime, 0, 0.45);
		const breath = pulse(localTime, 0.7);
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<div
					style={{
						fontFamily: `"${fontFamily}", "Arial Black", Impact, "PingFang SC", sans-serif`,
						fontSize: 150,
						fontWeight: 900,
						fontStyle: "italic",
						letterSpacing: 6,
						lineHeight: 1,
						color: "#ffffff",
						opacity: e,
						textShadow: `0 0 12px ${accent}, 0 0 28px ${accent}, 0 0 ${40 + 24 * breath}px ${accent}`,
						transform: `scale(${0.9 + 0.1 * e})`,
					}}
				>
					{str(params.text, "闪光时刻")}
				</div>
			</div>
		);
	},
};

// ── 心动标题 ────────────────────────────────────────────
const heartTitle: ComponentDefinition = {
	id: "text-heart-title",
	name: "Heart Title",
	nameKey: "textLib.comp.heartTitle",
	textGroup: "title",
	surface: "react",
	keywords: ["heart", "心动", "爱心", "粉色", "标题"],
	color: "#f472b6",
	inputs: [
		{ key: "text", type: "text", default: "怦然心动", label: "Text", labelKey: "component.param.text" },
		accentInput({ defaultValue: "#f472b6" }),
		fontInput(),
	],
	...fixedSize({ width: 1200, height: 320 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#f472b6");
		const e = reveal(localTime, 0, 0.45);
		const beat = pulse(localTime, 1.1);
		const heart = pop(localTime, 0.1, 0.5);
		const heartScale = 0.9 + 0.18 * beat;
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<svg width="100%" height="100%" viewBox="0 0 1200 320" style={{ position: "absolute", inset: 0 }}>
					<g
						opacity={clamp01(heart)}
						transform={`translate(${600 - 52 * 1.05 * heartScale} ${236 - 52 * 1.05 * heartScale}) scale(${1.05 * heartScale})`}
						style={{ filter: dropShadow({ color: accent, blur: 18 }) }}
					>
						<path d={HEART_PATH} fill={accent} />
					</g>
				</svg>
				<div
					style={{
						position: "relative",
						transform: `translateY(-18px)`,
					}}
				>
					<GradientFillText
						text={str(params.text, "怦然心动")}
						fontFamily={fontFamily}
						fontSize={138}
						letterSpacing={4}
						gradient={`linear-gradient(180deg, #ffffff 0%, ${accent} 55%, #be185d 100%)`}
						outline="#ffffff"
						strokeWidth={14}
						style={{
							opacity: e,
							transform: `scale(${0.9 + 0.1 * e})`,
							filter: dropShadow({ color: "rgba(190,24,93,0.5)", blur: 18, y: 8 }),
						}}
					/>
				</div>
			</div>
		);
	},
};

// ── 对勾标题 ────────────────────────────────────────────
const checkTitle: ComponentDefinition = {
	id: "text-check-title",
	name: "Check Title",
	nameKey: "textLib.comp.checkTitle",
	textGroup: "title",
	surface: "react",
	keywords: ["check", "对勾", "稳重", "确认", "标题"],
	color: "#22c55e",
	inputs: [
		{ key: "text", type: "text", default: "稳重大气", label: "Text", labelKey: "component.param.text" },
		colorInput({ defaultValue: "#ffffff" }),
		accentInput({ defaultValue: "#22c55e" }),
		fontInput(),
	],
	...fixedSize({ width: 1100, height: 220 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#22c55e");
		const e = pop(localTime, 0, 0.5);
		const text = reveal(localTime, 0.18, 0.45);
		return (
			<div
				style={centerBox({
					flexDirection: "row",
					gap: 26,
					position: "relative",
					fontFamily: fontStack({ fontFamily }),
				})}
			>
				<svg width="96" height="96" viewBox="0 0 96 96" style={{ transform: `scale(${0.7 + 0.3 * e})` }}>
					<rect x="6" y="6" width="84" height="84" rx="22" fill={accent} opacity={clamp01(e)} />
					<path
						d="M28 50 L43 65 L69 34"
						fill="none"
						stroke="#ffffff"
						strokeWidth="10"
						strokeLinecap="round"
						strokeLinejoin="round"
						pathLength={1}
						strokeDasharray={1}
						strokeDashoffset={1 - reveal(localTime, 0.28, 0.4)}
					/>
				</svg>
				<div
					style={{
						...chunkyText({
							fontFamily,
							fontSize: 104,
							color: str(params.color, "#ffffff"),
							outline: DARK,
							strokeWidth: 12,
							shadowColor: "rgba(0,0,0,0.45)",
							shadowOffset: 6,
							letterSpacing: 4,
							italic: false,
						}),
						opacity: text,
						transform: slideUp(text, 14),
					}}
				>
					{str(params.text, "稳重大气")}
				</div>
			</div>
		);
	},
};

// ── 胶囊标签 ────────────────────────────────────────────
const pillLabel: ComponentDefinition = {
	id: "text-pill-label",
	name: "Pill Label",
	nameKey: "textLib.comp.pillLabel",
	textGroup: "label",
	surface: "react",
	keywords: ["pill", "胶囊", "标签", "推荐", "新品"],
	color: "#22c55e",
	inputs: [
		{ key: "text", type: "text", default: "新品推荐", label: "Text", labelKey: "component.param.text" },
		colorInput({ defaultValue: "#ffffff" }),
		accentInput({ defaultValue: "#22c55e" }),
		fontInput(),
	],
	...fixedSize({ width: 760, height: 200 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#22c55e");
		const e = pop(localTime, 0, 0.5);
		const shine = reveal(localTime, 0.3, 0.5);
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<div
					style={{
						position: "relative",
						display: "flex",
						alignItems: "center",
						padding: "24px 70px",
						borderRadius: 999,
						background: `linear-gradient(180deg, ${accent} 0%, ${accent} 55%, rgba(0,0,0,0.28) 100%)`,
						boxShadow: `0 16px 34px rgba(0,0,0,0.4), inset 0 3px 0 rgba(255,255,255,0.5)`,
						opacity: clamp01(e),
						transform: `scale(${0.7 + 0.3 * e})`,
						overflow: "hidden",
					}}
				>
					<div
						style={{
							position: "absolute",
							top: 0,
							bottom: 0,
							width: 120,
							left: -140,
							background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.65), transparent)",
							transform: `translateX(${shine * 900}px)`,
						}}
					/>
					<span
						style={chunkyText({
							fontFamily,
							fontSize: 56,
							color: str(params.color, "#ffffff"),
							outline: "rgba(0,0,0,0.35)",
							strokeWidth: 7,
							shadowColor: "rgba(0,0,0,0.3)",
							shadowOffset: 3,
							letterSpacing: 4,
							italic: false,
						})}
					>
						{str(params.text, "新品推荐")}
					</span>
				</div>
			</div>
		);
	},
};

// ── 星芒推荐 ────────────────────────────────────────────
const starBurst: ComponentDefinition = {
	id: "text-star-burst",
	name: "Star Burst",
	nameKey: "textLib.comp.starBurst",
	textGroup: "combo",
	surface: "react",
	keywords: ["star", "星芒", "超值", "推荐", "促销"],
	color: "#facc15",
	inputs: [
		{ key: "text", type: "text", default: "超值", label: "Text", labelKey: "component.param.text" },
		accentInput({ defaultValue: "#facc15" }),
		fontInput(),
	],
	...fixedSize({ width: 720, height: 340 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#facc15");
		const e = pop(localTime, 0, 0.55);
		const spin = (1 - clamp01(e)) * 20;
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<svg
					width="100%"
					height="100%"
					viewBox="0 0 720 340"
					style={{ position: "absolute", inset: 0, filter: dropShadow({ color: "rgba(0,0,0,0.4)", blur: 16, y: 10 }) }}
				>
					<path
						d={sparklePath({ cx: 360, cy: 170, r: 168 })}
						fill={accent}
						stroke="#b45309"
						strokeWidth="6"
						opacity={clamp01(e)}
						transform={`rotate(${spin} 360 170)`}
					/>
				</svg>
				<div
					style={{
						position: "relative",
						...chunkyText({
							fontFamily,
							fontSize: 118,
							color: "#ffffff",
							outline: "#b91c1c",
							strokeWidth: 14,
							shadowColor: "rgba(120,0,0,0.5)",
							shadowOffset: 6,
							letterSpacing: 4,
						}),
						opacity: clamp01(e * 1.4),
						transform: `scale(${0.7 + 0.3 * clamp01(e)})`,
					}}
				>
					{str(params.text, "超值")}
				</div>
			</div>
		);
	},
};

// ── 数据 +1 ─────────────────────────────────────────────
const numberPlus: ComponentDefinition = {
	id: "text-number-plus",
	name: "Number Plus",
	nameKey: "textLib.comp.numberPlus",
	textGroup: "stat",
	surface: "react",
	keywords: ["stat", "数据", "加一", "好感", "number"],
	color: "#ef4444",
	inputs: [
		{ key: "label", type: "text", default: "用户好感度", label: "Label", labelKey: "textLib.param.label" },
		{ key: "value", type: "text", default: "+1", label: "Value", labelKey: "textLib.param.value" },
		colorInput({ defaultValue: "#ffffff" }),
		accentInput({ defaultValue: "#ef4444" }),
		fontInput(),
	],
	...fixedSize({ width: 760, height: 300 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#ef4444");
		const l = reveal(localTime, 0, 0.4);
		const v = pop(localTime, 0.14, 0.5);
		const beat = pulse(localTime, 1.1);
		return (
			<div style={centerBox({ gap: 8, fontFamily: fontStack({ fontFamily }) })}>
				<div
					style={{
						fontSize: 40,
						fontWeight: 700,
						color: str(params.color, "#ffffff"),
						opacity: l,
						textShadow: "0 3px 10px rgba(0,0,0,0.6)",
					}}
				>
					{str(params.label, "用户好感度")}
				</div>
				<div
					style={{
						...chunkyText({
							fontFamily,
							fontSize: 150,
							color: accent,
							outline: "#450a0a",
							strokeWidth: 10,
							shadowColor: "rgba(0,0,0,0.45)",
							shadowOffset: 6,
							letterSpacing: 0,
						}),
						opacity: clamp01(v),
						transform: `scale(${0.6 + 0.4 * v + 0.02 * beat}) rotate(${(1 - clamp01(v)) * -8}deg)`,
					}}
				>
					{str(params.value, "+1")}
				</div>
			</div>
		);
	},
};

// ── 小字花边 ────────────────────────────────────────────
const captionDots: ComponentDefinition = {
	id: "text-caption-dots",
	name: "Caption Dots",
	nameKey: "textLib.comp.captionDots",
	textGroup: "body",
	surface: "react",
	keywords: ["caption", "小字", "水印", "花边", "正文"],
	color: "#94a3b8",
	inputs: [
		{ key: "text", type: "text", default: "我的水印", label: "Text", labelKey: "component.param.text" },
		colorInput({ defaultValue: "#cbd5e1" }),
		accentInput({ defaultValue: "#64748b" }),
		fontInput(),
	],
	...fixedSize({ width: 1100, height: 150 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#64748b");
		const e = reveal(localTime, 0, 0.45);
		const line = reveal(localTime, 0.15, 0.5);
		return (
			<div
				style={centerBox({
					flexDirection: "row",
					gap: 22,
					position: "relative",
					fontFamily: fontStack({ fontFamily }),
				})}
			>
				<svg width="150" height="40" viewBox="0 0 150 40" style={{ opacity: line }}>
					<rect x="0" y="17" width="56" height="6" rx="3" fill={accent} />
					<circle cx="78" cy="20" r="5" fill={accent} />
					<circle cx="100" cy="20" r="5" fill={accent} />
					<circle cx="122" cy="20" r="5" fill={accent} />
				</svg>
				<div
					style={{
						fontSize: 54,
						fontWeight: 700,
						letterSpacing: 10,
						color: str(params.color, "#cbd5e1"),
						opacity: e,
						textShadow: "0 3px 10px rgba(0,0,0,0.6)",
						whiteSpace: "nowrap",
					}}
				>
					{str(params.text, "我的水印")}
				</div>
				<svg width="150" height="40" viewBox="0 0 150 40" style={{ opacity: line }}>
					<circle cx="28" cy="20" r="5" fill={accent} />
					<circle cx="50" cy="20" r="5" fill={accent} />
					<circle cx="72" cy="20" r="5" fill={accent} />
					<rect x="94" y="17" width="56" height="6" rx="3" fill={accent} />
				</svg>
			</div>
		);
	},
};

// ── 缎带横幅 ────────────────────────────────────────────
const ribbon: ComponentDefinition = {
	id: "text-ribbon",
	name: "Ribbon",
	nameKey: "textLib.comp.ribbon",
	textGroup: "combo",
	surface: "react",
	keywords: ["ribbon", "缎带", "横幅", "福利", "促销"],
	color: "#ef4444",
	inputs: [
		{ key: "text", type: "text", default: "福利来袭", label: "Text", labelKey: "component.param.text" },
		colorInput({ defaultValue: "#ffffff" }),
		accentInput({ defaultValue: "#ef4444" }),
		fontInput(),
	],
	...fixedSize({ width: 1000, height: 260 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#ef4444");
		const e = reveal(localTime, 0, 0.45);
		const text = pop(localTime, 0.16, 0.5);
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<svg
					width="100%"
					height="100%"
					viewBox="0 0 1000 260"
					style={{
						position: "absolute",
						inset: 0,
						transformOrigin: "center",
						transform: `scaleX(${e})`,
						filter: dropShadow({ color: "rgba(0,0,0,0.4)", blur: 14, y: 10 }),
					}}
				>
					<path d="M60 76 H940 L900 130 L940 184 H60 L100 130 Z" fill={accent} />
					<path d="M100 130 L60 76 V184 Z" fill="rgba(0,0,0,0.25)" />
					<path d="M900 130 L940 76 V184 Z" fill="rgba(0,0,0,0.25)" />
					<path d="M120 100 H880" stroke="rgba(255,255,255,0.35)" strokeWidth="4" />
				</svg>
				<div
					style={{
						position: "relative",
						...chunkyText({
							fontFamily,
							fontSize: 96,
							color: str(params.color, "#ffffff"),
							outline: "#7f1d1d",
							strokeWidth: 10,
							shadowColor: "rgba(0,0,0,0.4)",
							shadowOffset: 5,
							letterSpacing: 8,
						}),
						opacity: clamp01(text),
						transform: `scale(${0.7 + 0.3 * text})`,
					}}
				>
					{str(params.text, "福利来袭")}
				</div>
			</div>
		);
	},
};

// ── 空心标描边 ──────────────────────────────────────────
const outlineTitle: ComponentDefinition = {
	id: "text-outline-title",
	name: "Outline Title",
	nameKey: "textLib.comp.outlineTitle",
	textGroup: "title",
	surface: "react",
	keywords: ["outline", "空心", "描边", "标题"],
	color: "#22d3ee",
	inputs: [
		{ key: "text", type: "text", default: "万象更新", label: "Text", labelKey: "component.param.text" },
		accentInput({ defaultValue: "#22d3ee" }),
		fontInput(),
	],
	...fixedSize({ width: 1200, height: 280 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#22d3ee");
		const e = reveal(localTime, 0, 0.45);
		const draw = reveal(localTime, 0.1, 0.6);
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<div
					style={{
						fontFamily: `"${fontFamily}", "Arial Black", Impact, "PingFang SC", sans-serif`,
						fontSize: 150,
						fontWeight: 900,
						fontStyle: "italic",
						letterSpacing: 6,
						lineHeight: 1,
						color: "transparent",
						WebkitTextStroke: `6px ${accent}`,
						opacity: e,
						transform: `scale(${0.9 + 0.1 * e})`,
						filter: dropShadow({ color: "rgba(0,0,0,0.6)", blur: 10, y: 6 }),
					}}
				>
					{str(params.text, "万象更新")}
				</div>
				<svg
					width="100%"
					height="100%"
					viewBox="0 0 1200 280"
					style={{ position: "absolute", inset: 0, opacity: 0.8 }}
				>
					<path
						d="M300 70 H900"
						stroke={accent}
						strokeWidth="5"
						strokeLinecap="round"
						pathLength={1}
						strokeDasharray={1}
						strokeDashoffset={1 - draw}
					/>
					<path
						d="M300 214 H900"
						stroke={accent}
						strokeWidth="5"
						strokeLinecap="round"
						pathLength={1}
						strokeDasharray={1}
						strokeDashoffset={1 - draw}
					/>
				</svg>
			</div>
		);
	},
};

// ── 对角标 ──────────────────────────────────────────────
const cornerMarks: ComponentDefinition = {
	id: "text-corner-marks",
	name: "Corner Marks",
	nameKey: "textLib.comp.cornerMarks",
	textGroup: "combo",
	surface: "react",
	keywords: ["corner", "对角标", "角标", "标题", "揭秘"],
	color: "#f43f5e",
	inputs: [
		{ key: "text", type: "text", default: "双面揭秘", label: "Text", labelKey: "component.param.text" },
		colorInput({ defaultValue: "#ffffff" }),
		accentInput({ defaultValue: "#f43f5e" }),
		fontInput(),
	],
	...fixedSize({ width: 1100, height: 280 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#f43f5e");
		const e = reveal(localTime, 0, 0.5);
		const d = (1 - e) * 30;
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<svg width="100%" height="100%" viewBox="0 0 1100 280" style={{ position: "absolute", inset: 0 }}>
					<path d="M80 74 V44 H150" fill="none" stroke={accent} strokeWidth="10" strokeLinecap="round" opacity={e} transform={`translate(${-d} ${-d})`} />
					<path d="M80 206 V236 H150" fill="none" stroke={accent} strokeWidth="10" strokeLinecap="round" opacity={e} transform={`translate(${-d} ${d})`} />
					<path d="M1020 74 V44 H950" fill="none" stroke={accent} strokeWidth="10" strokeLinecap="round" opacity={e} transform={`translate(${d} ${-d})`} />
					<path d="M1020 206 V236 H950" fill="none" stroke={accent} strokeWidth="10" strokeLinecap="round" opacity={e} transform={`translate(${d} ${d})`} />
				</svg>
				<div
					style={{
						...chunkyText({
							fontFamily,
							fontSize: 122,
							color: str(params.color, "#ffffff"),
							outline: DARK,
							strokeWidth: 12,
							shadowColor: "rgba(0,0,0,0.45)",
							shadowOffset: 6,
							letterSpacing: 6,
							italic: false,
						}),
						opacity: reveal(localTime, 0.16, 0.45),
					}}
				>
					{str(params.text, "双面揭秘")}
				</div>
			</div>
		);
	},
};

// ── 目录标签 ────────────────────────────────────────────
const tabLabel: ComponentDefinition = {
	id: "text-tab-label",
	name: "Tab Label",
	nameKey: "textLib.comp.tabLabel",
	textGroup: "label",
	surface: "react",
	keywords: ["tab", "目录", "标签", "合集", "穿搭"],
	color: "#fda4af",
	inputs: [
		{ key: "text", type: "text", default: "穿搭合集", label: "Text", labelKey: "component.param.text" },
		colorInput({ defaultValue: "#0b0f19" }),
		accentInput({ defaultValue: "#fda4af" }),
		fontInput(),
	],
	...fixedSize({ width: 820, height: 220 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#fda4af");
		const e = pop(localTime, 0, 0.5);
		const text = reveal(localTime, 0.2, 0.4);
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<svg
					width="100%"
					height="100%"
					viewBox="0 0 820 220"
					style={{
						position: "absolute",
						inset: 0,
						transformOrigin: "center",
						transform: `scale(${0.8 + 0.2 * clamp01(e)})`,
						opacity: clamp01(e),
						filter: dropShadow({ color: "rgba(0,0,0,0.35)", blur: 12, y: 8 }),
					}}
				>
					<rect x="70" y="66" width="200" height="70" rx="16" fill={accent} />
					<rect x="70" y="100" width="680" height="120" rx="20" fill={accent} />
					<rect x="90" y="120" width="640" height="80" rx="14" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="4" strokeDasharray="14 12" />
				</svg>
				<div
					style={{
						position: "relative",
						...chunkyText({
							fontFamily,
							fontSize: 72,
							color: str(params.color, "#0b0f19"),
							outline: "rgba(255,255,255,0.75)",
							strokeWidth: 6,
							shadowColor: "rgba(0,0,0,0.2)",
							shadowOffset: 3,
							letterSpacing: 6,
							italic: false,
						}),
						opacity: text,
						transform: "translateY(10px)",
					}}
				>
					{str(params.text, "穿搭合集")}
				</div>
			</div>
		);
	},
};

export const TEXT_VARIANT_COMPONENTS: ComponentDefinition[] = [
	newsBar,
	glowTitle,
	heartTitle,
	checkTitle,
	pillLabel,
	starBurst,
	numberPlus,
	captionDots,
	ribbon,
	outlineTitle,
	cornerMarks,
	tabLabel,
];
