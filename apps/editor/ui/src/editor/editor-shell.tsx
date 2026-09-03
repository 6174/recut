/**
 * [INPUT]: 依赖 EditorCore、编辑器布局面板、Recut iframe SDK 的工作焦点上报
 * [OUTPUT]: 对外提供编辑器壳与宿主可消费的完整时间线选择态
 * [POS]: editor 的顶层布局；将当前选择、播放头与项目画布作为 Focus 附着到宿主签发的项目 Work Surface
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { useEffect, useMemo } from "react";
import { ThemeProvider } from "next-themes";
import { EditorProvider } from "@/components/providers/editor-provider";
import { EditorHeader } from "@/components/editor/editor-header";
import { AssetsPanel } from "@/components/editor/panels/assets";
import { PropertiesPanel } from "@/components/editor/panels/properties";
import { Timeline } from "@/timeline/components";
import { PreviewPanel } from "@/preview/components";
import {
	ResizablePanelGroup,
	ResizablePanel,
	ResizableHandle,
} from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { useEditor } from "@/editor/use-editor";
import { usePanelStore } from "@/editor/panel-store";
import { usePreviewStore } from "@/preview/preview-store";
import { createPreviewOverlayControl, isPreviewOverlayVisible, mergePreviewOverlaySources } from "@/preview/overlays";
import { getGuidePreviewOverlaySource } from "@/guides";
import { bookmarkNotesPreviewOverlay, getBookmarkPreviewOverlaySource } from "@/timeline/bookmarks/index";
import { usePasteMedia } from "@/media/use-paste-media";
import { HtmlInCanvasBanner } from "@/components/editor/html-in-canvas-banner";
import { recut } from "@/recut/sdk";

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
	const { panels, setPanel } = usePanelStore();
	const activeScene = useEditor((editor) => editor.scenes.getActiveSceneOrNull());
	const currentTime = useEditor((editor) => editor.playback.getCurrentTime());
	const activeGuide = usePreviewStore((state) => state.activeGuide);
	const overlays = usePreviewStore((state) => state.overlays);
	const setOverlayVisibility = usePreviewStore((state) => state.setOverlayVisibility);
	const showBookmarkNotes = isPreviewOverlayVisible({
		overlay: bookmarkNotesPreviewOverlay,
		overlays,
	});

	const overlaySource = useMemo(
		() =>
			mergePreviewOverlaySources({
				sources: [
					getGuidePreviewOverlaySource({ guideId: activeGuide }),
					activeScene
						? getBookmarkPreviewOverlaySource({
								bookmarks: activeScene.bookmarks,
								time: currentTime,
								isVisible: showBookmarkNotes,
							})
						: {
								definitions: [bookmarkNotesPreviewOverlay],
								instances: [],
							},
				],
			}),
		[activeGuide, activeScene, currentTime, showBookmarkNotes],
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
			className="size-full gap-[0.18rem]"
			onLayout={(sizes) => {
				setPanel({ panel: "mainContent", size: sizes[0] ?? panels.mainContent });
				setPanel({ panel: "timeline", size: sizes[1] ?? panels.timeline });
			}}
		>
			<ResizablePanel defaultSize={panels.mainContent} minSize={30} maxSize={85} className="min-h-0">
				<ResizablePanelGroup
					direction="horizontal"
					className="size-full gap-[0.19rem] px-3"
					onLayout={(sizes) => {
						setPanel({ panel: "tools", size: sizes[0] ?? panels.tools });
						setPanel({ panel: "preview", size: sizes[1] ?? panels.preview });
						setPanel({ panel: "properties", size: sizes[2] ?? panels.properties });
					}}
				>
					<ResizablePanel defaultSize={panels.tools} minSize={15} maxSize={40} className="min-w-0">
						<AssetsPanel />
					</ResizablePanel>
					<ResizableHandle withHandle />
					<ResizablePanel defaultSize={panels.preview} minSize={30} className="min-h-0 min-w-0 flex-1">
						<PreviewPanel overlayControls={overlayControls} overlayInstances={overlaySource.instances} onOverlayVisibilityChange={setOverlayVisibility} />
					</ResizablePanel>
					<ResizableHandle withHandle />
					<ResizablePanel defaultSize={panels.properties} minSize={15} maxSize={40} className="min-w-0">
						<PropertiesPanel />
					</ResizablePanel>
				</ResizablePanelGroup>
			</ResizablePanel>

			<ResizableHandle withHandle />

			<ResizablePanel defaultSize={panels.timeline} minSize={15} maxSize={70} className="min-h-0 px-3 pb-3">
				<Timeline />
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
					<div className="bg-background flex h-screen w-screen flex-col overflow-hidden">
						<EditorHeader />
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
