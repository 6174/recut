/**
 * [INPUT]: AI 组件源码的 TypeScript 类型检查。
 * [OUTPUT]: @recut/runtime 的受控 import 与组件作者类型。
 * [POS]: SDK 的构建期契约；运行时由宿主 prelude 解析到同一 React/R3F/three 实例。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

declare module "@recut/runtime/jsx-runtime" {
	export const jsx: any;
	export const jsxs: any;
	export const Fragment: any;
}

declare module "@recut/runtime" {
	export type ComponentSurface = "html" | "react" | "r3f";

	/** 相对 getBaseSize() 内容区左上角的选择/命中边界，不包含 capturePadding。 */
	export interface ContentBounds {
		x: number;
		y: number;
		width: number;
		height: number;
	}

	export interface AnimApi {
		lerp(a: number, b: number, u: number, opts?: { ease?: string }): number;
		lerpColor(c1: string, c2: string, u: number): string;
		seq(keys: Array<[number, number]>, u: number): number;
		pulse(u: number, opts?: { speed?: number; phase?: number }): number;
	}

	export type ParamValue = number | string | boolean;
	export type ParamValues = Record<string, ParamValue>;

	export interface ParamDefinition {
		key: string;
		label?: string;
		type: string;
		default: ParamValue;
		min?: number;
		max?: number;
		step?: number;
		group?: string;
		options?: Array<{ value: string; label: string }>;
	}

	export interface ComponentRenderContext {
		world: unknown;
		object: unknown;
		params: ParamValues;
		/** 全局时间（秒）。 */
		time: number;
		/** 相对片段的本地时间（秒）。 */
		localTime: number;
		/** localTime / duration ∈ [0,1]。 */
		progress: number;
		/** 确定性动画工具（t → 值，禁墙钟源）。 */
		anim: AnimApi;
	}

	export const jsx: any;
	export const jsxs: any;
	export const Fragment: any;

	export function useState<S>(initial: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void];
	export function useMemo<T>(factory: () => T, deps?: ReadonlyArray<unknown>): T;
	export function useRef<T>(initial: T | null): { current: T | null };
	export function useCallback<T extends (...args: never[]) => unknown>(
		fn: T,
		deps?: ReadonlyArray<unknown>,
	): T;
	export function useEffect(effect: () => void | (() => void), deps?: ReadonlyArray<unknown>): void;
	export function useThree(): any;

	export * as THREE from "three";
	export function useCanvasTexture(
		draw: (ctx: any, width: number, height: number) => void,
		width: number,
		height: number,
	): any;

	export const anim: AnimApi;
	export function num(value: unknown, fallback: number): number;
	export function str(value: unknown, fallback: string): string;
	export function bool(value: unknown, fallback: boolean): boolean;

	// —— GSAP（react/r3f 动画首选；确定性 = 构造确定性 + 驱动靠 seek）——
	export interface FrameTime {
		/** 全局时间（秒）。 */
		time: number;
		/** 片段内本地时间（秒）——GSAP seek 默认基。 */
		localTime: number;
		/** localTime / duration ∈ [0,1]。 */
		progress: number;
	}

	/** tween vars：duration/ease/delay/stagger/repeat 等 + 任意可动画属性。 */
	export interface TimelineVars {
		duration?: number;
		ease?: string | ((k: number) => number);
		delay?: number;
		stagger?: number | Record<string, unknown>;
		repeat?: number;
		repeatDelay?: number;
		yoyo?: boolean;
		[key: string]: unknown;
	}

	/**
	 * Timeline 的确定性子集：只暴露 seek/progress 等纯驱动方法；
	 * 自动播放（.play/.restart/.resume）不在类型面上，构建期静态扫描也会拒绝。
	 */
	export interface GsapTimeline {
		to(target: unknown, vars: TimelineVars, position?: unknown): GsapTimeline;
		from(target: unknown, vars: TimelineVars, position?: unknown): GsapTimeline;
		fromTo(
			target: unknown,
			fromVars: TimelineVars,
			toVars: TimelineVars,
			position?: unknown,
		): GsapTimeline;
		set(target: unknown, vars: TimelineVars): GsapTimeline;
		add(tween: unknown, position?: unknown): GsapTimeline;
		addLabel(label: string, position: unknown): GsapTimeline;
		labelToTime(label: string): number;
		progress(value: number): GsapTimeline;
		seek(time: number, suppressEvents?: boolean): GsapTimeline;
		duration(): number;
		totalDuration(): number;
		kill(): void;
		paused(value?: boolean): boolean;
	}

	export interface GsapTween {
		progress(value: number): GsapTween;
		seek(time: number): GsapTween;
		duration(): number;
		kill(): void;
	}

	/** 确定性 utils 子集（不含 random；随机一律禁止）。 */
	export interface GsapUtils {
		clamp(min: number, max: number): (value: number) => number;
		clamp(min: number, max: number, value: number): number;
		mapRange(
			inMin: number,
			inMax: number,
			outMin: number,
			outMax: number,
			value?: number,
		): number | ((value: number) => number);
		normalize(min: number, max: number, value?: number): number | ((value: number) => number);
		interpolate(...args: unknown[]): unknown;
		snap(...args: unknown[]): ((value: number) => number) | number;
		toArray(value: unknown, scope?: unknown): unknown[];
		wrap(min: number, max: number, value?: number): number | ((value: number) => number);
		wrapYoyo(min: number, max: number, value?: number): number | ((value: number) => number);
		pipe(...functions: Array<(v: unknown) => unknown>): (value: unknown) => unknown;
		selector(scope: unknown): (selector: string) => unknown[];
		distribute(config: Record<string, unknown>): (index: number, target: unknown, targets: unknown[]) => number;
		splitColor(color: string, returnHSL?: boolean): number[];
		getUnit(value: string | number): string;
		unitize(value: string | number, unit: string): string;
	}

	/** gsap 的确定性子集（auto-play / 禁插件 / random 不在面内）。 */
	export interface GsapApi {
		to(target: unknown, vars: TimelineVars): GsapTween;
		from(target: unknown, vars: TimelineVars): GsapTween;
		fromTo(
			target: unknown,
			fromVars: TimelineVars,
			toVars: TimelineVars,
		): GsapTween;
		set(target: unknown, vars: TimelineVars): GsapTween;
		timeline(vars?: { paused?: boolean; defaults?: TimelineVars }): GsapTimeline;
		registerPlugin(...plugins: unknown[]): void;
		utils: GsapUtils;
	}

	export const gsap: GsapApi;

	export interface UseGSAPConfig {
		dependencies?: ReadonlyArray<unknown>;
		scope?: unknown;
		revertOnUpdate?: boolean;
	}

	/**
	 * @gsap/react 官方 hook（已注册）。Timeline 必须 paused 并只经 seek/progress 驱动；
	 * 首选 useTimeline（自动处理每帧 seek）。
	 */
	export function useGSAP(
		callback: (
			context: unknown,
			contextSafe: (fn: () => void) => () => void,
		) => void | (() => void),
		config?: UseGSAPConfig | ReadonlyArray<unknown>,
	): { contextSafe: (fn: () => void) => () => void; revert: () => void };

	export type TimelineSeekMode = "time" | "progress" | "loop";
	export interface UseTimelineOptions {
		/**
		 * 时间基（默认 "time"）：time=seek(localTime)；progress=整体压缩到 0..1；loop=循环。
		 */
		mode?: TimelineSeekMode;
	}

	/**
	 * 首选动画 hook：构造 paused Timeline 一次，运行时把当前帧 t 逐帧 seek 进去。
	 * 仅 react/r3f 承载面的函数组件形态可用（export default function 或内部组件）。
	 */
	export function useTimeline(
		factory: (tl: GsapTimeline) => void,
		deps?: ReadonlyArray<unknown>,
		options?: UseTimelineOptions,
	): GsapTimeline;

	/** 组件内读取当前帧时间（shader uniform / 数字滚动 / 手动 seek）。 */
	export function useFrameContext(): FrameTime;

	export interface MotionProgram {
		schemaVersion: 1;
		durationSec: number;
		mode: "once" | "loop";
		tracks: Array<{
			target: { kind: "dom" | "three" | "shader"; ref: string };
			path: string;
			blend: "replace" | "add" | "multiply";
			keys: Array<{ at: number; value: number | string | boolean | number[]; ease?: string }>;
		}>;
	}
	export class MotionTargetRegistry {
		register(adapter: unknown): void;
		clear(): void;
	}
	export function createShaderUniformAdapter(targets: Record<string, unknown>): unknown;
	export function selectMotionProgram(program: MotionProgram | undefined, kind: "dom" | "three" | "shader"): MotionProgram | undefined;
	export function useMotionProgram(program: MotionProgram | undefined, createRegistry: () => MotionTargetRegistry, deps?: ReadonlyArray<unknown>): void;
	export function useMotionProgramContext(): MotionProgram | undefined;

	export type TextSegmentMode = "whole" | "line" | "word" | "grapheme";
	export interface TextSegment {
		id: string;
		text: string;
		index: number;
	}
	export interface MotionTextSegment extends TextSegment {
		ref: (node: HTMLElement | null) => void;
	}
	export function segmentText(text: string, mode: TextSegmentMode): TextSegment[];
	export function useMotionTextSegments(
		text: string,
		mode?: TextSegmentMode,
	): MotionTextSegment[];

	export type MotionSlot = "enter" | "exit" | "loop";
	export interface MotionBinding {
		presetId: string;
		presetVersion: string;
		params?: Record<string, string | number | boolean>;
		enabled?: boolean;
		durationSec?: number;
	}
	export interface TextMotionBinding extends MotionBinding {
		segment: { mode: TextSegmentMode; order?: "forward" | "reverse"; staggerSec?: number; maxSegments?: number };
		layout?: "preserve" | "reflow";
	}

	/** 确定性插件白名单（宿主已注册；ScrollTrigger/Draggable/Inertia/Observer 不可用）。 */
	export interface GsapPlugins {
		CustomEase: unknown;
		SplitText: unknown;
		MorphSVGPlugin: unknown;
		MotionPathPlugin: unknown;
		ScrambleTextPlugin: unknown;
		Flip: unknown;
		DrawSVGPlugin: unknown;
	}
	export const plugins: GsapPlugins;
}

// 全局 JSX 内置元素统一放宽（r3f 与 DOM；组件内容由运行时校验）
declare namespace JSX {
	interface IntrinsicElements {
		[elem: string]: any;
	}
}
