"use client";

import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useEditor } from "@/editor/use-editor";
import { useRafLoop } from "@/hooks/use-raf-loop";
import { useContainerSize } from "@/hooks/use-container-size";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { WorldRenderer } from "@/runtime";
import { buildWorld } from "@/runtime/build-world";
import { prewarmWorldMedia } from "@/runtime/texture";
import { mediaTimeToSeconds, TICKS_PER_SECOND } from "@/wasm";
import { PreviewOverlayLayer } from "./overlay-layer";
import { PreviewInteractionOverlay } from "./preview-interaction-overlay";
import { usePreviewFrameTime } from "@/preview/frame-time";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import type {
	PreviewOverlayControl,
	PreviewOverlayInstance,
} from "@/preview/overlays";
import { PreviewContextMenu } from "./context-menu";
import { PreviewToolbar } from "./toolbar";
import {
	PreviewViewportProvider,
	usePreviewViewportState,
} from "./preview-viewport";

/**
 * [INPUT]: 编辑器时间线、WorldRenderer、预览尺寸和用户交互状态
 * [OUTPUT]: 常驻预览画布、工具栏、叠加层与视口控制
 * [POS]: preview/components 的画布宿主；一个项目只持有一个受控 WebGL renderer
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

function usePreviewSize() {
	const canvasSize = useEditor(
		(e) => e.project.getActive()?.settings.canvasSize,
	);

	return {
		width: canvasSize?.width,
		height: canvasSize?.height,
	};
}

function normalizeWheelDelta({
	delta,
	deltaMode,
	pageSize,
}: {
	delta: number;
	deltaMode: number;
	pageSize: number;
}): number {
	if (deltaMode === WheelEvent.DOM_DELTA_LINE) {
		return delta * 16;
	}

	if (deltaMode === WheelEvent.DOM_DELTA_PAGE) {
		return delta * pageSize;
	}

	return delta;
}

export function PreviewPanel({
	overlayControls,
	overlayInstances,
	onOverlayVisibilityChange,
}: {
	overlayControls: PreviewOverlayControl[];
	overlayInstances: PreviewOverlayInstance[];
	onOverlayVisibilityChange: (params: {
		overlayId: string;
		isVisible: boolean;
	}) => void;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	const { toggleFullscreen } = useFullscreen({ containerRef });
	const handleContainerRef = useCallback((node: HTMLDivElement | null) => {
		containerRef.current = node;
		setContainer(node);
	}, []);

	return (
		<div
			ref={handleContainerRef}
			className="panel bg-background relative flex size-full min-h-0 min-w-0 flex-col rounded-sm border"
		>
			<PreviewCanvas
				container={container}
				onToggleFullscreen={toggleFullscreen}
				overlayControls={overlayControls}
				overlayInstances={overlayInstances}
				onOverlayVisibilityChange={onOverlayVisibilityChange}
			/>
		</div>
	);
}

function PreviewCanvas({
	container,
	onToggleFullscreen,
	overlayControls,
	overlayInstances,
	onOverlayVisibilityChange,
}: {
	container: HTMLElement | null;
	onToggleFullscreen: () => void;
	overlayControls: PreviewOverlayControl[];
	overlayInstances: PreviewOverlayInstance[];
	onOverlayVisibilityChange: (params: {
		overlayId: string;
		isVisible: boolean;
	}) => void;
}) {
	const canvasMountRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const lastFrameRef = useRef(-1);
	const lastSceneRef = useRef<import("@/runtime/types").World | null>(null);
	const lastLoopAtRef = useRef(0);
	const worldRef = useRef<import("@/runtime/types").World | null>(null);
	const rendererOwnerRef = useRef<WorldRenderer | null>(null);
	const rendererLeaseRef = useRef(0);
	const { width: nativeWidth, height: nativeHeight } = usePreviewSize();
	const viewportSize = useContainerSize({ containerRef: viewportRef });
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActive());
	const activeFps = activeProject.settings.fps;
	const tracks = useEditor((e) => e.timeline.getPreviewTracks());
	const mediaAssets = useEditor((e) => e.media.getAssets());
	const viewport = usePreviewViewportState({
		canvasHeight: nativeHeight,
		canvasWidth: nativeWidth,
		viewportHeight: viewportSize.height,
		viewportRef,
		viewportWidth: viewportSize.width,
	});
	const { canPan, panByScreenDelta, scaleZoom } = viewport;

	const renderer = useMemo(() => {
		return new WorldRenderer({
			width: nativeWidth,
			height: nativeHeight,
			fps: activeFps,
		});
	}, [nativeWidth, nativeHeight, activeFps.numerator, activeFps.denominator]);

	useEffect(() => {
		const lease = rendererLeaseRef.current + 1;
		rendererLeaseRef.current = lease;
		const previousRenderer = rendererOwnerRef.current;
		rendererOwnerRef.current = renderer;
		// ProjectManager 只依赖这个显式 renderer 能力，不再从 DOM 查询 canvas。
		// 封面快照因此复用同一 WebGL context，且不会碰预览的 scene/frame。
		editor.project.setPreviewRenderer(renderer);
		if (previousRenderer && previousRenderer !== renderer) {
			previousRenderer.dispose();
		}

		return () => {
			// React Strict Mode 会在开发期立即 setup→cleanup→setup；微任务后确认
			// 没有新的 lease 才释放，避免把仍在使用的常驻预览 context 销毁。
			queueMicrotask(() => {
				if (
					rendererLeaseRef.current === lease &&
					rendererOwnerRef.current === renderer
				) {
					editor.project.setPreviewRenderer(null);
					renderer.dispose();
					rendererOwnerRef.current = null;
				}
			});
		};
	}, [editor.project, renderer]);

	// 同步重建世界：与选择框/命中测试在同一 React commit（都由同一 notify 触发）完成。
	// 不再走 RenderTreeController → setWorld → 再订阅 → rAF 的中间 hop。
	useLayoutEffect(() => {
		if (!activeProject || !tracks) return;
		const duration = editor.timeline.getTotalDuration();
		const world = buildWorld({
			scene: { id: "preview", tracks },
		mediaAssets,
		canvasSize: { width: nativeWidth, height: nativeHeight },
			fps: activeFps.numerator / activeFps.denominator,
			duration: mediaTimeToSeconds({ time: duration }),
			background: activeProject.settings.background,
		});
		world.isPreview = true;
		worldRef.current = world;
	}, [
		tracks,
		mediaAssets,
		activeProject?.settings.background,
		activeFps.numerator,
		activeFps.denominator,
		nativeWidth,
		nativeHeight,
		editor,
	]);

	// Mount the compositor's output canvas directly into the preview. wgpu
	// renders straight into this element, so there is no intermediate copy —
	// the container div owns positioning/styling, the canvas itself fills it.
	useEffect(() => {
		const mount = canvasMountRef.current;
		if (!mount) return;
		const outputCanvas = renderer.getOutputCanvas();
		outputCanvas.style.display = "block";
		outputCanvas.style.width = "100%";
		outputCanvas.style.height = "100%";
		outputCanvas.setAttribute("data-recut-canvas", "");
		mount.appendChild(outputCanvas);
		return () => {
			if (outputCanvas.parentElement === mount) {
				mount.removeChild(outputCanvas);
			}
		};
	}, [renderer]);

	const render = useCallback(() => {
		const world = worldRef.current;
		if (!world) return;

		// 预览单帧耗时 = 渲染循环两次 tick 的间隔（帧预算）。> 目标帧预算说明预览掉帧。
		const now = performance.now();
		if (lastLoopAtRef.current > 0) {
			usePreviewFrameTime
				.getState()
				.setFrameTimeMs(now - lastLoopAtRef.current);
		}
		lastLoopAtRef.current = now;

		const renderTime = Math.min(
			editor.playback.getCurrentTime(),
			editor.timeline.getLastFrameTime(),
		);
		const ticksPerFrame = Math.round(
			(TICKS_PER_SECOND * renderer.fps.denominator) / renderer.fps.numerator,
		);
		const frame = Math.floor(renderTime / ticksPerFrame);

		if (frame === lastFrameRef.current && world === lastSceneRef.current) {
			return;
		}

		lastSceneRef.current = world;
		lastFrameRef.current = frame;
		// 即将上场的媒体提前解码：否则 B 挂载时解码器是冷的，首帧闪背景。
		prewarmWorldMedia(
			world,
			mediaTimeToSeconds({
				time: renderTime as import("@/wasm").MediaTime,
			}),
		);
		renderer
			.render({
				world,
				time: mediaTimeToSeconds({
					time: renderTime as import("@/wasm").MediaTime,
				}),
				// 预览不等待出图：WorldScene frameloop="demand"，React 提交后 invalidate
				// 下一帧即绘制（与纹理捕获合并失效），避免 2 帧等待 + 渲染中跳过导致的元素/选择框脱节。
				waitForDraw: false,
			})
			.catch((error) => {
				lastFrameRef.current = -1;
				console.error("Preview render failed:", error);
			});
	}, [renderer, editor.playback, editor.timeline]);

	useRafLoop(render);

	useEffect(() => {
		const container = viewportRef.current;
		if (!container) return;

		let pendingZoomDelta = 0;
		let pendingPanDeltaX = 0;
		let pendingPanDeltaY = 0;
		let zoomRafId: ReturnType<typeof requestAnimationFrame> | null = null;
		let panRafId: ReturnType<typeof requestAnimationFrame> | null = null;

		const onWheel = (event: WheelEvent) => {
			const normalizedDeltaX = normalizeWheelDelta({
				delta: event.deltaX,
				deltaMode: event.deltaMode,
				pageSize: container.clientWidth,
			});
			const normalizedDeltaY = normalizeWheelDelta({
				delta: event.deltaY,
				deltaMode: event.deltaMode,
				pageSize: container.clientHeight,
			});
			const isZoomGesture = event.ctrlKey || event.metaKey;
			if (isZoomGesture) {
				event.preventDefault();
				pendingZoomDelta += normalizedDeltaY;

				if (zoomRafId === null) {
					zoomRafId = requestAnimationFrame(() => {
						const cappedDelta =
							Math.sign(pendingZoomDelta) *
							Math.min(Math.abs(pendingZoomDelta), 30);
						const zoomFactor = Math.exp(-cappedDelta / 300);

						scaleZoom({ factor: zoomFactor });
						pendingZoomDelta = 0;
						zoomRafId = null;
					});
				}

				return;
			}

			if (!canPan) {
				return;
			}

			if (normalizedDeltaX === 0 && normalizedDeltaY === 0) {
				return;
			}

			event.preventDefault();
			pendingPanDeltaX += normalizedDeltaX;
			pendingPanDeltaY += normalizedDeltaY;

			if (panRafId === null) {
				panRafId = requestAnimationFrame(() => {
					panByScreenDelta({
						deltaX: pendingPanDeltaX,
						deltaY: pendingPanDeltaY,
					});
					pendingPanDeltaX = 0;
					pendingPanDeltaY = 0;
					panRafId = null;
				});
			}
		};

		container.addEventListener("wheel", onWheel, {
			capture: true,
			passive: false,
		});

		return () => {
			container.removeEventListener("wheel", onWheel, {
				capture: true,
			});
			if (zoomRafId !== null) {
				cancelAnimationFrame(zoomRafId);
			}
			if (panRafId !== null) {
				cancelAnimationFrame(panRafId);
			}
		};
	}, [canPan, panByScreenDelta, scaleZoom]);

	return (
		<PreviewViewportProvider value={viewport}>
			<div className="flex size-full min-h-0 min-w-0 flex-col">
				<div className="flex min-h-0 min-w-0 flex-1 p-2 pb-0">
					<ContextMenu>
						<ContextMenuTrigger asChild>
							<div
								ref={viewportRef}
								className="relative flex size-full min-h-0 min-w-0 items-center justify-center overflow-hidden"
							>
							<div
								ref={canvasMountRef}
								className="absolute block border"
								style={{
									left: viewport.sceneLeft,
									top: viewport.sceneTop,
									width: viewport.sceneWidth,
									height: viewport.sceneHeight,
									background:
										activeProject.settings.background.type === "blur"
											? "transparent"
											: activeProject?.settings.background.color,
								}}
							/>
							<PreviewOverlayLayer
								instances={overlayInstances}
								plane="under-interaction"
							/>
							<PreviewInteractionOverlay />
							<PreviewOverlayLayer
								instances={overlayInstances}
								plane="over-interaction"
							/>
							<FpsBadge />
							</div>
						</ContextMenuTrigger>
						<PreviewContextMenu
							onToggleFullscreen={onToggleFullscreen}
							container={container}
							overlayControls={overlayControls}
							onOverlayVisibilityChange={onOverlayVisibilityChange}
						/>
					</ContextMenu>
				</div>
				<PreviewToolbar onToggleFullscreen={onToggleFullscreen} />
			</div>
		</PreviewViewportProvider>
	);
}

/** 预览视口右上角的帧率读数：与时间码同款弱化样式，仅展示数值。 */
function FpsBadge() {
	const fps = usePreviewFrameTime((s) => s.fps);
	return (
		<span className="text-muted-foreground pointer-events-none absolute right-1.5 top-1.5 z-10 font-mono text-[10px] tabular-nums">
			{fps > 0 ? `${fps.toFixed(0)} fps` : "-- fps"}
		</span>
	);
}
