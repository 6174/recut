import { EditorCore } from "@/core";
import { Command, type CommandResult } from "@/commands/base-command";
import type { SceneTracks, TimelineElement } from "@/timeline";
import {
	findTrackInSceneTracks,
	updateElementInSceneTracks,
} from "@/timeline";
import { applyElementUpdate } from "@/timeline/update-pipeline";
import {
	broadcastSubtitleStyle,
	isCaptionTrack,
	isSubtitleElement,
} from "@/subtitles/shared-style";

export class UpdateElementsCommand extends Command {
	private savedState: SceneTracks | null = null;
	private readonly updates: Array<{
		trackId: string;
		elementId: string;
		patch: Partial<TimelineElement>;
	}>;

	constructor({
		updates,
	}: {
		updates: Array<{
			trackId: string;
			elementId: string;
			patch: Partial<TimelineElement>;
		}>;
	}) {
		super();
		this.updates = updates;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;
		const canvasSize = editor.project.getActive()?.settings.canvasSize;
		let updatedTracks = this.savedState;

		for (const updateEntry of this.updates) {
			const currentTrack = findTrackInSceneTracks({
				tracks: updatedTracks,
				trackId: updateEntry.trackId,
			});
			const currentElement = currentTrack?.elements.find(
				(element) => element.id === updateEntry.elementId,
			);
			if (!currentTrack || !currentElement) {
				continue;
			}

			const nextElement = applyElementUpdate({
				element: currentElement,
				patch: updateEntry.patch,
				context: {
					tracks: updatedTracks,
					trackId: updateEntry.trackId,
				},
			});

			updatedTracks = updateElementInSceneTracks({
				tracks: updatedTracks,
				trackId: updateEntry.trackId,
				elementId: updateEntry.elementId,
				update: () => nextElement,
			});

			// 字幕 cue 编辑 → 共享样式广播到全轨（含位置重算）。
			if (canvasSize && isSubtitleElement(nextElement)) {
				const trackAfter = findTrackInSceneTracks({
					tracks: updatedTracks,
					trackId: updateEntry.trackId,
				});
				if (isCaptionTrack(trackAfter)) {
					updatedTracks = broadcastSubtitleStyle({
						tracks: updatedTracks,
						trackId: updateEntry.trackId,
						elementId: updateEntry.elementId,
						canvasSize,
					});
				}
			}
		}

		editor.timeline.updateTracks(updatedTracks);
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}
}
