import { useEditor } from "@timeline/editor/use-editor";
import { findTrackInSceneTracks, type TimelineElement } from "@timeline/timeline";

/**
 * Subscribes to render tracks and returns the live (preview-aware) version of
 * an element alongside helpers for previewing and committing updates.
 *
 * Use this wherever property fields need to reflect in-progress preview state
 * (e.g. a slider being dragged) rather than the last committed value.
 */
export function useElementPreview<T extends TimelineElement>({
	trackId,
	elementId,
	fallback,
}: {
	trackId: string;
	elementId: string;
	fallback: T;
}) {
	const editor = useEditor();
	// 只订阅「本元素」而不是整份 preview tracks：拖动预览时 ephemeral 每次变化都会
	// 重算 tracks，但未参与预览的元素仍保持原引用（resolveTracks 对无覆盖元素返回原
	// 对象）。按元素粒度返回后，一次拖动只让被覆盖的那个元素重渲染，而不是时间线上
	// 所有 clip 一起重渲染。
	const renderElement =
		useEditor((e) => {
			const tracks =
				e.timeline.getPreviewTracks() ?? e.scenes.getActiveScene().tracks;
			return findTrackInSceneTracks({ tracks, trackId })?.elements.find(
				(element) => element.id === elementId,
			) as T | undefined;
		}) ?? fallback;

	const previewUpdates = (updates: Partial<TimelineElement>) =>
		editor.timeline.previewElements({
			updates: [{ trackId, elementId, updates }],
		});

	const commit = () => editor.timeline.commitPreview();

	return { renderElement, previewUpdates, commit };
}
