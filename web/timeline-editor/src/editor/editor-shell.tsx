/**
 * [INPUT]: 依赖 EditorCore、编辑器布局面板、Recut iframe SDK 的工作焦点上报
 * [OUTPUT]: 对外提供编辑器壳与宿主可消费的完整时间线选择态
 * [POS]: editor 的顶层布局；将当前选择、播放头与项目画布作为 Focus 附着到宿主签发的项目 Work Surface
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { ThemeProvider } from "next-themes";
import { EditorProvider } from "@timeline/components/providers/editor-provider";
import { AssetsPanel } from "@timeline/components/editor/panels/assets";
import { PropertiesPanel } from "@timeline/components/editor/panels/properties";
import { Timeline } from "@timeline/timeline/components";
import { PreviewPanel } from "@timeline/preview/components";
import {
	ResizablePanelGroup,
	ResizablePanel,
	ResizableHandle,
} from "@timeline/components/ui/resizable";
import { TooltipProvider } from "@timeline/components/ui/tooltip";
import { Toaster } from "@timeline/components/ui/sonner";
import { useEditor } from "@timeline/editor/use-editor";
import { usePanelStore, type PanelSizes } from "@timeline/editor/panel-store";
import { usePreviewStore } from "@timeline/preview/preview-store";
import { createPreviewOverlayControl, isPreviewOverlayVisible, mergePreviewOverlaySources } from "@timeline/preview/overlays";
import { getGuidePreviewOverlaySource } from "@timeline/guides";
import { bookmarkNotesPreviewOverlay, getBookmarkPreviewOverlaySource } from "@timeline/timeline/bookmarks/index";
import { usePasteMedia } from "@timeline/media/use-paste-media";
import { HtmlInCanvasBanner } from "@timeline/components/editor/html-in-canvas-banner";
import { recut } from "@timeline/recut/sdk";

// 无 props 的重面板：memo 后不随父层（播放头/面板尺寸）变化重渲染，只跟随各自订阅的 store。
const MemoAssetsPanel = memo(AssetsPanel);
const MemoPropertiesPanel = memo(PropertiesPanel);
const MemoTimeline = memo(Timeline);

function EditorWorkFocusReporter() {
	const editor = useEditor();
	const selected = useEditor((instance) => instance.selection.getSelectedElements());
	useEffect(() => {
		const selectedElements = selected.map((ref) => {
			const track = editor.timeline.getTrackById({ trackId: ref.trackId });
			const element = track?.elements.find((item) => item.id === ref.elementId) ?? null;
			return { ref, track: track ? { id: track.id, name: track.name, type: track.type } : null, element };
		});
		const project = editor.project.getActive();
		void recut.focus.report({
			view: "timeline",
			selection: selected.map((ref) => ({ kind: "timeline_element", id: ref.elementId })),
			selectionState: { selectedElements },
			cursor: { kind: "time", seconds: Number(editor.playback.getCurrentTime()) / 120000 },
			state: { canvas: project?.settings.canvasSize, durationTicks: Number(editor.timeline.getTotalDuration()) },
			summary: selectedElements.length ? `已选 ${selectedElements.length} 个时间线元素` : "未选择时间线元素",
		});
	}, [editor, selected]);
	return null;
}

function EditorLayout() {
	usePasteMedia();
	// defaultSize 只在挂载时生效：读一次初始值，不订阅整个 panel store，
	// 否则拖面板时每帧的 setPanel 都会让整棵编辑器重渲染。
	const initialPanels = useMemo(() => usePanelStore.getState().panels, []);
	const setPanels = usePanelStore((state) => state.setPanels);
	const pendingPanelsRef = useRef<Partial<PanelSizes>>({});
	const panelsRafRef = useRef(0);
	const reportPanels = useCallback(
		(sizes: Partial<PanelSizes>) => {
			pendingPanelsRef.current = { ...pendingPanelsRef.current, ...sizes };
			if (panelsRafRef.current) return;
			panelsRafRef.current = requestAnimationFrame(() => {
				panelsRafRef.current = 0;
				const pending = pendingPanelsRef.current;
				pendingPanelsRef.current = {};
				if (Object.keys(pending).length) setPanels(pending);
			});
		},
		[setPanels],
	);
	useEffect(
		() => () => {
			if (panelsRafRef.current) cancelAnimationFrame(panelsRafRef.current);
		},
		[],
	);
	const activeGuide = usePreviewStore((state) => state.activeGuide);
	const overlays = usePreviewStore((state) => state.overlays);
	const setOverlayVisibility = usePreviewStore((state) => state.setOverlayVisibility);
	const showBookmarkNotes = isPreviewOverlayVisible({
		overlay: bookmarkNotesPreviewOverlay,
		overlays,
	});

	// 这里不再订阅 currentTime / activeScene：bookmark 便签自己按 scenes + playback
	// 订阅（BookmarkNotesOverlayLive），避免 seek / scrub 每帧重渲染整个 EditorLayout
	// 及其下的 PreviewPanel / PreviewCanvas。
	const overlaySource = useMemo(
		() =>
			mergePreviewOverlaySources({
				sources: [
					getGuidePreviewOverlaySource({ guideId: activeGuide }),
					getBookmarkPreviewOverlaySource({ isVisible: showBookmarkNotes }),
				],
			}),
		[activeGuide, showBookmarkNotes],
	);

	const overlayControls = useMemo(
		() =>
			overlaySource.definitions.map((overlay) =>
				createPreviewOverlayControl({ overlay, overlays }),
			),
		[overlaySource.definitions, overlays],
	);

	return (
		<>
			<EditorWorkFocusReporter />
			<ResizablePanelGroup
			direction="vertical"
			className="size-full gap-0"
			onLayout={(sizes) => {
				reportPanels({ mainContent: sizes[0] ?? initialPanels.mainContent, timeline: sizes[1] ?? initialPanels.timeline });
			}}
		>
			<ResizablePanel defaultSize={initialPanels.mainContent} minSize={30} maxSize={85} className="min-h-0">
				<ResizablePanelGroup
					direction="horizontal"
					className="size-full gap-0"
					onLayout={(sizes) => {
						reportPanels({ tools: sizes[0] ?? initialPanels.tools, preview: sizes[1] ?? initialPanels.preview, properties: sizes[2] ?? initialPanels.properties });
					}}
				>
					<ResizablePanel defaultSize={initialPanels.tools} minSize={15} maxSize={40} className="min-w-0">
						<MemoAssetsPanel />
					</ResizablePanel>
					<ResizableHandle withHandle />
					<ResizablePanel defaultSize={initialPanels.preview} minSize={30} className="min-h-0 min-w-0 flex-1">
						<PreviewPanel overlayControls={overlayControls} overlayInstances={overlaySource.instances} onOverlayVisibilityChange={setOverlayVisibility} />
					</ResizablePanel>
					<ResizableHandle withHandle />
					<ResizablePanel defaultSize={initialPanels.properties} minSize={15} maxSize={40} className="min-w-0">
						<MemoPropertiesPanel />
					</ResizablePanel>
				</ResizablePanelGroup>
			</ResizablePanel>

			<ResizableHandle withHandle />

			<ResizablePanel defaultSize={initialPanels.timeline} minSize={15} maxSize={70} className="min-h-0">
				<MemoTimeline />
			</ResizablePanel>
			</ResizablePanelGroup>
		</>
	);
}

export function EditorShell({ projectId }: { projectId: string }) {
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="dark"
			forcedTheme="dark"
			disableTransitionOnChange={true}
		>
			<TooltipProvider>
				<Toaster />
				<EditorProvider projectId={projectId}>
					<div className="bg-background flex size-full flex-col overflow-hidden">
						<HtmlInCanvasBanner />
						<div className="min-h-0 min-w-0 flex-1">
							<EditorLayout />
						</div>
					</div>
				</EditorProvider>
			</TooltipProvider>
		</ThemeProvider>
	);
}
