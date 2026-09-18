/**
 * [INPUT]: 依赖 runtime 组件契约、参数取值工具与文本分组分类。
 * [OUTPUT]: 对外提供 TEXT_COMPONENTS：标题组合/引用卡片/箭头标注/列表/数据/人物条等带内置入场动画的组合型文本组件。
 * [POS]: runtime/components 的内置文本组件库；只在文本面板出现，承载多段字号与装饰的单对象排版。
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
	fixedSize,
	fontInput,
	fontStack,
	pop,
	pulse,
	reveal,
	slideUp,
} from "./text-shared";
import { TEXT_EFFECT_COMPONENTS } from "./text-effects";
import { TEXT_VARIANT_COMPONENTS } from "./text-variants";

// ── 标题组合 ────────────────────────────────────────────
const titleStack: ComponentDefinition = {
	id: "text-title-stack",
	name: "Title Stack",
	nameKey: "textLib.comp.titleStack",
	textGroup: "combo",
	surface: "react",
	keywords: ["title", "标题", "组合", "subtitle", "副标题"],
	color: "#22d3ee",
	inputs: [
		{ key: "title", type: "text", default: "主标题", label: "Title", labelKey: "textLib.param.title" },
		{
			key: "subtitle",
			type: "text",
			default: "这里是一行副标题描述",
			label: "Subtitle",
			labelKey: "textLib.param.subtitle",
		},
		colorInput({ defaultValue: "#ffffff" }),
		accentInput({ defaultValue: "#22d3ee" }),
		fontInput(),
	],
	...fixedSize({ width: 1200, height: 250 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const color = str(params.color, "#ffffff");
		const bar = reveal(localTime, 0, 0.5);
		const t1 = reveal(localTime, 0.12, 0.5);
		const t2 = reveal(localTime, 0.3, 0.5);
		return (
			<div style={centerBox({ fontFamily: fontStack({ fontFamily }), gap: 22 })}>
				<div
					style={{
						width: 96,
						height: 8,
						borderRadius: 4,
						background: str(params.accent, "#22d3ee"),
						transform: `scaleX(${bar})`,
					}}
				/>
				<div
					style={{
						...chunkyText({
							fontFamily,
							fontSize: 104,
							color,
							outline: "#0b0f19",
							strokeWidth: 11,
							shadowColor: "rgba(0,0,0,0.45)",
							shadowOffset: 6,
							letterSpacing: 2,
							italic: false,
							lineHeight: 1.1,
						}),
						textAlign: "center",
						opacity: t1,
						transform: slideUp(t1, 28),
					}}
				>
					{str(params.title, "主标题")}
				</div>
				<div
					style={{
						fontSize: 44,
						fontWeight: 400,
						lineHeight: 1.2,
						textAlign: "center",
						color,
						opacity: 0.9 * t2,
						textShadow: "0 2px 8px rgba(0,0,0,0.65)",
						transform: slideUp(t2, 22),
					}}
				>
					{str(params.subtitle, "这里是一行副标题描述")}
				</div>
			</div>
		);
	},
};

// ── 高亮标题 ────────────────────────────────────────────
const highlightTitle: ComponentDefinition = {
	id: "text-highlight-title",
	name: "Highlight Title",
	nameKey: "textLib.comp.highlightTitle",
	textGroup: "title",
	surface: "react",
	keywords: ["title", "标题", "高亮", "highlight"],
	color: "#facc15",
	inputs: [
		{ key: "text", type: "text", default: "年度最佳", label: "Text", labelKey: "component.param.text" },
		{
			key: "highlight",
			type: "text",
			default: "剪辑技巧",
			label: "Highlight",
			labelKey: "textLib.param.highlight",
		},
		colorInput({ defaultValue: "#ffffff" }),
		accentInput({ defaultValue: "#facc15" }),
		fontInput(),
	],
	...fixedSize({ width: 1200, height: 170 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const t = reveal(localTime, 0, 0.45);
		const hl = reveal(localTime, 0.3, 0.5);
		return (
			<div
				style={centerBox({
					flexDirection: "row",
					flexWrap: "wrap",
					gap: 16,
					fontFamily: fontStack({ fontFamily }),
					fontSize: 84,
					fontWeight: 800,
					lineHeight: 1.2,
				})}
			>
				<span
					style={{
						...chunkyText({
							fontFamily,
							fontSize: 88,
							color: str(params.color, "#ffffff"),
							outline: "#0b0f19",
							strokeWidth: 10,
							shadowColor: "rgba(0,0,0,0.45)",
							shadowOffset: 5,
							letterSpacing: 2,
							italic: false,
						}),
						opacity: t,
						transform: `translateX(${(1 - t) * -28}px)`,
					}}
				>
					{str(params.text, "年度最佳")}
				</span>
				<span
					style={{
						display: "inline-block",
						color: "#111827",
						background: str(params.accent, "#facc15"),
						borderRadius: 12,
						padding: "0.04em 0.22em",
						clipPath: `inset(0 ${(1 - hl) * 100}% 0 0)`,
					}}
				>
					{str(params.highlight, "剪辑技巧")}
				</span>
			</div>
		);
	},
};

// ── 引用卡片 ────────────────────────────────────────────
const quoteCard: ComponentDefinition = {
	id: "text-quote-card",
	name: "Quote Card",
	nameKey: "textLib.comp.quoteCard",
	textGroup: "quote",
	surface: "react",
	keywords: ["quote", "引用", "卡片", "card"],
	color: "#22d3ee",
	inputs: [
		{
			key: "quote",
			type: "text",
			default: "真正的好剪辑，是让人忘记剪辑的存在。",
			label: "Quote",
			labelKey: "textLib.param.quote",
		},
		{ key: "author", type: "text", default: "佚名", label: "Author", labelKey: "textLib.param.author" },
		colorInput({ defaultValue: "#f8fafc" }),
		accentInput({ defaultValue: "#22d3ee" }),
		{
			key: "background",
			type: "color",
			default: "#0f172a",
			label: "Background",
			labelKey: "textLib.param.background",
		},
		fontInput(),
	],
	...fixedSize({ width: 1000, height: 400 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const card = reveal(localTime, 0, 0.45);
		const q = reveal(localTime, 0.18, 0.5);
		const a = reveal(localTime, 0.42, 0.5);
		return (
			<div
				style={{
					width: "100%",
					height: "100%",
					boxSizing: "border-box",
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					padding: "56px 64px",
					borderRadius: 24,
					background: str(params.background, "#0f172a"),
					fontFamily: fontStack({ fontFamily }),
					opacity: card,
					transform: `scale(${0.96 + 0.04 * card})`,
				}}
			>
				<div
					style={{
						fontSize: 140,
						lineHeight: 0.6,
						height: 70,
						color: str(params.accent, "#22d3ee"),
						fontWeight: 800,
						opacity: q,
						transform: slideUp(q, 16),
					}}
				>
					“
				</div>
				<div
					style={{
						fontSize: 40,
						lineHeight: 1.5,
						color: str(params.color, "#f8fafc"),
						opacity: q,
						transform: slideUp(q, 18),
					}}
				>
					{str(params.quote, "真正的好剪辑，是让人忘记剪辑的存在。")}
				</div>
				<div
					style={{
						marginTop: 28,
						textAlign: "right",
						fontSize: 30,
						color: str(params.color, "#f8fafc"),
						opacity: a * 0.7,
						transform: slideUp(a, 14),
					}}
				>
					—— {str(params.author, "佚名")}
				</div>
			</div>
		);
	},
};

// ── 箭头标注 ────────────────────────────────────────────
const arrowCallout: ComponentDefinition = {
	id: "text-arrow-callout",
	name: "Arrow Callout",
	nameKey: "textLib.comp.arrowCallout",
	textGroup: "annotation",
	surface: "react",
	keywords: ["annotation", "标注", "箭头", "arrow", "callout"],
	color: "#facc15",
	inputs: [
		{ key: "text", type: "text", default: "关键细节", label: "Text", labelKey: "component.param.text" },
		accentInput({ defaultValue: "#facc15" }),
		{
			key: "background",
			type: "color",
			default: "#111827",
			label: "Background",
			labelKey: "textLib.param.background",
		},
		fontInput(),
	],
	...fixedSize({ width: 1100, height: 170 }),
	render({ params, localTime }) {
		const accent = str(params.accent, "#facc15");
		const fontFamily = str(params.fontFamily, "Arial");
		const pill = pop(localTime, 0, 0.42);
		const line = reveal(localTime, 0.2, 0.5);
		const head = reveal(localTime, 0.62, 0.28);
		return (
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					alignItems: "center",
					fontFamily: fontStack({ fontFamily }),
				}}
			>
				<div
					style={{
						background: str(params.background, "#111827"),
						color: accent,
						fontSize: 36,
						fontWeight: 700,
						padding: "18px 32px",
						borderRadius: 14,
						whiteSpace: "nowrap",
						opacity: clamp01(pill),
						transform: `scale(${0.85 + 0.15 * pill})`,
					}}
				>
					{str(params.text, "关键细节")}
				</div>
				<div
					style={{
						flex: 1,
						height: 6,
						background: accent,
						marginLeft: 8,
						transform: `scaleX(${line})`,
						transformOrigin: "left center",
					}}
				/>
				<div
					style={{
						width: 0,
						height: 0,
						borderTop: "22px solid transparent",
						borderBottom: "22px solid transparent",
						borderLeft: `34px solid ${accent}`,
						opacity: head,
						transform: `translateX(${(1 - head) * 12}px)`,
					}}
				/>
			</div>
		);
	},
};

// ── 序号列表 ────────────────────────────────────────────
const numberedList: ComponentDefinition = {
	id: "text-numbered-list",
	name: "Numbered List",
	nameKey: "textLib.comp.numberedList",
	textGroup: "list",
	surface: "react",
	keywords: ["list", "列表", "序号", "numbered"],
	color: "#22d3ee",
	inputs: [
		{
			key: "items",
			type: "text",
			default: "第一步：准备素材\n第二步：粗剪与节奏\n第三步：加字幕与音效\n第四步：导出成片",
			label: "Items (one per line)",
			labelKey: "textLib.param.items",
		},
		colorInput({ defaultValue: "#f8fafc" }),
		accentInput({ defaultValue: "#22d3ee" }),
		fontInput(),
	],
	...fixedSize({ width: 900, height: 440 }),
	render({ params, localTime }) {
		const items = str(params.items, "")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.slice(0, 5);
		const fontFamily = str(params.fontFamily, "Arial");
		const accent = str(params.accent, "#22d3ee");
		const color = str(params.color, "#f8fafc");
		return (
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					gap: 24,
					fontFamily: fontStack({ fontFamily }),
				}}
			>
				{items.map((item, index) => {
					const r = reveal(localTime, 0.08 + index * 0.12, 0.45);
					const badge = pop(localTime, 0.08 + index * 0.12, 0.42);
					return (
						<div
							key={index}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 24,
								opacity: r,
								transform: `translateX(${(1 - r) * 32}px)`,
							}}
						>
							<div
								style={{
									width: 56,
									height: 56,
									borderRadius: 28,
									background: accent,
									color: "#0b0f19",
									fontSize: 28,
									fontWeight: 800,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									flexShrink: 0,
									transform: `scale(${0.6 + 0.4 * badge})`,
								}}
							>
								{String(index + 1).padStart(2, "0")}
							</div>
							<div
								style={chunkyText({
									fontFamily,
									fontSize: 38,
									color,
									outline: "#0b0f19",
									strokeWidth: 7,
									shadowColor: "rgba(0,0,0,0.4)",
									shadowOffset: 3,
									letterSpacing: 1,
									italic: false,
									lineHeight: 1.1,
								})}
							>
								{item}
							</div>
						</div>
					);
				})}
			</div>
		);
	},
};

// ── 流程步骤 ────────────────────────────────────────────
const stepsFlow: ComponentDefinition = {
	id: "text-steps-flow",
	name: "Steps Flow",
	nameKey: "textLib.comp.stepsFlow",
	textGroup: "list",
	surface: "react",
	keywords: ["steps", "流程", "步骤", "flow"],
	color: "#38bdf8",
	inputs: [
		{
			key: "steps",
			type: "text",
			default: "调研\n设计\n开发\n上线",
			label: "Steps (one per line)",
			labelKey: "textLib.param.steps",
		},
		colorInput({ defaultValue: "#f8fafc" }),
		accentInput({ defaultValue: "#38bdf8" }),
		fontInput(),
	],
	...fixedSize({ width: 1200, height: 170 }),
	render({ params, localTime }) {
		const steps = str(params.steps, "")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.slice(0, 5);
		const accent = str(params.accent, "#38bdf8");
		const color = str(params.color, "#f8fafc");
		const fontFamily = str(params.fontFamily, "Arial");
		return (
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					gap: 18,
					fontFamily: fontStack({ fontFamily }),
				}}
			>
				{steps.map((step, index) => {
					const circle = pop(localTime, 0.1 * index, 0.42);
					const label = reveal(localTime, 0.1 * index + 0.1, 0.4);
					const arrow = reveal(localTime, 0.1 * index + 0.22, 0.3);
					return (
						<div key={index} style={{ display: "flex", alignItems: "center", gap: 18 }}>
							<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
								<div
									style={{
										width: 64,
										height: 64,
										borderRadius: 32,
										border: `4px solid ${accent}`,
										color: accent,
										fontSize: 30,
										fontWeight: 800,
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										opacity: clamp01(circle),
										transform: `scale(${0.7 + 0.3 * circle})`,
									}}
								>
									{index + 1}
								</div>
								<div
									style={{
										...chunkyText({
											fontFamily,
											fontSize: 30,
											color,
											outline: "#0b0f19",
											strokeWidth: 6,
											shadowColor: "rgba(0,0,0,0.4)",
											shadowOffset: 3,
											letterSpacing: 1,
											italic: false,
											lineHeight: 1.1,
										}),
										opacity: label,
									}}
								>
									{step}
								</div>
							</div>
							{index < steps.length - 1 ? (
								<div
									style={{
										fontSize: 36,
										color: accent,
										alignSelf: "flex-start",
										marginTop: 8,
										opacity: arrow,
										transform: `translateX(${(1 - arrow) * -8}px)`,
									}}
								>
									→
								</div>
							) : null}
						</div>
					);
				})}
			</div>
		);
	},
};

// ── 数据大字 ────────────────────────────────────────────
const statFigure: ComponentDefinition = {
	id: "text-stat-figure",
	name: "Stat Figure",
	nameKey: "textLib.comp.statFigure",
	textGroup: "stat",
	surface: "react",
	keywords: ["stat", "数据", "数字", "number"],
	color: "#34d399",
	inputs: [
		{ key: "value", type: "text", default: "128%", label: "Value", labelKey: "textLib.param.value" },
		{
			key: "label",
			type: "text",
			default: "用户留存提升",
			label: "Label",
			labelKey: "textLib.param.label",
		},
		{
			key: "trend",
			type: "text",
			default: "↑ 24% 环比",
			label: "Trend",
			labelKey: "textLib.param.trend",
		},
		colorInput({ defaultValue: "#ffffff" }),
		accentInput({ defaultValue: "#34d399" }),
		fontInput(),
	],
	...fixedSize({ width: 900, height: 320 }),
	render({ params, localTime }) {
		const accent = str(params.accent, "#34d399");
		const fontFamily = str(params.fontFamily, "Arial");
		const v = pop(localTime, 0, 0.5);
		const l = reveal(localTime, 0.22, 0.45);
		const tr = reveal(localTime, 0.38, 0.45);
		const beat = pulse(localTime, 0.9);
		return (
			<div style={centerBox({ gap: 12, fontFamily: fontStack({ fontFamily }) })}>
				<div
					style={{
						...chunkyText({
							fontFamily,
							fontSize: 150,
							color: accent,
							outline: "#0b0f19",
							strokeWidth: 10,
							shadowColor: "rgba(0,0,0,0.45)",
							shadowOffset: 6,
							letterSpacing: 0,
							italic: false,
						}),
						opacity: clamp01(v),
						transform: `scale(${0.7 + 0.3 * v})`,
					}}
				>
					{str(params.value, "128%")}
				</div>
				<div
					style={{
						fontSize: 38,
						color: str(params.color, "#ffffff"),
						opacity: l,
						transform: slideUp(l, 16),
					}}
				>
					{str(params.label, "用户留存提升")}
				</div>
				<div
					style={{
						fontSize: 30,
						color: accent,
						opacity: tr * (0.85 + 0.15 * beat),
						transform: slideUp(tr, 12),
					}}
				>
					{str(params.trend, "↑ 24% 环比")}
				</div>
			</div>
		);
	},
};

// ── 人物条 ──────────────────────────────────────────────
const lowerThird: ComponentDefinition = {
	id: "text-lower-third",
	name: "Lower Third",
	nameKey: "textLib.comp.lowerThird",
	textGroup: "person",
	surface: "react",
	keywords: ["person", "人物", "姓名", "lower third"],
	color: "#38bdf8",
	inputs: [
		{ key: "name", type: "text", default: "张三", label: "Name", labelKey: "textLib.param.name" },
		{ key: "role", type: "text", default: "产品负责人", label: "Role", labelKey: "textLib.param.role" },
		colorInput({ defaultValue: "#ffffff" }),
		accentInput({ defaultValue: "#38bdf8" }),
		{
			key: "background",
			type: "color",
			default: "#0b0f19d9",
			label: "Background",
			labelKey: "textLib.param.background",
		},
		fontInput(),
	],
	...fixedSize({ width: 1200, height: 190 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const color = str(params.color, "#ffffff");
		const bar = reveal(localTime, 0, 0.45);
		const content = reveal(localTime, 0.14, 0.5);
		return (
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					alignItems: "stretch",
					fontFamily: fontStack({ fontFamily }),
				}}
			>
				<div
					style={{
						width: 12,
						borderRadius: 6,
						background: str(params.accent, "#38bdf8"),
						margin: "24px 0",
						transform: `scaleY(${bar})`,
					}}
				/>
				<div
					style={{
						marginLeft: 28,
						padding: "24px 40px",
						borderRadius: 12,
						background: str(params.background, "#0b0f19d9"),
						display: "flex",
						flexDirection: "column",
						justifyContent: "center",
						gap: 8,
						opacity: content,
						transform: `translateX(${(1 - content) * 44}px)`,
					}}
				>
					<div
						style={chunkyText({
							fontFamily,
							fontSize: 58,
							color,
							outline: "#0b0f19",
							strokeWidth: 8,
							shadowColor: "rgba(0,0,0,0.45)",
							shadowOffset: 4,
							letterSpacing: 1,
							italic: false,
						})}
					>
						{str(params.name, "张三")}
					</div>
					<div style={{ fontSize: 30, color, opacity: 0.72, textShadow: "0 2px 6px rgba(0,0,0,0.6)" }}>
						{str(params.role, "产品负责人")}
					</div>
				</div>
			</div>
		);
	},
};

// ── 标签徽章 ────────────────────────────────────────────
const badgeLabel: ComponentDefinition = {
	id: "text-badge-label",
	name: "Badge Label",
	nameKey: "textLib.comp.badgeLabel",
	textGroup: "label",
	surface: "react",
	keywords: ["label", "标签", "徽章", "badge"],
	color: "#ef4444",
	inputs: [
		{ key: "text", type: "text", default: "限时特惠", label: "Text", labelKey: "component.param.text" },
		colorInput({ defaultValue: "#ffffff" }),
		accentInput({ defaultValue: "#ef4444" }),
		fontInput(),
	],
	...fixedSize({ width: 640, height: 130 }),
	render({ params, localTime }) {
		const fontFamily = str(params.fontFamily, "Arial");
		const badge = pop(localTime, 0, 0.5);
		const beat = pulse(localTime, 1);
		return (
			<div style={centerBox({ fontFamily: fontStack({ fontFamily }) })}>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 18,
						background: str(params.accent, "#ef4444"),
						color: str(params.color, "#ffffff"),
						fontSize: 42,
						fontWeight: 700,
						padding: "18px 44px",
						borderRadius: 999,
						opacity: clamp01(badge),
						transform: `scale(${0.7 + 0.3 * badge + 0.015 * beat})`,
					}}
				>
					<div
						style={{
							width: 16,
							height: 16,
							borderRadius: 8,
							background: str(params.color, "#ffffff"),
						}}
					/>
					<span
						style={chunkyText({
							fontFamily,
							fontSize: 44,
							color: str(params.color, "#ffffff"),
							outline: "#0b0f19",
							strokeWidth: 8,
							shadowColor: "rgba(0,0,0,0.35)",
							shadowOffset: 3,
							letterSpacing: 2,
							italic: false,
						})}
					>
						{str(params.text, "限时特惠")}
					</span>
				</div>
			</div>
		);
	},
};

/** 基础组合型文本组件（结构型）。 */
export const TEXT_CORE_COMPONENTS: ComponentDefinition[] = [
	titleStack,
	highlightTitle,
	quoteCard,
	arrowCallout,
	numberedList,
	stepsFlow,
	statFigure,
	lowerThird,
	badgeLabel,
];

/** 文本面板全部内置文本组件：结构型 + 视觉冲击型（SVG 装饰）+ 风格多样型。 */
export const TEXT_COMPONENTS: ComponentDefinition[] = [
	...TEXT_CORE_COMPONENTS,
	...TEXT_EFFECT_COMPONENTS,
	...TEXT_VARIANT_COMPONENTS,
];

export function isTextComponent(definition: ComponentDefinition): boolean {
	return Boolean(definition.textGroup);
}
