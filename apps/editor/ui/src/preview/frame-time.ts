import { create } from "zustand";

/**
 * 预览渲染性能观测（只读指标，不入持久化存储）。
 * 渲染循环每帧上报相邻两次 tick 的间隔（帧预算），这里做 EMA 平滑并换算为 FPS，
 * 供预览视口右上角的 fps 徽标展示，也可与导出帧耗时对比。
 */
interface PreviewFrameTimeState {
	/** EMA 平滑后的帧间隔（毫秒）。 */
	frameTimeMs: number;
	/** 由帧间隔换算的 FPS（1000 / frameTimeMs）。 */
	fps: number;
	setFrameTimeMs: (frameTimeMs: number) => void;
}

const EMA_ALPHA = 0.12;

export const usePreviewFrameTime = create<PreviewFrameTimeState>((set, get) => ({
	frameTimeMs: 0,
	fps: 0,
	setFrameTimeMs: (dt) => {
		const prev = get().frameTimeMs;
		const smoothed = prev === 0 ? dt : prev + (dt - prev) * EMA_ALPHA;
		const fps = smoothed > 0 ? 1000 / smoothed : 0;
		set({ frameTimeMs: smoothed, fps });
	},
}));
