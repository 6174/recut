/**
 * [INPUT]: 依赖 EditorCore、recut.assets Manifest/内容 URL 与 OPFS 缓存 StorageService；demo 模式直接消费注入的离线素材。
 * [OUTPUT]: 对外提供项目媒体清单、后台缓存下载、素材增删和订阅通知。
 * [POS]: core/managers 的媒体状态协调器；Service Asset 是真相，当前 origin 文件仅为可重建缓存。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { EditorCore } from "@/core";
import { toast } from "sonner";
import { t, getRecutLocale } from "@/i18n";
import type { MediaAsset } from "@/media/types";
import { storageService } from "@/services/storage/service";
import { generateUUID } from "@/utils/id";
import { videoCache } from "@/services/video-cache/service";
import { waveformCache } from "@/services/waveform-cache/service";
import { BatchCommand, RemoveMediaAssetCommand } from "@/commands";
import { recut, type RecutAsset } from "@/recut/sdk";
import { isDemoMode } from "@/demo/demo-store";

export class MediaManager {
	private assets: MediaAsset[] = [];
	private isLoading = false;
	private listeners = new Set<() => void>();

	constructor(private editor: EditorCore) {}

	async addMediaAsset({
		projectId,
		asset,
	}: {
		projectId: string;
		asset: Omit<MediaAsset, "id"> & { id?: string };
	}): Promise<MediaAsset | null> {
		const newAsset: MediaAsset = {
			...asset,
			id: asset.id ?? generateUUID(),
		};

		this.assets = [...this.assets, newAsset];
		this.notify();

		try {
			await storageService.saveMediaAsset({ projectId, mediaAsset: newAsset });
			this.editor.project.ratchetFpsForImportedMedia({
				importedAssets: [newAsset],
			});
			return newAsset;
		} catch (error) {
			console.error("Failed to save media asset:", error);
			this.assets = this.assets.filter((asset) => asset.id !== newAsset.id);
			this.notify();

			if (storageService.isQuotaExceededError({ error })) {
				toast.error(t(getRecutLocale(), "media.noStorage"), {
					description: error instanceof Error ? error.message : undefined,
				});
			}

			return null;
		}
	}

	removeMediaAsset({ projectId, id }: { projectId: string; id: string }): void {
		this.removeMediaAssets({ projectId, ids: [id] });
	}

	removeMediaAssets({
		projectId,
		ids,
	}: {
		projectId: string;
		ids: string[];
	}): void {
		const uniqueIds = [...new Set(ids)];
		if (uniqueIds.length === 0) {
			return;
		}

		const command =
			uniqueIds.length === 1
				? new RemoveMediaAssetCommand({
						projectId,
						assetId: uniqueIds[0],
					})
				: new BatchCommand(
						uniqueIds.map((id) =>
							new RemoveMediaAssetCommand({
								projectId,
								assetId: id,
							}),
						),
					);

		this.editor.command.execute({ command });
	}

	async loadProjectMedia({ projectId }: { projectId: string }): Promise<void> {
		this.isLoading = true;
		this.notify();

		try {
			const cachedAssets = await storageService.loadAllMediaAssets({
				projectId,
			});
			if (isDemoMode()) {
				this.assets = cachedAssets;
				this.notify();
				return;
			}
			const manifest = await recut.assets.list({ projectId });
			const cachedByID = new Map(cachedAssets.map((asset) => [asset.id, asset]));
			const remoteAssets = manifest.assets
				.filter((asset) => isEditorMediaAsset(asset) && asset.status !== "deleted")
				.map((asset) => cachedByID.get(asset.id) ?? toLoadingMediaAsset(asset));
			this.assets = remoteAssets;
			this.notify();
			for (const asset of manifest.assets) {
				if (!isEditorMediaAsset(asset) || cachedByID.has(asset.id)) continue;
				if (asset.status === "completed") {
					void this.cacheRemoteAsset({ projectId, asset });
				}
			}
		} catch (error) {
			console.error("Failed to load media assets:", error);
		} finally {
			this.isLoading = false;
			this.notify();
		}
	}

	private async cacheRemoteAsset({
		projectId,
		asset,
	}: {
		projectId: string;
		asset: RecutAsset;
	}): Promise<void> {
		try {
			const response = await fetch(
				await recut.assets.contentURL({ assetId: asset.id }),
			);
			if (!response.ok) throw new Error(`asset download failed (${response.status})`);
			const file = new File([await response.blob()], asset.name, {
				type: asset.mimeType,
			});
			const cached: MediaAsset = {
				...toLoadingMediaAsset(asset),
				file,
				url: URL.createObjectURL(file),
				status: "completed",
			};
			await storageService.saveMediaAsset({ projectId, mediaAsset: cached });
			this.assets = this.assets.map((item) =>
				item.id === cached.id ? cached : item,
			);
			this.notify();
		} catch (error) {
			console.error("Failed to cache Asset:", asset.id, error);
			this.assets = this.assets.map((item) =>
				item.id === asset.id ? { ...item, status: "failed" } : item,
			);
			this.notify();
		}
	}

	async clearProjectMedia({ projectId }: { projectId: string }): Promise<void> {
		waveformCache.clearAll();

		this.assets.forEach((asset) => {
			if (asset.url) {
				URL.revokeObjectURL(asset.url);
			}
			if (asset.thumbnailUrl) {
				URL.revokeObjectURL(asset.thumbnailUrl);
			}
		});

		const mediaIds = this.assets.map((asset) => asset.id);
		this.assets = [];
		this.notify();

		try {
			await Promise.all(
				mediaIds.map((id) =>
					storageService.deleteMediaAsset({ projectId, id }),
				),
			);
		} catch (error) {
			console.error("Failed to clear media assets from storage:", error);
		}
	}

	clearAllAssets(): void {
		videoCache.clearAll();
		waveformCache.clearAll();

		this.assets.forEach((asset) => {
			if (asset.url) {
				URL.revokeObjectURL(asset.url);
			}
			if (asset.thumbnailUrl) {
				URL.revokeObjectURL(asset.thumbnailUrl);
			}
		});

		this.assets = [];
		this.notify();
	}

	getAssets(): MediaAsset[] {
		return this.assets;
	}

	setAssets({ assets }: { assets: MediaAsset[] }): void {
		this.assets = assets;
		this.notify();
	}

	isLoadingMedia(): boolean {
		return this.isLoading;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}
}

function isEditorMediaAsset(asset: RecutAsset): asset is RecutAsset & {
	kind: "image" | "video" | "audio";
} {
	return asset.kind === "image" || asset.kind === "video" || asset.kind === "audio";
}

function toLoadingMediaAsset(asset: RecutAsset & {
	kind: "image" | "video" | "audio";
}): MediaAsset {
	return {
		id: asset.id,
		name: asset.name,
		type: asset.kind,
		file: new File([], asset.name, { type: asset.mimeType }),
		status: asset.status === "deleted" ? "deleted" : "loading",
		contentHash: asset.contentHash,
		sizeBytes: asset.sizeBytes,
	};
}
