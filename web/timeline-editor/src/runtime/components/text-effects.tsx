/**
 * [INPUT]: 依赖 runtime 组件契约、文本共享基座（动画原语 / SVG 几何 / chunky 展示字 / 参数工厂）与参数取值工具。
 * [OUTPUT]: 对外提供 TEXT_EFFECT_COMPONENTS：霓虹/流光/立体/横幅/笔刷/星芒/气泡/胶带等视觉冲击型文本组件。
 * [POS]: runtime/components 文本组件的「视觉表现」批次；与 text-library 的结构型组件合并进文本面板。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { ComponentDefinition } from "../types";
import { str } from "../utils";
import {
	accentInput,
	burstPoints,
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

// ── 霓虹灯牌 ────────────────────────────────────────────
const neonSign: ComponentDefinition = {
	id: "text-neon-sign",
	name: "Neon Sign",
	nameKey: "textLib.comp.neonSign",
	textGroup: "title",
	surface: "react",
	keywords: ["neon", "霓虹", "标题", "发光"],
	color: "#f472b6",
	inputs: [
		{ key: "text", type: "text", default: "RECUT", label: "Text", labelKey: "component.param.text" },
		colorInput({ defaultValue: "#ffffff" }),
		accentInput({ defaultValue: "#f472b6" }),
		fontInput(),
	],
	...fixedSize({ width: 1200, height: 300 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#f472b6");
		const color = str(params.color, "#ffffff");
		const e = reveal(localTime, 0, 0.5);
		const flicker = pulse(localTime, 9) > 0.86 ? 0.5 : 1;
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<svg width="100%" height="100%" viewBox="0 0 1200 300" style={{ position: "absolute", inset: 0, opacity: 0.9 * e }}>
					<path
						d="M170 236 H1030"
						stroke={accent}
						strokeWidth="6"
						strokeLinecap="round"
						style={{ filter: dropShadow({ color: accent, blur: 16 }) }}
					/>
				</svg>
				<div
					style={{
						position: "relative",
						fontFamily: `"${fontFamily}", "PingFang SC", "Microsoft YaHei", sans-serif`,
						fontSize: 156,
						fontWeight: 800,
						letterSpacing: 8,
						lineHeight: 1,
						color,
						opacity: e * flicker,
						textShadow: `0 0 6px #ffffff, 0 0 16px ${accent}, 0 0 34px ${accent}, 0 0 64px ${accent}`,
						transform: slideUp(e, 18),
					}}
				>
					{str(params.text, "RECUT")}
				</div>
			</div>
		);
	},
};

// ── 流光标题 ────────────────────────────────────────────
const shineTitle: ComponentDefinition = {
	id: "text-shine-title",
	name: "Shine Title",
	nameKey: "textLib.comp.shineTitle",
	textGroup: "title",
	surface: "react",
	keywords: ["shine", "流光", "扫光", "标题", "金属"],
	color: "#facc15",
	inputs: [
		{ key: "text", type: "text", default: "高光时刻", label: "Text", labelKey: "component.param.text" },
		accentInput({ defaultValue: "#facc15" }),
		fontInput(),
	],
	...fixedSize({ width: 1200, height: 260 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#facc15");
		const e = reveal(localTime, 0, 0.5);
		const shine = (localTime * 0.5) % 1;
		return (
			<div style={centerBox({ fontFamily: fontStack({ fontFamily }) })}>
				<GradientFillText
					text={str(params.text, "高光时刻")}
					fontFamily={fontFamily}
					fontSize={150}
					letterSpacing={4}
					italic
					gradient={`linear-gradient(100deg, ${accent} 0%, ${accent} 30%, #fffbe6 50%, ${accent} 70%, ${accent} 100%)`}
					gradientStyle={{
						backgroundSize: "250% 100%",
						backgroundPosition: `${(1 - shine) * 100}% 0`,
					}}
					outline={DARK}
					strokeWidth={10}
					style={{
						opacity: e,
						transform: slideUp(e, 22),
						filter: dropShadow({ color: "rgba(0,0,0,0.5)", blur: 12, y: 9 }),
					}}
				/>
			</div>
		);
	},
};

// ── 立体标题 ────────────────────────────────────────────
const title3d: ComponentDefinition = {
	id: "text-3d-title",
	name: "3D Title",
	nameKey: "textLib.comp.title3d",
	textGroup: "title",
	surface: "react",
	keywords: ["3d", "立体", "标题", "挤出", "厚度"],
	color: "#38bdf8",
	inputs: [
		{ key: "text", type: "text", default: "为梦想而战", label: "Text", labelKey: "component.param.text" },
		accentInput({ defaultValue: "#38bdf8" }),
		{
			key: "background",
			type: "color",
			default: "#0b1220",
			label: "Extrude",
			labelKey: "textLib.param.extrude",
		},
		fontInput(),
	],
	...fixedSize({ width: 1200, height: 300 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#38bdf8");
		const extrude = str(params.background, "#0b1220");
		const e = reveal(localTime, 0, 0.5);
		const depth = Array.from(
			{ length: 14 },
			(_, index) => `${(index + 1) * 2}px ${(index + 1) * 2}px 0 ${extrude}`,
		).join(", ");
		return (
			<div style={centerBox({ fontFamily: fontStack({ fontFamily }) })}>
				<div
					style={{
						...chunkyText({
							fontFamily,
							fontSize: 150,
							color: accent,
							outline: "rgba(6,12,30,0.85)",
							strokeWidth: 4,
							shadowColor: "rgba(0,0,0,0)",
							letterSpacing: 2,
						}),
						textShadow: `${depth}, 0 -4px 0 rgba(255,255,255,0.6)`,
						opacity: e,
						transform: `translateY(${(1 - e) * 34}px) scale(${0.9 + 0.1 * e})`,
					}}
				>
					{str(params.text, "为梦想而战")}
				</div>
			</div>
		);
	},
};

// ── 横幅标题（记得点赞哦）────────────────────────────────
const bannerTitle: ComponentDefinition = {
	id: "text-banner-title",
	name: "Banner Title",
	nameKey: "textLib.comp.bannerTitle",
	textGroup: "combo",
	surface: "react",
	keywords: ["banner", "横幅", "贴纸", "标题", "点赞"],
	color: "#fde047",
	inputs: [
		{ key: "text", type: "text", default: "记得点赞哦", label: "Text", labelKey: "component.param.text" },
		colorInput({ defaultValue: "#fffdf5" }),
		accentInput({ defaultValue: "#fde047" }),
		fontInput(),
	],
	...fixedSize({ width: 1200, height: 320 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#fde047");
		const e = reveal(localTime, 0, 0.5);
		const text = pop(localTime, 0.12, 0.5);
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<svg
					width="100%"
					height="100%"
					viewBox="0 0 1200 320"
					style={{
						position: "absolute",
						inset: 0,
						transformOrigin: "center",
						transform: `rotate(-2deg) scaleX(${e}) scaleY(${0.86 + 0.14 * e})`,
						filter: dropShadow({ color: "rgba(0,0,0,0.4)", blur: 14, y: 10 }),
					}}
				>
					<rect x="110" y="104" width="980" height="126" rx="63" fill={accent} stroke="rgba(80,60,0,0.35)" strokeWidth="5" />
					<rect
						x="138"
						y="128"
						width="924"
						height="78"
						rx="39"
						fill="none"
						stroke="rgba(80,60,0,0.45)"
						strokeWidth="5"
						strokeDasharray="16 14"
					/>
					<rect x="120" y="150" width="72" height="20" rx="10" fill="rgba(255,255,255,0.85)" />
					<rect x="1008" y="150" width="72" height="20" rx="10" fill="rgba(255,255,255,0.85)" />
				</svg>
				<div
					style={{
						position: "relative",
						...chunkyText({
							fontFamily,
							fontSize: 128,
							color: str(params.color, "#fffdf5"),
							outline: "#3b2f0b",
							strokeWidth: 14,
							shadowColor: "#2a2206",
							shadowOffset: 7,
							letterSpacing: 6,
						}),
						opacity: clamp01(text),
						transform: `rotate(-2deg) scale(${0.8 + 0.2 * text})`,
					}}
				>
					{str(params.text, "记得点赞哦")}
				</div>
			</div>
		);
	},
};

// ── 笔刷标题 ────────────────────────────────────────────
const brushTitle: ComponentDefinition = {
	id: "text-brush-title",
	name: "Brush Title",
	nameKey: "textLib.comp.brushTitle",
	textGroup: "title",
	surface: "react",
	keywords: ["brush", "笔刷", "涂鸦", "标题"],
	color: "#84cc16",
	inputs: [
		{ key: "text", type: "text", default: "快速聚焦", label: "Text", labelKey: "component.param.text" },
		colorInput({ defaultValue: "#ffffff" }),
		accentInput({ defaultValue: "#a3e635" }),
		fontInput(),
	],
	...fixedSize({ width: 1200, height: 300 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#a3e635");
		const e = reveal(localTime, 0, 0.5);
		const text = reveal(localTime, 0.22, 0.45);
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<svg
					width="100%"
					height="100%"
					viewBox="0 0 1200 300"
					style={{ position: "absolute", inset: 0 }}
					preserveAspectRatio="none"
				>
					<g
						style={{
							transformOrigin: "left center",
							transform: `scaleX(${e})`,
							filter: dropShadow({ color: "rgba(0,0,0,0.35)", blur: 12, y: 8 }),
						}}
					>
						<path
							d="M120 150 C 330 136 780 140 1024 152 C 1096 156 1134 170 1130 192 C 1126 216 1058 230 976 234 C 716 244 320 242 176 232 C 118 228 104 214 104 194 C 104 174 108 156 120 150 Z"
							fill={accent}
						/>
						<path
							d="M160 168 C 420 158 820 160 1060 172"
							fill="none"
							stroke="rgba(255,255,255,0.5)"
							strokeWidth="14"
							strokeLinecap="round"
						/>
					</g>
				</svg>
				<div
					style={{
						position: "relative",
						...chunkyText({
							fontFamily,
							fontSize: 120,
							color: str(params.color, "#ffffff"),
							outline: "#1a2e05",
							strokeWidth: 13,
							shadowColor: "rgba(0,0,0,0.45)",
							shadowOffset: 7,
							letterSpacing: 4,
						}),
						opacity: text,
						transform: `rotate(-2deg) scale(${0.94 + 0.06 * text})`,
					}}
				>
					{str(params.text, "快速聚焦")}
				</div>
			</div>
		);
	},
};

// ── 下划线标题 ──────────────────────────────────────────
const underlineTitle: ComponentDefinition = {
	id: "text-underline-title",
	name: "Underline Title",
	nameKey: "textLib.comp.underlineTitle",
	textGroup: "title",
	surface: "react",
	keywords: ["underline", "下划线", "标题", "手绘"],
	color: "#22d3ee",
	inputs: [
		{ key: "text", type: "text", default: "划重点", label: "Text", labelKey: "component.param.text" },
		colorInput({ defaultValue: "#ffffff" }),
		accentInput({ defaultValue: "#22d3ee" }),
		fontInput(),
	],
	...fixedSize({ width: 1200, height: 280 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#22d3ee");
		const e = reveal(localTime, 0, 0.45);
		const draw = reveal(localTime, 0.28, 0.6);
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }), gap: 6 })}>
				<div
					style={{
						...chunkyText({
							fontFamily,
							fontSize: 126,
							color: str(params.color, "#ffffff"),
							outline: DARK,
							strokeWidth: 13,
							shadowColor: "rgba(0,0,0,0.45)",
							shadowOffset: 7,
							letterSpacing: 4,
						}),
						opacity: e,
						transform: slideUp(e, 18),
					}}
				>
					{str(params.text, "划重点")}
				</div>
				<svg width="1200" height="48" viewBox="0 0 1200 48" style={{ marginTop: -4 }}>
					<path
						d="M170 30 C 420 10 820 10 1050 30"
						fill="none"
						stroke={accent}
						strokeWidth="18"
						strokeLinecap="round"
						pathLength={1}
						strokeDasharray={1}
						strokeDashoffset={1 - draw}
						style={{ filter: dropShadow({ color: accent, blur: 10 }) }}
					/>
				</svg>
			</div>
		);
	},
};

// ── 闪亮标题 ────────────────────────────────────────────
const sparkleTitle: ComponentDefinition = {
	id: "text-sparkle-title",
	name: "Sparkle Title",
	nameKey: "textLib.comp.sparkleTitle",
	textGroup: "title",
	surface: "react",
	keywords: ["sparkle", "闪亮", "星星", "标题", "金色"],
	color: "#fbbf24",
	inputs: [
		{ key: "text", type: "text", default: "超可爱", label: "Text", labelKey: "component.param.text" },
		accentInput({ defaultValue: "#fbbf24" }),
		fontInput(),
	],
	...fixedSize({ width: 1200, height: 300 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const e = reveal(localTime, 0, 0.5);
		const sparkles = [
			{ cx: 232, cy: 78, r: 46 },
			{ cx: 980, cy: 70, r: 56 },
			{ cx: 176, cy: 236, r: 32 },
			{ cx: 1032, cy: 226, r: 40 },
		];
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<svg width="100%" height="100%" viewBox="0 0 1200 300" style={{ position: "absolute", inset: 0 }}>
					{sparkles.map((sparkle, index) => {
						const twinkle = pulse(localTime, 1.4 + index * 0.5);
						const scale = 0.5 + 0.6 * twinkle;
						const phase = reveal(localTime, 0.18 + index * 0.08, 0.4);
						return (
							<path
								key={index}
								d={sparklePath(sparkle)}
								fill="#fffbeb"
								stroke="#f59e0b"
								strokeWidth="3"
								opacity={phase * (0.6 + 0.4 * twinkle)}
								transform={`translate(${sparkle.cx} ${sparkle.cy}) scale(${scale}) translate(${-sparkle.cx} ${-sparkle.cy})`}
								style={{ filter: dropShadow({ color: "#fde68a", blur: 14 }) }}
							/>
						);
					})}
				</svg>
				<GradientFillText
					text={str(params.text, "超可爱")}
					fontFamily={fontFamily}
					fontSize={152}
					letterSpacing={3}
					italic
					gradient="linear-gradient(180deg,#fffbe6 0%,#fbbf24 50%,#b45309 100%)"
					outline="#ffffff"
					strokeWidth={14}
					style={{
						opacity: e,
						transform: `translateY(${(1 - e) * 24}px) scale(${0.9 + 0.1 * e})`,
						filter: dropShadow({ color: "rgba(0,0,0,0.45)", blur: 14, y: 9 }),
					}}
				/>
			</div>
		);
	},
};

// ── 贴纸爆炸 ────────────────────────────────────────────
const stickerPop: ComponentDefinition = {
	id: "text-sticker-pop",
	name: "Sticker Pop",
	nameKey: "textLib.comp.stickerPop",
	textGroup: "combo",
	surface: "react",
	keywords: ["sticker", "贴纸", "爆炸", "标题", "促销"],
	color: "#ef4444",
	inputs: [
		{ key: "text", type: "text", default: "冲呀", label: "Text", labelKey: "component.param.text" },
		accentInput({ defaultValue: "#ef4444" }),
		fontInput(),
	],
	...fixedSize({ width: 860, height: 380 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#ef4444");
		const e = pop(localTime, 0, 0.6);
		const spin = (1 - clamp01(e)) * -16;
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<svg
					width="100%"
					height="100%"
					viewBox="0 0 860 380"
					style={{ position: "absolute", inset: 0, filter: dropShadow({ color: "rgba(0,0,0,0.4)", blur: 16, y: 10 }) }}
				>
					<polygon
						points={burstPoints({ cx: 430, cy: 190, rOuter: 322, rInner: 224, spikes: 12 })}
						fill={accent}
						opacity={clamp01(e)}
						transform={`rotate(${spin} 430 190)`}
					/>
					<polygon
						points={burstPoints({ cx: 430, cy: 190, rOuter: 276, rInner: 208, spikes: 12 })}
						fill="#ffffff"
						opacity={clamp01(e)}
						transform={`rotate(${spin} 430 190)`}
					/>
					<polygon
						points={burstPoints({ cx: 430, cy: 190, rOuter: 238, rInner: 188, spikes: 12 })}
						fill={accent}
						opacity={0.96 * clamp01(e)}
						transform={`rotate(${spin} 430 190)`}
					/>
				</svg>
				<div
					style={{
						position: "relative",
						...chunkyText({
							fontFamily,
							fontSize: 138,
							color: "#ffffff",
							outline: accent,
							strokeWidth: 18,
							shadowColor: "rgba(120,0,0,0.5)",
							shadowOffset: 7,
							letterSpacing: 4,
						}),
						opacity: clamp01(e * 1.5),
						transform: `rotate(${(1 - clamp01(e)) * -8}deg) scale(${0.7 + 0.3 * clamp01(e)})`,
					}}
				>
					{str(params.text, "冲呀")}
				</div>
			</div>
		);
	},
};

// ── 漫画气泡 ────────────────────────────────────────────
const comicBubble: ComponentDefinition = {
	id: "text-comic-bubble",
	name: "Comic Bubble",
	nameKey: "textLib.comp.comicBubble",
	textGroup: "quote",
	surface: "react",
	keywords: ["comic", "气泡", "对话", "引用", "bubble"],
	color: "#f59e0b",
	inputs: [
		{ key: "text", type: "text", default: "这也太顶了吧！", label: "Text", labelKey: "component.param.text" },
		colorInput({ defaultValue: "#111827" }),
		{ key: "background", type: "color", default: "#ffffff", label: "Background", labelKey: "textLib.param.background" },
		fontInput(),
	],
	...fixedSize({ width: 1000, height: 440 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const e = pop(localTime, 0, 0.55);
		const text = reveal(localTime, 0.22, 0.42);
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<svg
					width="100%"
					height="100%"
					viewBox="0 0 1000 440"
					style={{
						position: "absolute",
						inset: 0,
						transformOrigin: "center",
						transform: `scale(${0.86 + 0.14 * clamp01(e)})`,
						opacity: clamp01(e),
						filter: dropShadow({ color: "rgba(0,0,0,0.4)", blur: 18, y: 12 }),
					}}
				>
					<path
						d="M92 36 H908 Q964 36 964 92 V286 Q964 342 908 342 H404 L316 428 L338 342 H92 Q36 342 36 286 V92 Q36 36 92 36 Z"
						fill={str(params.background, "#ffffff")}
						stroke="#111827"
						strokeWidth="9"
					/>
				</svg>
				<div
					style={{
						position: "relative",
						maxWidth: 760,
						marginBottom: 26,
						textAlign: "center",
						fontFamily: `"${fontFamily}", "PingFang SC", "Microsoft YaHei", sans-serif`,
						fontSize: 78,
						fontWeight: 900,
						lineHeight: 1.25,
						color: str(params.color, "#111827"),
						opacity: text,
						transform: slideUp(text, 14),
					}}
				>
					{str(params.text, "这也太顶了吧！")}
				</div>
			</div>
		);
	},
};

// ── 胶带标签 ────────────────────────────────────────────
const tapeLabel: ComponentDefinition = {
	id: "text-tape-label",
	name: "Tape Label",
	nameKey: "textLib.comp.tapeLabel",
	textGroup: "label",
	surface: "react",
	keywords: ["tape", "胶带", "标签", "贴纸"],
	color: "#fbbf24",
	inputs: [
		{ key: "text", type: "text", default: "内置福利", label: "Text", labelKey: "component.param.text" },
		colorInput({ defaultValue: "#fffdf5" }),
		accentInput({ defaultValue: "#fbbf24" }),
		fontInput(),
	],
	...fixedSize({ width: 820, height: 240 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#fbbf24");
		const e = pop(localTime, 0, 0.5);
		const angle = -8 + 4 * clamp01(e);
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<svg
					width="100%"
					height="100%"
					viewBox="0 0 820 240"
					style={{
						position: "absolute",
						inset: 0,
						transformOrigin: "center",
						transform: `rotate(${angle}deg) scale(${0.82 + 0.18 * clamp01(e)})`,
						opacity: clamp01(e),
						filter: dropShadow({ color: "rgba(0,0,0,0.35)", blur: 12, y: 8 }),
					}}
				>
					<path d="M76 74 L28 100 L76 178 Z" fill={accent} opacity="0.6" />
					<path d="M744 74 L792 100 L744 178 Z" fill={accent} opacity="0.6" />
					<rect x="74" y="70" width="672" height="112" fill={accent} />
					<path d="M74 92 H746 M74 160 H746" stroke="rgba(255,255,255,0.45)" strokeWidth="3" />
				</svg>
				<div
					style={{
						position: "relative",
						...chunkyText({
							fontFamily,
							fontSize: 78,
							color: str(params.color, "#fffdf5"),
							outline: "#5b4505",
							strokeWidth: 9,
							shadowColor: "rgba(0,0,0,0.35)",
							shadowOffset: 5,
							letterSpacing: 10,
						}),
						opacity: reveal(localTime, 0.22, 0.4),
						transform: `rotate(${angle}deg)`,
					}}
				>
					{str(params.text, "内置福利")}
				</div>
			</div>
		);
	},
};

// ── 角框标题 ────────────────────────────────────────────
const cornerFrame: ComponentDefinition = {
	id: "text-corner-frame",
	name: "Corner Frame",
	nameKey: "textLib.comp.cornerFrame",
	textGroup: "combo",
	surface: "react",
	keywords: ["frame", "角框", "取景框", "标题", "重点"],
	color: "#22d3ee",
	inputs: [
		{ key: "text", type: "text", default: "重点关注", label: "Text", labelKey: "component.param.text" },
		colorInput({ defaultValue: "#ffffff" }),
		accentInput({ defaultValue: "#22d3ee" }),
		fontInput(),
	],
	...fixedSize({ width: 1000, height: 320 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#22d3ee");
		const e = reveal(localTime, 0, 0.5);
		const d = (1 - e) * 26;
		const corners = [
			{ d: `M44 116 V44 H116`, tx: -d, ty: -d },
			{ d: `M884 44 H956 V116`, tx: d, ty: -d },
			{ d: `M44 204 V276 H116`, tx: -d, ty: d },
			{ d: `M884 276 H956 V204`, tx: d, ty: d },
		];
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<svg width="100%" height="100%" viewBox="0 0 1000 320" style={{ position: "absolute", inset: 0 }}>
					{corners.map((corner, index) => (
						<path
							key={index}
							d={corner.d}
							fill="none"
							stroke={accent}
							strokeWidth="14"
							strokeLinecap="round"
							opacity={e}
							transform={`translate(${corner.tx} ${corner.ty})`}
							style={{ filter: dropShadow({ color: accent, blur: 10 }) }}
						/>
					))}
				</svg>
				<div
					style={{
						...chunkyText({
							fontFamily,
							fontSize: 110,
							color: str(params.color, "#ffffff"),
							outline: DARK,
							strokeWidth: 12,
							shadowColor: "rgba(0,0,0,0.45)",
							shadowOffset: 6,
							letterSpacing: 6,
						}),
						opacity: reveal(localTime, 0.2, 0.45),
					}}
				>
					{str(params.text, "重点关注")}
				</div>
			</div>
		);
	},
};

// ── 速度线强调 ──────────────────────────────────────────
const speedLines: ComponentDefinition = {
	id: "text-speed-lines",
	name: "Speed Lines",
	nameKey: "textLib.comp.speedLines",
	textGroup: "annotation",
	surface: "react",
	keywords: ["speed", "速度线", "强调", "动感"],
	color: "#facc15",
	inputs: [
		{ key: "text", type: "text", default: "最新资讯速递", label: "Text", labelKey: "component.param.text" },
		colorInput({ defaultValue: "#0b0f19" }),
		accentInput({ defaultValue: "#facc15" }),
		fontInput(),
	],
	...fixedSize({ width: 1000, height: 240 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#facc15");
		const bars = [
			{ y: 56, width: 900 },
			{ y: 112, width: 950 },
			{ y: 168, width: 870 },
		];
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<svg
					width="100%"
					height="100%"
					viewBox="0 0 1000 240"
					style={{ position: "absolute", inset: 0 }}
					preserveAspectRatio="none"
				>
					{bars.map((bar, index) => {
						const l = reveal(localTime, 0.08 * index, 0.42);
						return (
							<rect
								key={bar.y}
								x={(1000 - bar.width) / 2}
								y={bar.y}
								width={bar.width}
								height={14}
								rx={7}
								fill={accent}
								opacity={0.92 * l}
								transform={`translate(${(1 - l) * -180} 0)`}
							/>
						);
					})}
				</svg>
				<div
					style={{
						position: "relative",
						padding: "12px 48px",
						background: str(params.color, "#0b0f19"),
						border: `6px solid ${accent}`,
						...chunkyText({
							fontFamily,
							fontSize: 84,
							color: accent,
							outline: "transparent",
							strokeWidth: 0,
							shadowColor: "rgba(0,0,0,0.45)",
							shadowOffset: 6,
							letterSpacing: 3,
						}),
						opacity: reveal(localTime, 0.24, 0.45),
						transform: "skewX(-8deg)",
					}}
				>
					{str(params.text, "最新资讯速递")}
				</div>
			</div>
		);
	},
};

// ── 荧光笔高亮 ──────────────────────────────────────────
const highlightMarker: ComponentDefinition = {
	id: "text-highlight-marker",
	name: "Marker Highlight",
	nameKey: "textLib.comp.highlightMarker",
	textGroup: "body",
	surface: "react",
	keywords: ["marker", "荧光笔", "高亮", "重点", "正文"],
	color: "#fde047",
	inputs: [
		{ key: "text", type: "text", default: "划重点：这一步别跳过", label: "Text", labelKey: "component.param.text" },
		colorInput({ defaultValue: "#0b0f19" }),
		accentInput({ defaultValue: "#fde047" }),
		fontInput(),
	],
	...fixedSize({ width: 1200, height: 230 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#fde047");
		const e = reveal(localTime, 0.12, 0.5);
		const text = reveal(localTime, 0, 0.45);
		return (
			<div style={centerBox({ position: "relative", fontFamily: fontStack({ fontFamily }) })}>
				<svg
					width="100%"
					height="100%"
					viewBox="0 0 1200 230"
					style={{ position: "absolute", inset: 0 }}
					preserveAspectRatio="none"
				>
					<rect
						x="120"
						y="78"
						width="960"
						height="82"
						rx="20"
						fill={accent}
						opacity="0.82"
						transform={`translate(120 0) scale(${e} 1) translate(-120 0) rotate(-1.4 600 119)`}
					/>
					<rect
						x="150"
						y="96"
						width="880"
						height="20"
						rx="10"
						fill="rgba(255,255,255,0.55)"
						transform={`translate(120 0) scale(${e} 1) translate(-120 0) rotate(-1.4 600 119)`}
					/>
				</svg>
				<div
					style={{
						position: "relative",
						fontFamily: `"${fontFamily}", "Arial Black", Impact, "PingFang SC", sans-serif`,
						fontSize: 86,
						fontWeight: 900,
						fontStyle: "italic",
						letterSpacing: 1,
						lineHeight: 1,
						color: str(params.color, "#0b0f19"),
						opacity: text,
						transform: slideUp(text, 16),
					}}
				>
					{str(params.text, "划重点：这一步别跳过")}
				</div>
			</div>
		);
	},
};

export const TEXT_EFFECT_COMPONENTS: ComponentDefinition[] = [
	neonSign,
	shineTitle,
	title3d,
	bannerTitle,
	brushTitle,
	underlineTitle,
	sparkleTitle,
	stickerPop,
	comicBubble,
	tapeLabel,
	cornerFrame,
	speedLines,
	highlightMarker,
];
