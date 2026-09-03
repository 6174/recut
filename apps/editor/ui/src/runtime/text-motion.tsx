/**
 * [INPUT]: React hooks、FrameTime 下的 MotionProgram context 与 DOM motion adapter。
 * [OUTPUT]: segmentText、useMotionTextSegments；为 HTML-in-Canvas 文本提供稳定 segment refs。
 * [POS]: runtime 的文本动画边界；不负责排版测量或 Canvas 捕获，只拥有 Unicode 分段和目标注册。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useCallback, useMemo, useRef } from "react";
import {
	createDomMotionAdapter,
	MotionTargetRegistry,
	selectMotionProgram,
	type MotionProgram,
} from "./motion-runtime";
import {
	useMotionProgram,
	useMotionProgramContext,
} from "./timeline";
import { segmentText, type TextSegment, type TextSegmentMode } from "./text-segmentation";

export { segmentText } from "./text-segmentation";
export type { TextSegment, TextSegmentMode } from "./text-segmentation";

export interface MotionTextSegment extends TextSegment {
	ref: (node: HTMLElement | null) => void;
}

/**
 * 返回可直接渲染为 span 的稳定目标，并把当前 DOM refs 注册到共享 MotionProgram。
 * `ref` 只更新注册表，不重建 segment；时间变化只由 MotionRuntime.seek 驱动。
 */
export function useMotionTextSegments(
	text: string,
	mode: TextSegmentMode = "grapheme",
): MotionTextSegment[] {
	const segments = useMemo(() => segmentText(text, mode), [mode, text]);
	const targetsRef = useRef(new Map<string, HTMLElement>());
	const callbacksRef = useRef(new Map<string, (node: HTMLElement | null) => void>());
	const getRef = useCallback((id: string) => {
		const existing = callbacksRef.current.get(id);
		if (existing) return existing;
		const callback = (node: HTMLElement | null) => {
			if (node) targetsRef.current.set(id, node);
			else targetsRef.current.delete(id);
		};
		callbacksRef.current.set(id, callback);
		return callback;
	}, []);

	const sourceProgram = useMotionProgramContext();
	const program = useMemo<MotionProgram | undefined>(
		() => selectMotionProgram(sourceProgram, "dom"),
		[sourceProgram],
	);
	const createRegistry = useCallback(() => {
		const registry = new MotionTargetRegistry();
		registry.register(
			createDomMotionAdapter(
				() =>
					Object.fromEntries(
						Array.from(targetsRef.current.entries()).map(([id, node]) => [
							`text:${id}`,
							node,
						]),
					),
				{ allowTypographyLayout: true },
			),
		);
		return registry;
	}, []);
	useMotionProgram(program, createRegistry, [segments]);

	return useMemo(
		() => segments.map((segment) => ({ ...segment, ref: getRef(segment.id) })),
		[getRef, segments],
	);
}
