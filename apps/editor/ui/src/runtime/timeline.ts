/**
 * [INPUT]: 依赖 @gsap/react 的 useGSAP、gsap 本体与 React context。
 * [OUTPUT]: FrameTimeContext / MotionProgramContext / useFrameContext / useTimeline / useMotionProgram、活跃 runtime 注册表与插件白名单。
 * [POS]: runtime 的动画执行面；react/r3f 组件用 useTimeline 声明 GSAP Timeline，
 *        运行时把当前帧的 t（localTime/progress）逐帧 seek 进去——确定性 = 构造确定性 + 驱动靠 seek。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { createContext, useContext, useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import CustomEase from "gsap/CustomEase";
import SplitText from "gsap/SplitText";
import MorphSVGPlugin from "gsap/MorphSVGPlugin";
import MotionPathPlugin from "gsap/MotionPathPlugin";
import ScrambleTextPlugin from "gsap/ScrambleTextPlugin";
import Flip from "gsap/Flip";
import DrawSVGPlugin from "gsap/DrawSVGPlugin";
import {
	MotionRuntime,
	type MotionProgram,
	type MotionTargetRegistry,
} from "./motion-runtime";

// 插件注册只做一次：任何 import 本模块的路径（runtime-host / 内置组件 / 消费方）都保证已注册。
// 白名单 = 纯确定性视觉插件；交互/滚动/随机类（ScrollTrigger/Draggable/Inertia/Observer）不导出。
gsap.registerPlugin(
	useGSAP,
	CustomEase,
	SplitText,
	MorphSVGPlugin,
	MotionPathPlugin,
	ScrambleTextPlugin,
	Flip,
	DrawSVGPlugin,
);

/** 确定性插件白名单（组件可从 @recut/runtime 取用，宿主已注册）。 */
export const plugins = {
	CustomEase,
	SplitText,
	MorphSVGPlugin,
	MotionPathPlugin,
	ScrambleTextPlugin,
	Flip,
	DrawSVGPlugin,
};

/** 运行时逐帧注入的时间基（与 ComponentRenderContext.time/localTime/progress 同源）。 */
export interface FrameTime {
	/** 全局时间（秒）。 */
	time: number;
	/** 片段内本地时间（秒）——GSAP seek 默认基。 */
	localTime: number;
	/** localTime / duration ∈ [0,1]。 */
	progress: number;
}

export const FrameTimeContext = createContext<FrameTime>({
	time: 0,
	localTime: 0,
	progress: 0,
});

/** 当前渲染对象绑定的共享 Motion Program；各承载面按 adapter 选择自己的 tracks。 */
export const MotionProgramContext = createContext<MotionProgram | undefined>(undefined);

export function useMotionProgramContext(): MotionProgram | undefined {
	return useContext(MotionProgramContext);
}

/** 组件内读取当前帧时间（shader uniform / 数字滚动 / 手动 seek 等）。 */
export function useFrameContext(): FrameTime {
	return useContext(FrameTimeContext);
}

export type TimelineSeekMode = "time" | "progress" | "loop";

export interface UseTimelineOptions {
	/**
	 * 时间基（默认 "time"）：
	 * - "time"（默认）：tl.seek(clamp(localTime, 0, duration))——时间轴秒数即片段时间，短于片段则末端 hold；
	 * - "progress"：tl.progress(progress)——动画整体被 clip 时长压缩/拉伸；
	 * - "loop"：tl.seek(localTime % duration)——循环动效。
	 */
	mode?: TimelineSeekMode;
}

/** 活跃 GSAP Timeline 注册表：供诊断与后续“时间变化不重渲树”优化探测（rfc/2026-08-20 §6 Phase 2）。 */
export const activeTimelines = new Set<gsap.core.Timeline>();

/** 数据驱动预设的活跃运行时集合；用于诊断其生命周期与后续统一失效。 */
export const activeMotionRuntimes = new Set<MotionRuntime>();

/**
 * 首选动画 hook：构造 paused Timeline 一次，随后把当前帧 t 逐帧 seek 进去。
 * - 结构（DOM/R3F 树）不随帧重排；被动画的属性经 ref 由 GSAP 命令式持有，绝不写进 JSX（rfc/2026-08-20 §4.1 I2）。
 * - deps 变化时 kill 旧 Timeline 并重建（参数/输入变化 → 动画跟随）。
 * - 只能用于 react/r3f 承载面的函数组件形态（export default function）或内部组件；html 承载面无 ref，禁 GSAP。
 */
export function useTimeline(
	factory: (tl: gsap.core.Timeline) => void,
	deps: ReadonlyArray<unknown> = [],
	options: UseTimelineOptions = {},
): gsap.core.Timeline {
	const { time, localTime, progress } = useFrameContext();
	const tlRef = useRef<gsap.core.Timeline | null>(null);
	const factoryRef = useRef(factory);
	factoryRef.current = factory;
	const mode = options.mode ?? "time";

	useGSAP(
		() => {
			const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.out" } });
			factoryRef.current(tl);
			tlRef.current = tl;
			activeTimelines.add(tl);
			return () => {
				activeTimelines.delete(tl);
				tl.kill();
				tlRef.current = null;
			};
		},
		{ dependencies: deps as unknown[], revertOnUpdate: true },
	);

	useLayoutEffect(() => {
		const tl = tlRef.current;
		if (!tl) return;
		const duration = tl.duration();
		if (mode === "progress") {
			tl.progress(Math.min(1, Math.max(0, progress)));
		} else if (mode === "loop") {
			tl.seek(duration > 0 ? localTime % duration : 0);
		} else {
			tl.seek(duration > 0 ? Math.min(localTime, duration) : 0);
		}
	}, [time, localTime, progress, mode]);

	return tlRef.current as gsap.core.Timeline;
}

/**
 * Motion Program 的 React 生命周期桥：实例只在 program/渲染目标变更时重建，
 * 每帧只执行 seek(localTime)。目标注册表属于组件实例，绝不跨预览/快照共享。
 */
export function useMotionProgram(
	program: MotionProgram | undefined,
	createRegistry: () => MotionTargetRegistry,
	deps: ReadonlyArray<unknown> = [],
): void {
	const { localTime } = useFrameContext();
	const runtimeRef = useRef<MotionRuntime | null>(null);
	const createRegistryRef = useRef(createRegistry);
	createRegistryRef.current = createRegistry;

	useLayoutEffect(() => {
		if (!program) return;
		const registry = createRegistryRef.current();
		const runtime = new MotionRuntime(program, registry);
		runtimeRef.current = runtime;
		activeMotionRuntimes.add(runtime);
		return () => {
			activeMotionRuntimes.delete(runtime);
			runtime.dispose();
			registry.clear();
			if (runtimeRef.current === runtime) runtimeRef.current = null;
		};
	}, [program, ...deps]);

	useLayoutEffect(() => {
		runtimeRef.current?.seek({ localTime });
	}, [localTime]);
}
