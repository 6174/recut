import { useCallback, useEffect, useRef, useState } from "react";
import { useResizeObserver } from "./use-resize-observer";

/**
 * 返回容器实时宽高。ResizeObserver 在拖动/缩放时每帧可能回调多次，
 * 这里合并到一帧一次、并且只在「整像素尺寸变化」时才更新 state，
 * 避免亚像素抖动引发整棵子树每帧重渲染。
 */
export function useContainerSize({
	containerRef,
}: {
	containerRef: React.RefObject<HTMLElement | null>;
}) {
	const [size, setSize] = useState({ width: 0, height: 0 });
	const pendingRef = useRef<{ width: number; height: number } | null>(null);
	const lastRef = useRef({ width: -1, height: -1 });
	const rafRef = useRef(0);

	const onResize = useCallback((entry: ResizeObserverEntry) => {
		pendingRef.current = {
			width: Math.round(entry.contentRect.width),
			height: Math.round(entry.contentRect.height),
		};
		if (rafRef.current) return;
		rafRef.current = requestAnimationFrame(() => {
			rafRef.current = 0;
			const next = pendingRef.current;
			pendingRef.current = null;
			if (!next) return;
			if (
				next.width === lastRef.current.width &&
				next.height === lastRef.current.height
			) {
				return;
			}
			lastRef.current = next;
			setSize(next);
		});
	}, []);

	useEffect(
		() => () => {
			if (rafRef.current) cancelAnimationFrame(rafRef.current);
		},
		[],
	);

	useResizeObserver({ ref: containerRef, onResize });

	return size;
}
