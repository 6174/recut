/**
 * [INPUT]: 依赖 EditorCore 媒体缓存、OPFS StorageService 与 recut.assets 解除引用能力。
 * [OUTPUT]: 提供「从当前项目解除媒体素材引用」的命令；素材本体（全局库/文件/其它项目引用）
 *           全部保留，只从本项目素材面板与本地缓存移除该条。
 * [POS]: commands/media 的引用解除边界；删除的是 asset_id↔project_id 的引用，而非全局 Asset。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { MediaAsset } from "@/media/types";
import { buildWaveformSourceKey } from "@/media/waveform-summary";
import { storageService } from "@/services/storage/service";
import { videoCache } from "@/services/video-cache/service";
import { waveformCache } from "@/services/waveform-cache/service";
import { recut } from "@/recut/sdk";

export class RemoveMediaAssetCommand extends Command {
	private removedAsset: MediaAsset | null = null;

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
	}

	/** 删除落定（含失败）后 resolve，供调用方在适当时机重载素材列表。 */
	whenDeleted(): Promise<void> {
		return this.deletion ?? Promise.resolve();
	}

	undo(): void {
		// Assets 删除是跨项目、不可恢复的 Service 操作；undo 不能伪造本地恢复。
		return;
	}
}
