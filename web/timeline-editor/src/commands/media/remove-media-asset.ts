/**
 * [INPUT]: 依赖 EditorCore 媒体缓存、OPFS StorageService 与 recut.assets 解除引用能力。
 * [OUTPUT]: 提供「从当前项目解除媒体素材引用」的命令；素材本体（全局库/文件/其它项目引用）
 *           全部保留，只从本项目素材面板与本地缓存移除该条；时间线上引用该素材的元素一并删除（可 undo）。
 * [POS]: commands/media 的引用解除边界；删除的是 asset_id↔project_id 的引用，而非全局 Asset。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Command, type CommandResult } from "@timeline/commands/base-command";
import { EditorCore } from "@timeline/core";
import type { MediaAsset } from "@timeline/media/types";
import { buildWaveformSourceKey } from "@timeline/media/waveform-summary";
import { storageService } from "@timeline/services/storage/service";
import { videoCache } from "@timeline/services/video-cache/service";
import { waveformCache } from "@timeline/services/waveform-cache/service";
import { recut } from "@timeline/recut/sdk";
import { hasMediaId } from "@timeline/timeline/element-utils";
import { DeleteElementsCommand } from "../timeline/element/delete-elements";

// 收集时间线上引用该素材的元素引用（当前场景全部轨道）。
function collectOrphanedElements({
	editor,
	assetId,
}: {
	editor: EditorCore;
	assetId: string;
}): { trackId: string; elementId: string }[] {
	const elements: { trackId: string; elementId: string }[] = [];
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return elements;
	for (const track of [...tracks.overlay, tracks.main, ...tracks.audio]) {
		for (const element of track.elements) {
			if (hasMediaId(element) && element.mediaId === assetId) {
				elements.push({ trackId: track.id, elementId: element.id });
			}
		}
	}
	return elements;
}

export class RemoveMediaAssetCommand extends Command {
	private removedAsset: MediaAsset | null = null;
	private deletion: Promise<unknown> | null = null;
	// 引用该素材的时间线元素删除（与素材引用解除同一命令，undo 一并恢复）。
	private orphanedElementsDelete: DeleteElementsCommand | null = null;

	constructor({
		projectId,
		assetId,
	}: {
		projectId: string;
		assetId: string;
	}) {
		super();
		this.projectId = projectId;
		this.assetId = assetId;
	}

	private projectId: string;
	private assetId: string;

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const assets = editor.media.getAssets();

		this.removedAsset =
			assets.find((media) => media.id === this.assetId) ?? null;

		if (!this.removedAsset) {
			console.error("Media asset not found:", this.assetId);
			return;
		}

		// 删除素材引用时，时间线上引用它的元素一并删除，避免留下悬空引用。
		let selectionResult: CommandResult | undefined;
		const orphanedElements = collectOrphanedElements({
			editor,
			assetId: this.assetId,
		});
		if (orphanedElements.length > 0) {
			this.orphanedElementsDelete = new DeleteElementsCommand({
				elements: orphanedElements,
			});
			selectionResult = this.orphanedElementsDelete.execute();
		}

		if (this.removedAsset.url) {
			URL.revokeObjectURL(this.removedAsset.url);
		}
		if (this.removedAsset.thumbnailUrl) {
			URL.revokeObjectURL(this.removedAsset.thumbnailUrl);
		}

		videoCache.clearVideo({ mediaId: this.assetId });
		waveformCache.clearSource({
			sourceKey: buildWaveformSourceKey({
				kind: "media",
				id: this.assetId,
			}),
		});

		// 只是从当前项目素材面板移除该条（解除引用），全局素材库保留。
		editor.media.setAssets({
			assets: assets.filter((media) => media.id !== this.assetId),
		});

		this.deletion = Promise.all([
			storageService.deleteMediaAsset({ projectId: this.projectId, id: this.assetId }),
			recut.assets.delete({ assetId: this.assetId, projectId: this.projectId }),
		]).catch((error) => {
			console.error("Failed to remove media asset reference:", error);
		});

		return selectionResult;
	}

	/** 删除落定（含失败）后 resolve，供调用方在适当时机重载素材列表。 */
	whenDeleted(): Promise<void> {
		return this.deletion ? this.deletion.then(() => undefined) : Promise.resolve();
	}

	undo(): void {
		// Assets 删除是跨项目、不可恢复的 Service 操作；undo 不能伪造本地恢复。
		// 但时间线元素的删除可以本地恢复。
		this.orphanedElementsDelete?.undo();
	}
}
