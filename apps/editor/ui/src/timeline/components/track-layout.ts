/**
 * [INPUT]: 依赖时间线轨道类型与场景轨道集合，计算轨道尺寸和可见轨道布局。
 * [OUTPUT]: 对外提供轨道高度、累计高度及 Timeline UI 的显示轨道序列。
 * [POS]: timeline/components 的布局纯函数；空的 Main 轨不占用 UI 空间。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { SceneTracks, TimelineTrack, TrackType } from "@/timeline";
import {
	KEYFRAME_LANE_HEIGHT_PX,
	TIMELINE_TRACK_GAP_PX,
	TIMELINE_TRACK_HEIGHTS_PX,
} from "./layout";

export function getTrackHeight({ type }: { type: TrackType }): number {
	return TIMELINE_TRACK_HEIGHTS_PX[type];
}

export function getExpandedTrackHeight({
	type,
	expandedLaneCount,
}: {
	type: TrackType;
	expandedLaneCount: number;
}): number {
	return (
		TIMELINE_TRACK_HEIGHTS_PX[type] +
		expandedLaneCount * KEYFRAME_LANE_HEIGHT_PX
	);
}

export function getCumulativeHeightBefore({
	tracks,
	trackIndex,
	getExtraHeight,
}: {
	tracks: Array<{ type: TrackType }>;
	trackIndex: number;
	getExtraHeight?: (trackIndex: number) => number;
}): number {
	return tracks
		.slice(0, trackIndex)
		.reduce(
			(sum, track, i) =>
				sum +
				getTrackHeight({ type: track.type }) +
				(getExtraHeight?.(i) ?? 0) +
				TIMELINE_TRACK_GAP_PX,
			0,
		);
}

export function getTotalTracksHeight({
	tracks,
	getExtraHeight,
}: {
	tracks: Array<{ type: TrackType }>;
	getExtraHeight?: (trackIndex: number) => number;
}): number {
	const tracksHeight = tracks.reduce(
		(sum, track, i) =>
			sum + getTrackHeight({ type: track.type }) + (getExtraHeight?.(i) ?? 0),
		0,
	);
	const gapsHeight = Math.max(0, tracks.length - 1) * TIMELINE_TRACK_GAP_PX;
	return tracksHeight + gapsHeight;
}

/** 主轨没有元素时不占用 UI 空间（即使 overlay 上有视频元素）。 */
export function getTimelineDisplayTracks({
	tracks,
}: {
	tracks: SceneTracks;
}): TimelineTrack[] {
	const mainVisible = tracks.main.elements.length > 0;
	return [
		...tracks.overlay,
		...(mainVisible ? [tracks.main] : []),
		...tracks.audio,
	];
}
