/**
 * [INPUT]: 依赖内建组件实现、组件注册表与参数定义契约。
 * [OUTPUT]: 对外注册编辑器内建 Video、Image、Text、Shape 等组件。
 * [POS]: runtime/components 的组件总表，文本背景参数归入可折叠 Background 分组。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { componentsRegistry } from "../component-registry";
import type { ComponentDefinition } from "../types";
import { num } from "../utils";
import { EFFECT_COMPONENTS } from "./effects";
import { METALFORGE_COMPONENTS } from "./metalforge";
import { GlowBox } from "./glow-box";
import { htmlBadgeComponent, reactPulseCardComponent } from "./html-examples";
import { gsapRevealCardComponent, gsapOrbitComponent } from "./gsap-examples";
import { ImageObject } from "./image";
import { ShapeObject } from "./shape";
import { SplineScene } from "./spline-scene";
import { TextObject } from "./text";
import { VideoObject } from "./video";

const BUILTIN_COMPONENTS: ComponentDefinition[] = [
	{
		id: "video",
		name: "Video",
		nameKey: "component.name.video",
		keywords: ["video", "视频", "媒体"],
		inputs: [],
		render: VideoObject,
	},
	{
		id: "image",
		name: "Image",
		nameKey: "component.name.image",
		keywords: ["image", "图片", "媒体"],
		inputs: [],
		render: ImageObject,
	},
	{
		id: "text",
		name: "Text",
		nameKey: "component.name.text",
		keywords: ["text", "文本", "标题"],
		inputs: [
			{
				key: "content",
				type: "text",
				default: "Text",
				label: "Text",
				labelKey: "component.param.text",
			},
			{
				key: "fontSize",
				type: "number",
				default: 15,
				min: 1,
				step: 1,
				label: "Font size",
				labelKey: "component.param.fontSize",
			},
			{
				key: "color",
				type: "color",
				default: "#ffffff",
				label: "Color",
				labelKey: "component.param.color",
			},
			{
				key: "fontFamily",
				type: "font",
				default: "Arial",
				label: "Font family",
				labelKey: "component.param.fontFamily",
			},
			{
				key: "fontWeight",
				type: "select",
				default: "normal",
				options: [
					{ value: "normal", label: "Normal", labelKey: "component.option.normal" },
					{ value: "bold", label: "Bold", labelKey: "component.option.bold" },
				],
				label: "Font weight",
				labelKey: "component.param.fontWeight",
			},
			{
				key: "textAlign",
				type: "select",
				default: "center",
				options: [
					{ value: "left", label: "Left", labelKey: "component.option.left" },
					{ value: "center", label: "Center", labelKey: "component.option.center" },
					{ value: "right", label: "Right", labelKey: "component.option.right" },
				],
				label: "Align",
				labelKey: "component.param.align",
			},
			{
				key: "background.enabled",
				type: "boolean",
				default: false,
				label: "Enabled",
				labelKey: "component.param.enabled",
				group: "background",
			},
			{
				key: "background.color",
				type: "color",
				default: "#00000099",
				label: "Color",
				labelKey: "component.param.color",
				group: "background",
			},
			{
				key: "background.cornerRadius",
				type: "number",
				default: 0,
				min: 0,
				step: 1,
				label: "Corner radius",
				labelKey: "component.param.cornerRadius",
				group: "background",
			},
			{
				key: "background.paddingX",
				type: "number",
				default: 0,
				min: 0,
				step: 1,
				label: "Padding X",
				labelKey: "component.param.paddingX",
				group: "background",
			},
			{
				key: "background.paddingY",
				type: "number",
				default: 0,
				min: 0,
				step: 1,
				label: "Padding Y",
				labelKey: "component.param.paddingY",
				group: "background",
			},
		],
		render: TextObject,
	},
	{
		id: "shape",
		name: "Shape",
		group: "scene",
		nameKey: "component.name.shape",
		keywords: ["shape", "图形", "形状"],
		color: "#2dd4bf",
		inputs: [
			{
				key: "shape",
				type: "select",
				default: "box",
				options: [
					{ value: "box", label: "Box", labelKey: "component.option.box" },
					{ value: "sphere", label: "Sphere", labelKey: "component.option.sphere" },
					{ value: "plane", label: "Plane", labelKey: "component.option.plane" },
				],
				label: "Shape",
				labelKey: "component.param.shape",
			},
			{
				key: "color",
				type: "color",
				default: "#4ecdc4",
				label: "Color",
				labelKey: "component.param.color",
			},
			{
				key: "size",
				type: "number",
				default: 200,
				min: 10,
				max: 2000,
				step: 10,
				label: "Size",
				labelKey: "component.param.size",
			},
		],
		getBaseSize: ({ params }) => {
			const size = num(params.size, 200);
			return { width: size, height: size };
		},
		render: ShapeObject,
	},
	{
		id: "glow-box",
		name: "Glow Box",
		group: "scene",
		nameKey: "component.name.glowBox",
		keywords: ["3d", "glow", "发光", "mesh", "光"],
		color: "#22d3ee",
		inputs: [
			{
				key: "size",
				type: "number",
				default: 220,
				min: 10,
				max: 2000,
				step: 10,
				label: "Size",
				labelKey: "component.param.size",
			},
			{
				key: "color",
				type: "color",
				default: "#00d4ff",
				label: "Color",
				labelKey: "component.param.color",
			},
			{
				key: "rotationSpeed",
				type: "number",
				default: 1,
				min: -10,
				max: 10,
				step: 0.1,
				label: "Rotation speed",
				labelKey: "component.param.rotationSpeed",
			},
			{
				key: "intensity",
				type: "number",
				default: 1.4,
				min: 0,
				max: 6,
				step: 0.1,
				label: "Intensity",
				labelKey: "component.param.intensity",
			},
		],
		getBaseSize: ({ params }) => {
			const size = num(params.size, 220);
			return { width: size, height: size };
		},
		render: GlowBox,
	},
	{
		id: "spline-scene",
		name: "Spline Scene",
		group: "scene",
		nameKey: "component.name.splineScene",
		keywords: ["spline", "glass", "玻璃", "3d", "transmission", "环境"],
		color: "#34d399",
		inputs: [
			{
				key: "scale",
				type: "number",
				default: 110,
				min: 20,
				max: 400,
				step: 5,
				label: "Scale",
				labelKey: "component.param.scale",
			},
			{
				key: "speed",
				type: "number",
				default: 1,
				min: 0,
				max: 5,
				step: 0.1,
				label: "Animation speed",
				labelKey: "component.param.animationSpeed",
			},
		],
		getBaseSize: ({ params }) => {
			// 真实几何范围：bands 从 x≈-2.65 到 +2.85、y≈-2.5 到 +2.0（世界单位），
			// 内层 group scale 1.27、CAMERA_ROT 斜投影后再乘 params.scale。
			const scale = num(params.scale, 110);
			return { width: scale * 5.6, height: scale * 4.8 };
		},
		render: SplineScene,
	},
	htmlBadgeComponent,
	reactPulseCardComponent,
	gsapRevealCardComponent,
	gsapOrbitComponent,
];

export function registerBuiltinComponents(): void {
	for (const definition of [...BUILTIN_COMPONENTS, ...EFFECT_COMPONENTS, ...METALFORGE_COMPONENTS]) {
		componentsRegistry.register({ key: definition.id, definition });
	}
}

/** 组件元素是否可作为普通元素选择/拖动（effect 全画布特效不可选）。 */
export function isComponentElementSelectable(element: {
	type: string;
	componentId?: string;
}): boolean {
	if (element.type !== "component" || !element.componentId) {
		return true;
	}
	if (!componentsRegistry.has(element.componentId)) {
		return true;
	}
	return componentsRegistry.get(element.componentId).selectable !== false;
}
