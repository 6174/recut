import type { ComponentDefinition } from "../../types";
import type { I18nKey } from "@/i18n";
import { num } from "../../utils";
import { ArticleHighlightEffect } from "./article-highlight-effect";
import { AsciifyEffect } from "./asciify-effect";
import { BendEffect } from "./bend-effect";
import { BlazeEffect } from "./blaze-effect";
import { BubbleEffect } from "./bubble-effect";
import { ClothEffect } from "./cloth-effect";
import { CloudsEffect } from "./clouds-effect";
import { CrtEffect } from "./crt-effect";
import { DecryptRevealEffect } from "./decrypt-reveal-effect";
import { DisplacementEffect } from "./displacement-effect";
import { DropletsEffect } from "./droplets-effect";
import { FrostEffect } from "./frost-effect";
import { GlassEffect } from "./glass-effect";
import { GlitchEffect } from "./glitch-effect";
import { GlyphRainEffect } from "./glyph-rain-effect";
import { GridEffect } from "./grid-effect";
import { LaserEffect } from "./laser-effect";
import { LiquidEffect } from "./liquid-effect";
import { MagnifyEffect } from "./magnify-effect";
import { ParticleRevealEffect } from "./particle-reveal-effect";
import { ParticleScrollEffect } from "./particle-scroll-effect";
import { RetroDitherEffect } from "./retro-dither-effect";
import { RippleEffect } from "./ripple-effect";
import { StorePeelEffect } from "./store-peel-effect";
import { TextFocusEffect } from "./text-focus-effect";
import { VhsEffect } from "./vhs-effect";
import { VintageEffect } from "./vintage-effect";

/** 中文输入 label → i18n key。effect 的 name 保持「英文 中文」双语不变。 */
const PARAM_LABEL_KEYS: Record<string, I18nKey> = {
	"中心 X": "component.param.centerX",
	"中心 Y": "component.param.centerY",
	"放大": "component.param.zoom",
	"折射率": "component.param.refraction",
	"折射深度": "component.param.refractionDepth",
	"反射强度": "component.param.reflectivity",
	"玻璃半宽": "component.param.glassWidth",
	"透镜半径": "component.param.lensRadius",
	"HUD": "component.param.hud",
	"色差": "component.param.chromatic",
	"雾气": "component.param.fog",
	"强度": "component.param.intensity",
	"扫描线": "component.param.scanlines",
	"暗角": "component.param.vignette",
	"动态": "component.param.animated",
	"颗粒": "component.param.grain",
	"暖调": "component.param.warmth",
	"褪色": "component.param.fade",
	"进度": "component.param.progress",
	"折射": "component.param.refractionIndex",
	"色散": "component.param.dispersion",
	"虹彩": "component.param.iridescence",
	"幅度": "component.param.amplitude",
	"缩放": "component.param.scale",
	"速度": "component.param.speed",
	"雨滴宽": "component.param.dropWidth",
	"雨滴长": "component.param.dropHeight",
	"网格": "component.param.grid",
	"色阶": "component.param.levels",
	"半径": "component.param.radius",
	"频率": "component.param.frequency",
	"焦点 X": "component.param.focusX",
	"焦点 Y": "component.param.focusY",
	"焦点宽": "component.param.focusWidth",
	"焦点高": "component.param.focusHeight",
	"羽化": "component.param.feather",
	"标记宽": "component.param.markWidth",
	"标记高": "component.param.markHeight",
	"弯曲": "component.param.bend",
	"不透明度": "component.param.opacity",
	"格距": "component.param.cellSize",
	"线宽": "component.param.lineWidth",
	"主格间隔": "component.param.majorEvery",
	"颜色 A": "component.param.colorA",
	"颜色 B": "component.param.colorB",
};

const p = (key: string, label: string, def: number, min = 0, max = 1e6, step = 0.01) =>
	({ key, type: "number" as const, default: def, min, max, step, label, labelKey: PARAM_LABEL_KEYS[label] });

/** 每个特效的 Timeline 识别色（区分不同特效的色点 / 徽标）。 */
const EFFECT_COLORS: Record<string, string> = {
	"effect.glass": "#38bdf8",
	"effect.magnify": "#22d3ee",
	"effect.frost": "#a5b4fc",
	"effect.glitch": "#f472b6",
	"effect.crt": "#34d399",
	"effect.vintage": "#fbbf24",
	"effect.vhs": "#a78bfa",
	"effect.bubble": "#2dd4bf",
	"effect.displacement": "#94a3b8",
	"effect.droplets": "#60a5fa",
	"effect.asciify": "#4ade80",
	"effect.retro-dither": "#c084fc",
	"effect.ripple": "#38bdf8",
	"effect.text-focus": "#f87171",
	"effect.article-highlight": "#fde047",
	"effect.decrypt-reveal": "#34d399",
	"effect.particle-reveal": "#fb7185",
	"effect.bend": "#f59e0b",
	"effect.cloth": "#14b8a6",
	"effect.store-peel": "#e879f9",
	"effect.clouds": "#e2e8f0",
	"effect.grid": "#64748b",
	"effect.liquid": "#818cf8",
	"effect.glyph-rain": "#22c55e",
	"effect.laser": "#ef4444",
	"effect.blaze": "#f97316",
	"effect.particle-scroll": "#d4d4d8",
};

/** 全画布后处理 / 环境特效组件：采样底层场景纹理或程序化生成，叠加光学 / 噪声效果。 */
export const EFFECT_COMPONENTS: ComponentDefinition[] = ([
	{
		id: "effect.glass",
		name: "Glass 玻璃",
		keywords: ["glass", "玻璃", "折射", "refraction", "放大", "特效"],
		category: "effect",
		inputs: [
			p("centerX", "中心 X", 0.5, 0, 1, 0.01),
			p("centerY", "中心 Y", 0.5, 0, 1, 0.01),
			p("zoom", "放大", 1.34, 1, 4, 0.01),
			p("ior", "折射率", 1.5, 1, 2.5, 0.01),
			p("depth", "折射深度", 250, 10, 1000, 5),
			p("reflect", "反射强度", 1, 0, 3, 0.05),
			p("half", "玻璃半宽", 170, 40, 600, 5),
		],
		getBaseSize: ({ params }) => {
			const half = num(params.half, 170);
			return { width: half * 2, height: half * 2 };
		},
		render: GlassEffect,
	},
	{
		id: "effect.magnify",
		name: "Magnify 放大镜",
		keywords: ["magnify", "magnifier", "放大镜", "放大", "zoom", "特效"],
		category: "effect",
		inputs: [
			p("centerX", "中心 X", 0.5, 0, 1, 0.01),
			p("centerY", "中心 Y", 0.5, 0, 1, 0.01),
			p("zoom", "放大", 1.7, 1, 5, 0.01),
			p("radius", "透镜半径", 140, 40, 600, 5),
			p("hud", "HUD", 0.8, 0, 1, 0.01),
			p("aberration", "色差", 0.8, 0, 2, 0.01),
			p("haze", "雾气", 0.2, 0, 1, 0.01),
		],
		getBaseSize: ({ params }) => {
			const radius = num(params.radius, 140);
			return { width: radius * 2, height: radius * 2 };
		},
		render: MagnifyEffect,
	},
	{
		id: "effect.frost",
		name: "Frost 霜玻璃",
		keywords: ["frost", "霜", "玻璃", "模糊", "blur", "冰"],
		category: "effect",
		inputs: [p("intensity", "强度", 1, 0, 3, 0.01)],
		render: FrostEffect,
	},
	{
		id: "effect.glitch",
		name: "Glitch 故障",
		keywords: ["glitch", "故障", "信号", "tearing", "噪点"],
		category: "effect",
		inputs: [p("intensity", "强度", 1.35, 0, 5, 0.01)],
		render: GlitchEffect,
	},
	{
		id: "effect.crt",
		name: "CRT 显像管",
		keywords: ["crt", "显像管", "复古", "scanline", "电视"],
		category: "effect",
		inputs: [
			p("scan", "扫描线", 0.24, 0, 1, 0.01),
			p("vignette", "暗角", 0.68, 0, 1, 0.01),
			p("motion", "动态", 1, 0, 2, 0.01),
		],
		render: CrtEffect,
	},
	{
		id: "effect.vintage",
		name: "Vintage 复古",
		keywords: ["vintage", "复古", "胶片", "grain", "film"],
		category: "effect",
		inputs: [
			p("grain", "颗粒", 0.126, 0, 1, 0.005),
			p("vignette", "暗角", 0.6, 0, 1, 0.01),
			p("warmth", "暖调", 0.28, 0, 1, 0.01),
			p("fade", "褪色", 0.385, 0, 1, 0.01),
		],
		render: VintageEffect,
	},
	{
		id: "effect.vhs",
		name: "VHS 录像带",
		keywords: ["vhs", "录像带", "复古", "磁带", "retro"],
		category: "effect",
		inputs: [
			p("intensity", "强度", 1, 0, 3, 0.01),
		],
		render: VhsEffect,
	},
	{
		id: "effect.bubble",
		name: "Bubble 气泡",
		keywords: ["bubble", "气泡", "折射", "metaball", "水"],
		category: "effect",
		inputs: [
			p("intensity", "强度", 1, 0, 3, 0.01),
			p("refraction", "折射", 80, 0, 300, 1),
			p("dispersion", "色散", 1, 0, 3, 0.01),
			p("iridescence", "虹彩", 1, 0, 3, 0.01),
		],
		render: BubbleEffect,
	},
	{
		id: "effect.displacement",
		name: "Displacement 位移",
		keywords: ["displacement", "位移", "扭曲", "warp"],
		category: "effect",
		inputs: [
			p("amount", "幅度", 0.035, 0, 0.2, 0.001),
			p("scale", "缩放", 2.4, 0.1, 10, 0.1),
		],
		render: DisplacementEffect,
	},
	{
		id: "effect.droplets",
		name: "Droplets 雨滴",
		keywords: ["droplets", "雨滴", "水", "rain", "玻璃"],
		category: "effect",
		inputs: [
			p("speed", "速度", 1, 0, 3, 0.01),
			p("scale", "缩放", 0.4, 0.1, 2, 0.01),
			p("dropWidth", "雨滴宽", 1, 0.2, 3, 0.01),
			p("dropLength", "雨滴长", 1, 0.2, 3, 0.01),
			p("refraction", "折射", 0.2, 0, 1, 0.01),
			p("intensity", "强度", 1, 0, 3, 0.01),
		],
		render: DropletsEffect,
	},
	{
		id: "effect.asciify",
		name: "Asciify 字符化",
		keywords: ["ascii", "字符", "代码", "code", "decode"],
		category: "effect",
		inputs: [p("cell", "网格", 12, 4, 60, 1)],
		render: AsciifyEffect,
	},
	{
		id: "effect.retro-dither",
		name: "Dither 抖动",
		keywords: ["dither", "抖动", "像素", "retro", "复古"],
		category: "effect",
		inputs: [
			p("levels", "色阶", 4, 2, 16, 1),
			p("grid", "网格", 4, 1, 32, 1),
		],
		render: RetroDitherEffect,
	},
	{
		id: "effect.ripple",
		name: "Ripple 涟漪",
		keywords: ["ripple", "涟漪", "水波", "wave", "扭曲"],
		category: "effect",
		inputs: [
			p("centerX", "中心 X", 0.5, 0, 1, 0.01),
			p("centerY", "中心 Y", 0.5, 0, 1, 0.01),
			p("strength", "强度", 0.045, 0, 0.3, 0.001),
			p("radius", "半径", 320, 40, 1200, 5),
			p("frequency", "频率", 2.2, 0.1, 20, 0.1),
		],
		render: RippleEffect,
	},
	{
		id: "effect.text-focus",
		name: "Text Focus 焦点",
		keywords: ["focus", "焦点", "虚化", "blur", "对焦"],
		category: "effect",
		inputs: [
			p("focusX", "焦点 X", 0.28, 0, 1, 0.01),
			p("focusY", "焦点 Y", 0.4, 0, 1, 0.01),
			p("focusWidth", "焦点宽", 0.44, 0.01, 1, 0.01),
			p("focusHeight", "焦点高", 0.16, 0.01, 1, 0.01),
			p("feather", "羽化", 0.035, 0, 0.2, 0.001),
			p("intensity", "强度", 1, 0, 3, 0.01),
			p("progress", "进度", 1, 0, 1, 0.01),
		],
		render: TextFocusEffect,
	},
	{
		id: "effect.article-highlight",
		name: "Highlight 高亮",
		keywords: ["highlight", "高亮", "marker", "重点"],
		category: "effect",
		inputs: [
			p("centerX", "中心 X", 0.5, 0, 1, 0.01),
			p("centerY", "中心 Y", 0.5, 0, 1, 0.01),
			p("intensity", "强度", 1, 0, 3, 0.01),
			p("markerWidth", "标记宽", 0.54, 0.01, 1, 0.01),
			p("markerHeight", "标记高", 0.115, 0.01, 1, 0.01),
			p("progress", "进度", 1, 0, 1, 0.01),
		],
		render: ArticleHighlightEffect,
	},
	{
		id: "effect.decrypt-reveal",
		name: "Decrypt 解密",
		keywords: ["decrypt", "解密", "代码", "reveal", "字符"],
		category: "effect",
		inputs: [p("cell", "网格", 26, 4, 80, 1)],
		render: DecryptRevealEffect,
	},
	{
		id: "effect.particle-reveal",
		name: "Particles 粒子",
		keywords: ["particle", "粒子", "reveal", "显现", "消散"],
		category: "effect",
		inputs: [
			p("cell", "网格", 22, 4, 80, 1),
			p("intensity", "强度", 1, 0, 3, 0.01),
		],
		render: ParticleRevealEffect,
	},
	{
		id: "effect.bend",
		name: "Bend 卷曲",
		keywords: ["bend", "卷曲", "折页", "fold", "翻页"],
		category: "effect",
		inputs: [p("bend", "弯曲", 1.0, 0, 2, 0.01)],
		render: BendEffect,
	},
	{
		id: "effect.cloth",
		name: "Cloth 布料",
		keywords: ["cloth", "布料", "飘动", "wave", "风"],
		category: "effect",
		inputs: [
			p("amplitude", "振幅", 0.18, 0, 1, 0.01),
			p("scale", "缩放", 1.2, 0.1, 5, 0.1),
			p("speed", "速度", 1.4, 0, 5, 0.01),
		],
		render: ClothEffect,
	},
	{
		id: "effect.store-peel",
		name: "Peel 撕页",
		keywords: ["peel", "撕页", "store", "reveal", "卷起"],
		category: "effect",
		inputs: [],
		render: StorePeelEffect,
	},
	{
		id: "effect.clouds",
		name: "Clouds 云雾",
		keywords: ["clouds", "云", "雾", "fbm", "环境"],
		category: "effect",
		group: "bg",
		inputs: [p("opacity", "不透明度", 0.74, 0, 1, 0.01)],
		render: CloudsEffect,
	},
	{
		id: "effect.grid",
		name: "Grid 网格",
		keywords: ["grid", "网格", "蓝图", "blueprint", "环境"],
		category: "effect",
		group: "bg",
		inputs: [
			p("opacity", "不透明度", 0.5, 0, 1, 0.01),
			p("cell", "格距", 96, 10, 400, 5),
			p("line", "线宽", 1.2, 0.2, 8, 0.1),
			p("majorEvery", "主格间隔", 5, 1, 20, 1),
			p("speed", "速度", 0.75, 0, 5, 0.01),
			{ key: "color", type: "color", default: "#334155", label: "Color", labelKey: "component.param.color" },
		],
		render: GridEffect,
	},
	{
		id: "effect.liquid",
		name: "Liquid 液态",
		keywords: ["liquid", "液态", "流动", "marble", "环境"],
		category: "effect",
		group: "bg",
		inputs: [
			p("opacity", "不透明度", 0.8, 0, 1, 0.01),
			{ key: "colorA", type: "color", default: "#0ea5e9", label: "Color A", labelKey: "component.param.colorA" },
			{ key: "colorB", type: "color", default: "#7c3aed", label: "Color B", labelKey: "component.param.colorB" },
		],
		render: LiquidEffect,
	},
	{
		id: "effect.glyph-rain",
		name: "Glyph Rain 字符雨",
		keywords: ["glyph", "字符", "雨", "rain", "代码", "matrix"],
		category: "effect",
		group: "bg",
		inputs: [
			p("intensity", "强度", 1, 0, 3, 0.01),
			p("opacity", "不透明度", 0.8, 0, 1, 0.01),
		],
		render: GlyphRainEffect,
	},
	{
		id: "effect.laser",
		name: "Laser 激光",
		keywords: ["laser", "激光", "光束", "beam", "环境"],
		category: "effect",
		group: "bg",
		inputs: [
			p("intensity", "强度", 1, 0, 3, 0.01),
			p("opacity", "不透明度", 0.85, 0, 1, 0.01),
		],
		render: LaserEffect,
	},
	{
		id: "effect.blaze",
		name: "Blaze 烈焰",
		keywords: ["blaze", "烈焰", "火焰", "fire", "环境"],
		category: "effect",
		group: "bg",
		inputs: [p("opacity", "不透明度", 0.85, 0, 1, 0.01)],
		render: BlazeEffect,
	},
	{
		id: "effect.particle-scroll",
		name: "Particles 漂浮",
		keywords: ["particle", "粒子", "漂浮", "scroll", "尘埃"],
		category: "effect",
		group: "bg",
		inputs: [p("opacity", "不透明度", 0.8, 0, 1, 0.01)],
		render: ParticleScrollEffect,
	},
] as ComponentDefinition[]).map((definition) => ({
	...definition,
	selectable: false,
	color: EFFECT_COLORS[definition.id] ?? "#64748b",
}));

export { GlassEffect } from "./glass-effect";
export { MagnifyEffect } from "./magnify-effect";
