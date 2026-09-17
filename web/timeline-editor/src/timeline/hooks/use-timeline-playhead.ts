import { useEffect, useState } from "react";
import { useEditor } from "@timeline/editor/use-editor";
import { useCommittedRef } from "@timeline/hooks/use-committed-ref";
import { useShiftKey } from "@timeline/hooks/use-shift-key";
import { useEdgeAutoScroll } from "@timeline/timeline/hooks/use-edge-auto-scroll";
import { timelineTimeToPixels } from "@timeline/timeline";
import { useTimelineStore } from "@timeline/timeline/timeline-store";
import {
	PlayheadController,
	type PlayheadConfig,
} from "@timeline/timeline/controllers/playhead-controller";
import type { SnapPoint } from "@timeline/timeline/snapping";
import type { MediaTime } from "@timeline/wasm";

interface UseTimelinePlayheadProps {
	zoomLevel: number;
	rulerRef: React.RefObject<HTMLDivElement | null>;
	rulerScrollRef: React.RefObject<HTMLDivElement | null>;
	tracksScrollRef: React.RefObject<HTMLDivElement | null>;
	playheadRef?: React.RefObject<HTMLDivElement | null>;
	onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
}

export function useTimelinePlayhead({
	zoomLevel,
	rulerRef,
	rulerScrollRef,
	tracksScrollRef,
	playheadRef,
	onSnapPointChange,
}: UseTimelinePlayheadProps) {
	const editor = useEditor();
	const isShiftHeldRef = useShiftKey();
	const isSnappingEnabled = useTimelineStore((s) => s.snappingEnabled);
	// isScrubbing drives useEdgeAutoScroll — the controller sets it on the editor,
	// so this reactive read naturally reflects whether scrubbing is active.
	const isScrubbing = useEditor((e) => e.playback.getIsScrubbing());

	const config: PlayheadConfig = {
		zoomLevel,
		duration: editor.timeline.getTotalDuration(),
		getActiveProjectFps: () => editor.project.getActive()?.settings.fps ?? null,
		isShiftHeld: () => isShiftHeldRef.current,
		getIsPlaying: () => editor.playback.getIsPlaying(),
		isSnappingEnabled: () => isSnappingEnabled,
		getRulerEl: () => rulerRef.current,
		getRulerScrollEl: () => rulerScrollRef.current,
		getTracksScrollEl: () => tracksScrollRef.current,
		getPlayheadEl: () => playheadRef?.current ?? null,
		getSceneTracks: () => editor.scenes.getActiveScene().tracks,
		getSceneBookmarks: () => editor.scenes.getActiveScene()?.bookmarks ?? [],
		seek: (time) => editor.playback.seek({ time }),
		setScrubbing: (scrubbing) =>
			editor.playback.setScrubbing({ isScrubbing: scrubbing }),
		onSnapPointChange,
		setTimelineViewState: ({ zoomLevel, scrollLeft, playheadTime }) =>
			editor.project.setTimelineViewState({
				viewState: {
					zoomLevel,
					scrollLeft,
					playheadTime,
				},
			}),
	};
	const configRef = useCommittedRef(config);
	const [ctrl] = useState(() => new PlayheadController({ configRef }));

	// Scroll → keep playhead position in sync with scroll offset.
	useEffect(() => {
		const scrollEl = rulerScrollRef.current;
		if (!scrollEl) return;
		const handler = () =>
			ctrl.updatePlayheadLeft(editor.playback.getCurrentTime());
		scrollEl.addEventListener("scroll", handler, { passive: true });
		return () => scrollEl.removeEventListener("scroll", handler);
	}, [ctrl, editor.playback, rulerScrollRef]);

	// Playback events → update playhead position and auto-scroll during playback.
	useEffect(() => {
		const handler = (time: MediaTime) => ctrl.handlePlaybackUpdate(time);
		ctrl.updatePlayheadLeft(editor.playback.getCurrentTime());
		const unsubscribeUpdate = editor.playback.onUpdate(handler);
		const unsubscribeSeek = editor.playback.onSeek(handler);
		return () => {
			unsubscribeUpdate();
			unsubscribeSeek();
		};
	}, [ctrl, editor.playback]);

	useEdgeAutoScroll({
		isActive: isScrubbing,
		getMouseClientX: () => ctrl.getLastMouseClientX(),
		rulerScrollRef,
		tracksScrollRef,
		contentWidth: timelineTimeToPixels({
			time: editor.timeline.getTotalDuration(),
			zoomLevel,
		}),
	});

	useEffect(() => () => ctrl.destroy(), [ctrl]);

	return {
		handlePlayheadMouseDown: ctrl.onPlayheadMouseDown,
		handleRulerMouseDown: ctrl.onRulerMouseDown,
	};
}
