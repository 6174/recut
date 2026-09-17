import type { ComponentDefinition } from "../types";
import { num, str } from "../utils";

/**
 * surface 示例组件（Phase A 验证 L1/L2 承载面）。
 * L1 "html"：render 返回字符串模板，动画用 anim 内联值。
 * L2 "react"：render 返回 JSX/DOM 元素树，经 HtmlObject 的独立 react-dom root 挂到离屏 DOM。
 */

export const htmlBadgeComponent: ComponentDefinition = {
	id: "html-badge",
	name: "HTML Badge",
	nameKey: "component.name.htmlBadge",
	group: "demo",
	surface: "html",
	keywords: ["html", "badge", "标签", "横幅", "live"],
	color: "#f59e0b",
	inputs: [
		{
			key: "text",
			type: "text",
			default: "LIVE",
			label: "Text",
			labelKey: "component.param.text",
		},
		{
			key: "color",
			type: "color",
			default: "#ef4444",
			label: "Primary color",
			labelKey: "component.param.mainColor",
		},
	],
	getBaseSize: ({ params }) => ({ width: 420, height: 180 }),
	render({ params, progress, anim }) {
		const text = str(params.text, "LIVE");
		const color = str(params.color, "#ef4444");
		const pulse = anim.pulse(progress, { speed: 2 });
		const scale = 1 + pulse * 0.12;
		return `
<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-family:sans-serif;">
  <div style="background:${color};color:#fff;font-weight:700;font-size:40px;padding:10px 26px;border-radius:12px;transform:scale(${scale.toFixed(3)});">
    ${text}
  </div>
</div>`;
	},
};

export const reactPulseCardComponent: ComponentDefinition = {
	id: "react-pulse-card",
	name: "React Pulse Card",
	nameKey: "component.name.reactPulseCard",
	group: "demo",
	surface: "react",
	keywords: ["react", "card", "卡片", "pulse", "跳动"],
	color: "#0ea5e9",
	inputs: [
		{
			key: "text",
			type: "text",
			default: "Recut",
			label: "Text",
			labelKey: "component.param.text",
		},
		{
			key: "color",
			type: "color",
			default: "#0ea5e9",
			label: "Primary color",
			labelKey: "component.param.mainColor",
		},
		{
			key: "rounded",
			type: "number",
			default: 16,
			min: 0,
			max: 64,
			step: 1,
			label: "Corner radius",
			labelKey: "component.param.cornerRadius",
		},
	],
	getBaseSize: ({ params }) => ({ width: 420, height: 180 }),
	render({ params, progress, anim }) {
		const text = str(params.text, "Recut");
		const color = str(params.color, "#0ea5e9");
		const rounded = num(params.rounded, 16);
		const p = anim.pulse(progress, { speed: 1.5 });
		return (
			<div
				style={{
					width: "100%",
					height: "100%",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					fontFamily: "sans-serif",
				}}
			>
				<div
					style={{
						background: color,
						color: "#fff",
						fontWeight: 700,
						fontSize: 32,
						padding: "16px 28px",
						borderRadius: rounded,
						opacity: 0.7 + 0.3 * p,
						transform: `translateY(${(p * -10).toFixed(2)}px)`,
					}}
				>
					{text}
				</div>
			</div>
		);
	},
};
