/**
 * [INPUT]: 依赖 EditorCore 的场景、时间线和播放状态，以及书签与元素吸附点。
 * [OUTPUT]: 对外提供 useBookmarkDrag，处理书签拖拽、帧对齐与吸附反馈。
 * [POS]: timeline/bookmarks 的交互控制器；在项目同步重载的空场景期间保持惰性且安全。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import {
	useState,
	useCallback,
	useEffect,
	useRef,
	type RefObject,
} from "react";
import { useEditor } from "@timeline/editor/use-editor";
import { useShiftKey } from "@timeline/hooks/use-shift-key";
import { TIMELINE_DRAG_THRESHOLD_PX } from "@timeline/timeline/components/interaction";
import { getMouseTimeFromClientX } from "@timeline/timeline/drag-utils";
import {
	buildTimelineSnapPoints,
	getTimelineSnapThresholdInTicks,
	resolveTimelineSnap,
	type SnapPoint,
} from "@timeline/timeline/snapping";
import { getBookmarkSnapPoints } from "../snap-source";
import { getElementEdgeSnapPoints } from "@timeline/timeline/element-snap-source";
import { getPlayheadSnapPoints } from "@timeline/timeline/playhead-snap-source";
import { getAnimationKeyframeSnapPointsForTimeline } from "@timeline/timeline/animation-snap-points";
import type { Bookmark } from "@timeline/timeline";
import { roundFrameTime, type MediaTime, ZERO_MEDIA_TIME } from "@timeline/wasm";

export interface BookmarkDragState {
	isDragging: boolean;
	bookmarkTime: MediaTime | null;
	currentTime: MediaTime;
}

interface PendingBookmarkDrag {
	bookmarkTime: MediaTime;
	startMouseX: number;
	startMouseY: number;
}

interface UseBookmarkDragProps {
	zoomLevel: number;
	scrollRef: RefObject<HTMLElement | null>;
	snappingEnabled: boolean;
	onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
}

export function useBookmarkDrag({
	zoomLevel,
	scrollRef,
	snappingEnabled,
	onSnapPointChange,
}: UseBookmarkDragProps) {
	const editor = useEditor();
	const isShiftHeldRef = useShiftKey();
	// 书签吸附只需要「已提交」的元素几何，且仅在书签拖拽时读取。这里不能用
	// state.getResolvedTracks()：它在 ephemeral（画布拖拽/滑块）每次变化时都会
	// 换身份，而 useBookmarkDrag 是在 Timeline 顶层调用的，会让整棵 Timeline
	// 每帧重渲染。
	const tracks = useEditor(
		(currentEditor) =>
			currentEditor.scenes.getActiveSceneOrNull()?.tracks ??
			currentEditor.state.getResolvedTracks(),
	);
	const bookmarks = useEditor(
		(currentEditor) =>
			currentEditor.scenes.getActiveSceneOrNull()?.bookmarks ?? [],
	);
	const playheadTime = editor.playback.getCurrentTime();
	const duration = editor.timeline.getTotalDuration();

	const [dragState, setDragState] = useState<BookmarkDragState>({
		isDragging: false,
		bookmarkTime: null,
		currentTime: ZERO_MEDIA_TIME,
	});
	const [isPendingDrag, setIsPendingDrag] = useState(false);
	const pendingDragRef = useRef<PendingBookmarkDrag | null>(null);
	const lastMouseXRef = useRef(0);

	const startDrag = useCallback(
		({
			bookmarkTime,
			initialCurrentTime,
		}: {
			bookmarkTime: MediaTime;
			initialCurrentTime: MediaTime;
		}) => {
			setDragState({
				isDragging: true,
				bookmarkTime,
				currentTime: initialCurrentTime,
			});
		},
		[],
	);

	const endDrag = useCallback(() => {
		setDragState({
			isDragging: false,
			bookmarkTime: null,
			currentTime: ZERO_MEDIA_TIME,
		});
	}, []);

	const getSnapResult = useCallback(
		({
			rawTime,
			excludeBookmarkTime,
		}: {
			rawTime: MediaTime;
			excludeBookmarkTime: MediaTime;
		}): { snappedTime: MediaTime; snapPoint: SnapPoint | null } => {
			const shouldSnap = snappingEnabled && !isShiftHeldRef.current;
			if (!shouldSnap) {
				return { snappedTime: rawTime, snapPoint: null };
			}

			const snapPoints = buildTimelineSnapPoints({
				sources: [
					() => getElementEdgeSnapPoints({ tracks }),
					() => getPlayheadSnapPoints({ playheadTime }),
					() => getBookmarkSnapPoints({ bookmarks, excludeBookmarkTime }),
					() => getAnimationKeyframeSnapPointsForTimeline({ tracks }),
				],
			});
			const result = resolveTimelineSnap({
				targetTime: rawTime,
				snapPoints,
				maxSnapDistance: getTimelineSnapThresholdInTicks({ zoomLevel }),
			});
			return {
				snappedTime: result.snappedTime,
				snapPoint: result.snapPoint,
			};
		},
		[
			snappingEnabled,
			tracks,
			playheadTime,
			bookmarks,
			zoomLevel,
			isShiftHeldRef,
		],
	);

	useEffect(() => {
		if (!dragState.isDragging && !isPendingDrag) return;

		const handleMouseMove = (event: MouseEvent) => {
			lastMouseXRef.current = event.clientX;

			const scrollContainer = scrollRef.current;
			if (!scrollContainer) return;

			if (isPendingDrag && pendingDragRef.current) {
				const { startMouseX, startMouseY, bookmarkTime } =
					pendingDragRef.current;
				const deltaX = Math.abs(event.clientX - startMouseX);
				const deltaY = Math.abs(event.clientY - startMouseY);

				if (
					deltaX <= TIMELINE_DRAG_THRESHOLD_PX &&
					deltaY <= TIMELINE_DRAG_THRESHOLD_PX
				) {
					return;
				}

				const activeProject = editor.project.getActive();
				if (!activeProject) return;

				const scrollLeft = scrollContainer.scrollLeft;
				const mouseTime = getMouseTimeFromClientX({
					clientX: event.clientX,
					containerRect: scrollContainer.getBoundingClientRect(),
					zoomLevel,
					scrollLeft,
				});
				const clampedTime =
					mouseTime > duration ? duration : mouseTime;
				const frameSnappedTime = roundFrameTime({
					time: clampedTime,
					fps: activeProject.settings.fps,
				});
				const { snappedTime: initialTime } = getSnapResult({
					rawTime: frameSnappedTime,
					excludeBookmarkTime: bookmarkTime,
				});

				startDrag({
					bookmarkTime,
					initialCurrentTime: initialTime,
				});
				pendingDragRef.current = null;
				setIsPendingDrag(false);
				return;
			}

			if (!dragState.isDragging || dragState.bookmarkTime === null) return;

			const activeProject = editor.project.getActive();
			if (!activeProject) return;

			const scrollLeft = scrollContainer.scrollLeft;
			const mouseTime = getMouseTimeFromClientX({
				clientX: event.clientX,
				containerRect: scrollContainer.getBoundingClientRect(),
				zoomLevel,
				scrollLeft,
			});
			const clampedTime =
				mouseTime > duration ? duration : mouseTime;
			const frameSnappedTime = roundFrameTime({
				time: clampedTime,
				fps: activeProject.settings.fps,
			});
			const snapResult = getSnapResult({
				rawTime: frameSnappedTime,
				excludeBookmarkTime: dragState.bookmarkTime,
			});

			setDragState((previousDragState) => ({
				...previousDragState,
				currentTime: snapResult.snappedTime,
			}));
			onSnapPointChange?.(snapResult.snapPoint);
		};

		document.addEventListener("mousemove", handleMouseMove);
		return () => document.removeEventListener("mousemove", handleMouseMove);
	}, [
		dragState.isDragging,
		dragState.bookmarkTime,
		zoomLevel,
		duration,
		editor.project,
		scrollRef,
		isPendingDrag,
		startDrag,
		getSnapResult,
		onSnapPointChange,
	]);

	useEffect(() => {
		if (!dragState.isDragging) return;

		const handleMouseUp = () => {
			if (dragState.bookmarkTime === null) {
				endDrag();
				onSnapPointChange?.(null);
				return;
			}

			const clampedTime =
				dragState.currentTime > duration ? duration : dragState.currentTime;

			editor.scenes.moveBookmark({
				fromTime: dragState.bookmarkTime,
				toTime: clampedTime,
			});

			endDrag();
			onSnapPointChange?.(null);
		};

		document.addEventListener("mouseup", handleMouseUp);
		return () => document.removeEventListener("mouseup", handleMouseUp);
	}, [
		dragState.isDragging,
		dragState.bookmarkTime,
		dragState.currentTime,
		duration,
		endDrag,
		onSnapPointChange,
		editor.scenes,
	]);

	useEffect(() => {
		if (!isPendingDrag) return;

		const handleMouseUp = () => {
			pendingDragRef.current = null;
			setIsPendingDrag(false);
			onSnapPointChange?.(null);
		};

		document.addEventListener("mouseup", handleMouseUp);
		return () => document.removeEventListener("mouseup", handleMouseUp);
	}, [isPendingDrag, onSnapPointChange]);

	const handleBookmarkMouseDown = useCallback(
		({ event, bookmark }: { event: React.MouseEvent; bookmark: Bookmark }) => {
			if (event.button !== 0) return;

			event.preventDefault();
			event.stopPropagation();

			pendingDragRef.current = {
				bookmarkTime: bookmark.time,
				startMouseX: event.clientX,
				startMouseY: event.clientY,
			};
			setIsPendingDrag(true);
		},
		[],
	);

	return {
		dragState,
		handleBookmarkMouseDown,
		lastMouseXRef,
	};
}
