/**
 * [INPUT]: 依赖 animation、params 与 React 的共享类型定义。
 * [OUTPUT]: 对外提供 World、WorldFrame、ComponentDefinition 等运行时契约。
 * [POS]: runtime 的类型边界；组件 surface、渲染与选择几何依赖同一组不可变描述。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
/**
 * [INPUT]: 依赖 animation、params 与 React 的共享类型定义。
 * [OUTPUT]: 对外提供 World、WorldFrame、ComponentDefinition 等运行时契约。
 * [POS]: runtime 的类型边界；组件 surface、渲染与选择几何依赖同一组不可变描述。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { ElementAnimations } from "@/animation/types";
import type { ParamDefinition, ParamValues } from "@/params";
import type { I18nKey } from "@/i18n";
import type { ComponentType } from "react";
import type { MotionProgram } from "./motion-runtime";
import type { ElementMotion, TextMotionBinding } from "./motion-presets";
import type { BlendMode } from "@/rendering";

/** 世界对象类型：v1 内置类型 + 扩展组件（kind === "component"）。 */
export type WorldObjectKind =
	| "video"
	| "image"
	| "text"
	| "shape"
	| "component";

export interface WorldTransform {
	position: { x: number; y: number; z: number };
	scaleX: number;
	scaleY: number;
	/** 度；编辑器约定（y 向下为正），渲染时翻转为 three 坐标。 */
	rotationZ: number;
}

export interface WorldObject {
	id: string;
	kind: WorldObjectKind;
	name: string;
	/** kind === "component" 时的组件 id。 */
	componentId?: string;
	/** 媒体 assetId（video / image）。 */
	assetId?: string;
	/** 媒体内容 URL（video / image）。 */
	url?: string;
	/** 媒体源固有尺寸（像素），用于 contain-fit。 */
	sourceWidth?: number;
	sourceHeight?: number;
	/** 媒体在源内的入点（秒，video/image 裁剪起点）。 */
	trimStart?: number;
	/** 秒。 */
	startTime: number;
	/** 秒。 */
	duration: number;
	params: ParamValues;
	animations?: ElementAnimations;
	/** 声明式预设动画；在基础参数/关键帧求值后写入渲染目标。 */
	motionProgram?: MotionProgram;
	motion?: ElementMotion;
	textMotion?: TextMotionBinding;
	transform: WorldTransform;
	/** z=0 平面的绘制顺序（轨道序）。 */
	renderOrder: number;
	/** 混合模式（属性面板「混合模式」）；缺省 "normal"（引擎默认合成）。 */
	blendMode?: BlendMode;
	/** 不透明度（属性面板；0..1）。组件材质按 params.opacity 逐帧求值，此为基础值；缺省 1。 */
	opacity?: number;
}

export interface WorldEnvironment {
	/** CSS 颜色。 */
	background: string;
}

export interface World {
	id: string;
	width: number;
	height: number;
	fps: number;
	duration: number;
	environment: WorldEnvironment;
	objects: WorldObject[];
	/** 预览态（编辑器实时画布）：允许组件降低渲染开销以保证交互跟手；导出为 false。 */
	isPreview?: boolean;
}

export interface ResolvedWorldObject {
	object: WorldObject;
	/** 该时刻求值后的参数（含关键帧）。 */
	params: ParamValues;
	localTime: number;
}

export interface WorldFrame {
	time: number;
	objects: ResolvedWorldObject[];
}

/** 确定性动画工具：t（localTime/progress）→ 值，禁止墙钟源（Math.random / Date.now / 墙钟 CSS）。 */
export interface AnimApi {
	/** 数字插值。u ∈ [0,1]；ease: linear|easeOut|easeIn|easeInOut|easeOutCubic。 */
	lerp(a: number, b: number, u: number, opts?: { ease?: string }): number;
	/** 颜色插值（hex → hex）。 */
	lerpColor(c1: string, c2: string, u: number): string;
	/** 关键帧取值：keys 为 [u, value][]，u ∈ [0,1]；区间外保持端点。 */
	seq(keys: Array<[number, number]>, u: number): number;
	/** 周期 0..1。 */
	pulse(u: number, opts?: { speed?: number; phase?: number }): number;
}

/** 组件渲染上下文：由 Runtime 驱动，逐帧注入。 */
export interface ComponentRenderContext {
	world: World;
	object: WorldObject;
	params: ParamValues;
	time: number;
	localTime: number;
	/** localTime / duration ∈ [0,1]。 */
	progress: number;
	/** 确定性动画工具（t → 值）。 */
	anim: AnimApi;
}

/**
 * 组件在自身设计坐标中声明的交互包围盒。
 * 原点是 getBaseSize() 内容区左上角；不含 HTML/React 捕获安全边距。
 */
export interface ContentBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** 组件承载面：html = 字符串模板；react = JSX/DOM 元素树；r3f = R3F 元素树（缺省）。 */
export type ComponentSurface = "html" | "react" | "r3f";

/** 组件定义：可执行、可复用、可传播的 Visual Asset。 */
export interface ComponentDefinition {
	id: string;
	name: string;
	/** 来源：内置组件或项目素材引用；归属不能由组件 ID 命名推断。 */
	origin?: "builtin" | "asset";
	/** 当设置时，渲染端优先用 nameKey 通过 i18n 翻译，name 作为兜底。 */
	nameKey?: I18nKey;
	keywords: string[];
	/** 承载面（AI 作者分级）。缺省 "r3f"（兼容现有内置组件）。 */
	surface?: ComponentSurface;
	/** 组件类别：effect 为全画布 shader 层（不占选择框）；3d / 缺省为普通场景对象。 */
	category?: "effect" | "3d";
	/**
	 * 组件二级分类（组件面板左侧 tab，剪映风格）：
	 * bg = 背景/环境内容（程序化生成的全屏场景层）；scene = 3D 对象；demo = 示例。
	 * 语义边界：effects 调整已有内容（消费场景纹理）；组件提供内容（程序化生成）。
	 * category==="effect" 且设置了 group 的组件归入组件面板对应分组（而非 Effects 面板）。
	 */
	group?: "bg" | "scene" | "demo" | (string & {});
	/** 是否可作为普通元素选择/拖动（显示选择框与变换手柄）。全画布特效默认不可选。 */
	selectable?: boolean;
	/** Timeline 片段识别色（圆点 / 徽标）。 */
	color?: string;
	/** 已验证组件的 HTML-in-Canvas 派生封面，仅供组件素材库展示。 */
	coverUrl?: string;
	/**
	 * HTML/React 内容捕获区在设计尺寸之外预留的每侧安全像素。
	 * 用于 CSS transform、阴影和入/出场动画；未设置时默认 48px。
	 * 编辑器实例参数 `render.capturePadding` 存在时优先于该作者默认值。
	 * 该边距只存在于离屏 raster，最终纹理与选择框仍按真实 alpha 边界收紧。
	 */
	capturePadding?: number;
	inputs: ParamDefinition[];
	render: ComponentType<ComponentRenderContext>;
	/**
	 * 组件的 2D 投影固有尺寸（canvas 像素，未乘 transform 缩放）。
	 * HTML/React 用作离屏内容区的设计尺寸；缺省为 512×512。
	 */
	getBaseSize?: ({
		params,
	}: {
		params: ParamValues;
	}) => { width: number; height: number };
	/**
	 * HTML/React 组件可显式声明稳定的内容、选择和命中边界。
	 * 坐标相对 getBaseSize() 的内容区左上角，不包含 capturePadding。
	 * 纹理截取和画布 transform 也基于它；未声明时才回退到逐像素 alpha 扫描。
	 * 应声明覆盖全部动画阶段的稳定最大 footprint。
	 */
	getContentBounds?: (ctx: ComponentRenderContext) => ContentBounds;
	dispose?: (instance: unknown) => void;
}

export interface ComponentAsset {
	id: string;
	type: "component";
	name: string;
	version: string;
	definitionId: string;
	metadata?: { inputs: ParamDefinition[] };
}
