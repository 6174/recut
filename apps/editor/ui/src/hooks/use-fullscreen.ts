/**
 * [INPUT]: 依赖 React 状态与浏览器 Fullscreen API，以及预览容器 ref
 * [OUTPUT]: 对外提供 useFullscreen，返回当前全屏状态与安全的切换操作
 * [POS]: hooks 的浏览器能力适配器；由 PreviewPanel 使用，兼容 iframe 权限或浏览器策略拒绝
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useCallback, useEffect, useState } from "react";

export function useFullscreen({
	containerRef,
}: {
	containerRef: React.RefObject<HTMLElement | null>;
}) {
	const [isFullscreen, setIsFullscreen] = useState(false);

	useEffect(() => {
		const handleChange = () => {
			setIsFullscreen(document.fullscreenElement !== null);
		};
		document.addEventListener("fullscreenchange", handleChange);
		return () => {
			document.removeEventListener("fullscreenchange", handleChange);
		};
	}, []);

	const toggleFullscreen = useCallback(async () => {
		if (!containerRef.current) return;

		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
				return;
			}

			await containerRef.current.requestFullscreen();
		} catch {
			// 浏览器策略或宿主 iframe 未授权时静默保持当前界面。
		}
	}, [containerRef]);

	return { isFullscreen, toggleFullscreen };
}
