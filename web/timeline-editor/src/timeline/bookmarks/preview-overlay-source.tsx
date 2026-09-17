import {
	EMPTY_PREVIEW_OVERLAY_SOURCE_RESULT,
	type PreviewOverlayDefinition,
	type PreviewOverlaySourceResult,
} from "@timeline/preview/overlays";
import { useEditor, useEditorSource } from "@timeline/editor/use-editor";
import { getBookmarksActiveAtTime } from "./utils";
import type { MediaTime } from "@timeline/wasm";

export const bookmarkNotesPreviewOverlay: PreviewOverlayDefinition = {
	id: "bookmark-notes",
	label: "Show bookmark notes",
	labelKey: "preview.showBookmarkNotes",
	defaultVisible: true,
};

function BookmarkNotesOverlay({
	bookmarks,
}: {
	bookmarks: Array<{ time: MediaTime; note: string; color?: string }>;
}) {
	return (
		<div className="flex flex-col gap-1.5" aria-live="polite">
			{bookmarks.map((bookmark) => (
				<div
					key={bookmark.time}
					className="flex max-w-[min(200px,50vw)] px-2.5 py-1.5 text-left text-white text-xs shadow-md backdrop-blur-sm"
					style={{
						backgroundColor: "rgb(0 0 0 / 0.5)",
						borderLeft: bookmark.color
							? `3px solid ${bookmark.color}`
							: "3px solid var(--primary)",
					}}
				>
					{bookmark.note}
				</div>
			))}
		</div>
	);
}

/**
 * 自订阅的 bookmark 便签层：只订阅 scenes（书签）与 playback（当前时间），
 * 把 currentTime 的影响限制在这一个小节点内。父层（EditorLayout / PreviewPanel）
 * 因此不需要订阅 currentTime——否则 seek / scrub 每帧都会重渲染整块编辑器。
 */
function BookmarkNotesOverlayLive() {
	const editor = useEditor();
	const activeScene = useEditorSource(editor.scenes, () =>
		editor.scenes.getActiveSceneOrNull(),
	);
	const time = useEditorSource(editor.playback, () =>
		editor.playback.getCurrentTime(),
	);

	const bookmarksWithNotes = getBookmarksActiveAtTime({
		bookmarks: activeScene?.bookmarks ?? [],
		time,
	}).flatMap((bookmark) => {
		if (bookmark.note == null || bookmark.note.trim() === "") {
			return [];
		}
		return [
			{ time: bookmark.time, note: bookmark.note, color: bookmark.color },
		];
	});

	if (bookmarksWithNotes.length === 0) {
		return null;
	}

	return <BookmarkNotesOverlay bookmarks={bookmarksWithNotes} />;
}

export function getBookmarkPreviewOverlaySource({
	isVisible,
}: {
	isVisible: boolean;
}): PreviewOverlaySourceResult {
	return {
		...EMPTY_PREVIEW_OVERLAY_SOURCE_RESULT,
		definitions: [bookmarkNotesPreviewOverlay],
		instances: isVisible
			? [
					{
						id: bookmarkNotesPreviewOverlay.id,
						mount: { kind: "hud", anchor: "top-left", order: 0 },
						plane: "over-interaction",
						pointerEvents: "none",
						render: () => <BookmarkNotesOverlayLive />,
					},
				]
			: [],
	};
}
