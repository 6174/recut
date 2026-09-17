"use client";

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useEditor, useEditorSource } from "@timeline/editor/use-editor";
import { useRafLoop } from "@timeline/hooks/use-raf-loop";
import { useContainerSize } from "@timeline/hooks/use-container-size";
import { useFullscreen } from "@timeline/hooks/use-fullscreen";
import { WorldRenderer } from "@timeline/runtime";
import { buildWorld } from "@timeline/runtime/build-world";
import { prewarmWorldMedia } from "@timeline/runtime/texture";
import { mediaTimeToSeconds, TICKS_PER_SECOND } from "@timeline/wasm";
import { PreviewOverlayLayer } from "./overlay-layer";
import { PreviewInteractionOverlay } from "./preview-interaction-overlay";
import { usePreviewFrameTime } from "@timeline/preview/frame-time";
import { ContextMenu, ContextMenuTrigger } from "@timeline/components/ui/context-menu";
import type {
	PreviewOverlayControl,
	PreviewOverlayInstance,
} from "@timeline/preview/overlays";
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
	const editor = useEditor();
	// 只订阅画布尺寸这一片：project 上的 timelineViewState 变更（滚动/缩放落盘）
	// 不应把预览整树带起来。
	const canvasSize = useEditorSource(editor.project, () =>
		editor.project.getActive()?.settings.canvasSize,
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
			className="panel bg-panel relative flex size-full min-h-0 min-w-0 flex-col rounded-none border-0"
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
	const lastSceneRef = useRef<import("@timeline/runtime/types").World | null>(null);
	const lastLoopAtRef = useRef(0);
	const worldRef = useRef<import("@timeline/runtime/types").World | null>(null);
	const rendererOwnerRef = useRef<WorldRenderer | null>(null);
	const rendererLeaseRef = useRef(0);
	const { width: nativeWidth, height: nativeHeight } = usePreviewSize();
	const viewportSize = useContainerSize({ containerRef: viewportRef });
	const editor = useEditor();
	// 按 source 订阅并把切片收窄到 fps / background：fps 与 background 在播放与
	// 拖拽中都不变，因此这些源的通知不会引起预览重渲染。
	const activeFps = useEditorSource(editor.project, () =>
		editor.project.getActive().settings.fps,
	);
	const background = useEditorSource(editor.project, () =>
		editor.project.getActive().settings.background,
	);
	// tracks / mediaAssets 不再是 React 订阅：world 重建改由 rAF 里的 dirty 标记驱动，
	// 这样 preview 拖拽（ephemeral 每帧变）不会重渲染整棵预览子树。
	const worldDirtyRef = useRef(true);
	const viewport = usePreviewViewportState({
		canvasHeight: nativeHeight,
		canvasWidth: nativeWidth,
		viewportHeight: viewportSize.height,
		viewportRef,
		viewportWidth: viewportSize.width,
	});
	const { canPan, panByScreenDelta, scaleZoom } = viewport;

	// 常驻 renderer：用 ref 做「按 key 缓存」而不是每次 useMemo 直接 new。
	// StrictMode 在 dev 会双调用 useMemo 工厂，朴素 new 会创建两个 React root +
	// WebGL context 并泄漏被丢弃的那个；这里第二个调用命中缓存，只创建一个。
	// 尺寸/fps 真正变化时才重建，并异步销毁旧实例。
	const rendererCacheRef = useRef<{ key: string; renderer: WorldRenderer } | null>(null);
	const renderer = useMemo(() => {
		const key = `${nativeWidth ?? 0}x${nativeHeight ?? 0}@${activeFps.numerator}/${activeFps.denominator}`;
		const cached = rendererCacheRef.current;
		if (cached && cached.key === key) return cached.renderer;
		const created = new WorldRenderer({
			width: nativeWidth,
			height: nativeHeight,
			fps: activeFps,
		});
		rendererCacheRef.current = { key, renderer: created };
		if (cached) queueMicrotask(() => cached.renderer.dispose());
		return created;
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

	// world 重建改为命令式：订阅只置 dirty 标记，真正的 buildWorld 放到 rAF 渲染
	// 循环里。这样 PreviewCanvas 不再因为 tracks/media 变化而重渲染整棵预览子树，
	// 每帧只跑 GPU 渲染路径。
	useEffect(() => {
		worldDirtyRef.current = true;
		const mark = () => {
			worldDirtyRef.current = true;
		};
		const unsubs = [
			editor.timeline.subscribe(mark),
			editor.scenes.subscribe(mark),
			editor.media.subscribe(mark),
		];
		return () => {
			for (const unsubscribe of unsubs) unsubscribe();
		};
	}, [editor]);

	// 尺寸/fps/背景变化会重建 renderer 或改变输出几何，需要重建 world。
	useEffect(() => {
		worldDirtyRef.current = true;
	}, [nativeWidth, nativeHeight, activeFps.numerator, activeFps.denominator, background]);

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
		const activeProject = editor.project.getActiveOrNull();
		if (!activeProject) return;

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
		const renderTimeSec = mediaTimeToSeconds({
			time: renderTime as import("@timeline/wasm").MediaTime,
		});

		if (worldDirtyRef.current || !worldRef.current) {
			worldDirtyRef.current = false;
			const settings = activeProject.settings;
			const world = buildWorld({
				scene: {
					id: "preview",
					tracks:
						editor.timeline.getPreviewTracks() ??
						editor.scenes.getActiveScene().tracks,
				},
				mediaAssets: editor.media.getAssets(),
				canvasSize: settings.canvasSize,
				fps: renderer.fps.numerator / renderer.fps.denominator,
				duration: mediaTimeToSeconds({
					time: editor.timeline.getTotalDuration(),
				}),
				background: settings.background,
			});
			world.isPreview = true;
			worldRef.current = world;
		}

		const world = worldRef.current;
		if (!world) return;

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
		prewarmWorldMedia(world, renderTimeSec);
		renderer
			.render({
				world,
				time: renderTimeSec,
				// 预览不等待出图：WorldScene frameloop="demand"，React 提交后 invalidate
				// 下一帧即绘制（与纹理捕获合并失效），避免 2 帧等待 + 渲染中跳过导致的元素/选择框脱节。
				waitForDraw: false,
			})
			.catch((error) => {
				lastFrameRef.current = -1;
				console.error("Preview render failed:", error);
			});
	}, [renderer, editor.playback, editor.timeline, editor.project, editor.media, editor.scenes]);

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
										background.type === "blur"
											? "transparent"
											: background.color,
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
