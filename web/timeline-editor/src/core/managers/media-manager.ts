/**
 * [INPUT]: 依赖 EditorCore、recut.assets Manifest/上传/内容 URL 与全局内容缓存 StorageService；demo 模式直接消费注入的离线素材。
 * [OUTPUT]: 对外提供项目媒体清单、上传即入内容缓存、后台同步下载、素材增删和订阅通知；对仍在 queued/running
 *          的「先落位」素材按 2.5s 轮询清单（上限 5 分钟），就绪后自动缓存上屏。
 * [POS]: core/managers 的媒体状态协调器；Service Asset 是真相，本地字节按 contentHash 存全局内容缓存（跨项目去重）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { EditorCore } from "@timeline/core";
import { toast } from "sonner";
import { t, getRecutLocale } from "@timeline/i18n";
import type { MediaAsset } from "@timeline/media/types";
import { storageService } from "@timeline/services/storage/service";
import { mediaContentCache } from "@timeline/services/storage/media-cache";
import { generateUUID } from "@timeline/utils/id";
import { videoCache } from "@timeline/services/video-cache/service";
import { waveformCache } from "@timeline/services/waveform-cache/service";
import { BatchCommand, RemoveMediaAssetCommand } from "@timeline/commands";
import { recut, type RecutAsset } from "@timeline/recut/sdk";
import { isDemoMode } from "@timeline/demo/demo-store";
import { editorStatusFromServer } from "@timeline/media/asset-status";

// 先落位策略：AI 可以把仍在 queued/running 的素材先落轨，媒体清单需要轮询到
// 素材终态，下载缓存后画面/波形才可用。completed/failed/deleted 即终态。
// `proposed` 是计划态（无字节、无 job），不轮询、不下载，仅按状态展示。
const MEDIA_TERMINAL_STATUSES = new Set(["completed", "failed", "deleted", "proposed"]);
const MEDIA_PENDING_REFRESH_INTERVAL_MS = 2500;
// 最多轮询 5 分钟（120 × 2.5s）；超时停止，避免永远挂着一个定时器。
const MEDIA_PENDING_REFRESH_MAX_ATTEMPTS = 120;

export class MediaManager {
	private assets: MediaAsset[] = [];
	private isLoading = false;
	private listeners = new Set<() => void>();
	private pendingRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingRefreshProjectId: string | null = null;
	private pendingRefreshAttempts = 0;
	// 同一 Asset 的同步下载去重：并发 loadProjectMedia（如启动多处触发）共享同一个在途任务。
	private inflightDownloads = new Map<string, Promise<void>>();

	constructor(private editor: EditorCore) {}

	async addMediaAsset({
		projectId,
		asset,
	}: {
		projectId: string;
		asset: Omit<MediaAsset, "id"> & { id?: string };
	}): Promise<MediaAsset | null> {
		let prepared: MediaAsset = {
			...asset,
			id: asset.id ?? generateUUID(),
		};

		// Service Asset 是唯一真相：本地导入（拖拽/粘贴/面板）先经上传拿到 contentHash，
		// 再以 hash 为键写入全局内容缓存；同一内容跨项目只保留一份字节。
		if (!prepared.contentHash) {
			try {
				const uploaded = await recut.assets.upload({
					projectId,
					file: prepared.file,
				});
				const remote = uploaded?.asset;
				if (!remote?.id || !remote.contentHash) {
					throw new Error("assets.upload did not return a content-addressed asset");
				}
				prepared = {
					...prepared,
					id: remote.id,
					contentHash: remote.contentHash,
					sizeBytes: remote.sizeBytes,
					...(remote.mimeType ? { mimeType: remote.mimeType } : {}),
				};
			} catch (error) {
				console.error("Failed to upload media asset:", error);
				toast.error(t(getRecutLocale(), "media.failedImport", { name: prepared.name }));
				return null;
			}
		}

		// Service 按内容去重后可能返回已存在的 Asset：重复导入复用同一引用，避免面板重复占位。
		const duplicated = this.assets.find((item) => item.id === prepared.id);
		if (duplicated) {
			return duplicated;
		}

		this.assets = [...this.assets, prepared];
		this.notify();

		try {
			await storageService.saveMediaAsset({ projectId, mediaAsset: prepared });
			this.editor.project.ratchetFpsForImportedMedia({
				importedAssets: [prepared],
			});
			return prepared;
		} catch (error) {
			console.error("Failed to save media asset:", error);
			this.assets = this.assets.filter((item) => item.id !== prepared.id);
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

	async loadProjectMedia({
		projectId,
		silent = false,
	}: {
		projectId: string;
		/** 后台轮询刷新时不切换 loading 状态，避免每 2.5s 闪一次加载指示。 */
		silent?: boolean;
	}): Promise<void> {
		if (!silent) {
			this.isLoading = true;
			this.notify();
		}

		try {
			if (isDemoMode()) {
				const cachedAssets = await storageService.loadAllMediaAssets({
					projectId,
				});
				this.assets = cachedAssets;
				this.notify();
				return;
			}
			const manifest = await recut.assets.list({ projectId });
			const metadata = await storageService.listMediaAssetMetadata({ projectId });
			const metadataByID = new Map(metadata.map((entry) => [entry.id, entry]));

			// 服务端已删除的素材：释放本项目引用，避免全局内容缓存引用计数泄漏。
			const manifestByID = new Map(manifest.assets.map((asset) => [asset.id, asset]));
			for (const entry of metadata) {
				const remote = manifestByID.get(entry.id);
				if (remote && remote.status === "deleted") {
					void storageService.deleteMediaAsset({ projectId, id: entry.id });
				}
			}

			const editorAssets = manifest.assets.filter(
				(asset) => isEditorMediaAsset(asset) && asset.status !== "deleted",
			);
			// 已完成且全局内容缓存已有字节的素材：只需登记本项目引用并解析画面。
			const localAssets = new Map<string, MediaAsset>();
			for (const asset of editorAssets) {
				if (asset.status !== "completed" || !asset.contentHash) continue;
				if (!(await mediaContentCache.has(asset.contentHash))) continue;
				const entry = metadataByID.get(asset.id);
				if (!entry || entry.contentHash !== asset.contentHash) {
					await storageService
						.saveMediaAsset({ projectId, mediaAsset: toLoadingMediaAsset(asset) })
						.catch(() => undefined);
				}
				const resolved = await storageService.loadMediaAsset({
					projectId,
					id: asset.id,
				});
				if (resolved) localAssets.set(asset.id, resolved);
			}

			this.assets = editorAssets.map((asset) => {
				const local = localAssets.get(asset.id);
				// 服务端 lifecycle 是真相：本地缓存只决定「有没有字节」，不能改写状态，
				// 否则计划态会被陈旧的 loading 覆盖成「加载中」。
				const status = editorStatusFromServer(asset.status, Boolean(local));
				return local ? { ...local, status } : toLoadingMediaAsset(asset);
			});
			this.notify();

			// 主动同步：completed 但本地缺字节的素材，从 service 拉到 OPFS 内容缓存。
			for (const asset of editorAssets) {
				if (asset.status !== "completed" || !asset.contentHash) continue;
				if (await mediaContentCache.has(asset.contentHash)) continue;
				void this.cacheRemoteAsset({ projectId, asset });
			}
			// 仍有 queued/running 的素材：安排下一轮轮询，就绪后自动缓存上屏。
			this.schedulePendingRefresh(projectId, manifest.assets);
		} catch (error) {
			console.error("Failed to load media assets:", error);
		} finally {
			if (!silent) {
				this.isLoading = false;
				this.notify();
			}
		}
	}

	// 只要清单里还有非终态素材就轮询；全部到终态（或超过上限）即停。
	private schedulePendingRefresh(projectId: string, assets: RecutAsset[]): void {
		const hasPending = assets.some(
			(asset) => isEditorMediaAsset(asset) && !MEDIA_TERMINAL_STATUSES.has(asset.status),
		);
		if (!hasPending) {
			this.stopPendingRefresh();
			return;
		}
		if (this.pendingRefreshTimer) return;
		if (this.pendingRefreshProjectId !== projectId) {
			this.pendingRefreshProjectId = projectId;
			this.pendingRefreshAttempts = 0;
		}
		if (this.pendingRefreshAttempts >= MEDIA_PENDING_REFRESH_MAX_ATTEMPTS) return;
		this.pendingRefreshAttempts += 1;
		this.pendingRefreshTimer = setTimeout(() => {
			this.pendingRefreshTimer = null;
			const target = this.pendingRefreshProjectId;
			if (!target) return;
			void this.loadProjectMedia({ projectId: target, silent: true });
		}, MEDIA_PENDING_REFRESH_INTERVAL_MS);
	}

	private stopPendingRefresh(): void {
		if (this.pendingRefreshTimer) {
			clearTimeout(this.pendingRefreshTimer);
			this.pendingRefreshTimer = null;
		}
		this.pendingRefreshProjectId = null;
		this.pendingRefreshAttempts = 0;
	}

	private cacheRemoteAsset({
		projectId,
		asset,
	}: {
		projectId: string;
		asset: RecutAsset;
	}): Promise<void> {
		// 同一 assetId 的同步任务在途时复用，避免并发 loadProjectMedia 重复下载。
		const inflight = this.inflightDownloads.get(asset.id);
		if (inflight) return inflight;
		const task = this.downloadRemoteAsset({ projectId, asset }).finally(() => {
			if (this.inflightDownloads.get(asset.id) === task) {
				this.inflightDownloads.delete(asset.id);
			}
		});
		this.inflightDownloads.set(asset.id, task);
		return task;
	}

	private async downloadRemoteAsset({
		projectId,
		asset,
	}: {
		projectId: string;
		asset: RecutAsset;
	}): Promise<void> {
		try {
			const contentHash = asset.contentHash;
			if (!contentHash) throw new Error("asset has no contentHash");
			// 字节已在全局内容缓存（可能来自其它项目/素材）：跳过网络，直接登记引用。
			if (await mediaContentCache.has(contentHash)) {
				await storageService.saveMediaAsset({
					projectId,
					mediaAsset: toLoadingMediaAsset(asset),
				});
			} else {
				const response = await fetch(
					await recut.assets.contentURL({ assetId: asset.id }),
				);
				if (!response.ok)
					throw new Error(`asset download failed (${response.status})`);
				// 字节直接流式落全局内容缓存（按 hash 去重），再登记本项目引用。
				await mediaContentCache.store({
					hash: contentHash,
					stream: response.body,
					file: response.body ? undefined : await response.blob(),
					size: asset.sizeBytes,
					mimeType: asset.mimeType,
				});
				await storageService.saveMediaAsset({
					projectId,
					mediaAsset: toLoadingMediaAsset(asset),
				});
			}
			const cached = await storageService.loadMediaAsset({
				projectId,
				id: asset.id,
			});
			if (!cached) throw new Error("cached asset could not be resolved");
			this.assets = this.assets.map((item) =>
				item.id === cached.id ? { ...cached, status: "completed" } : item,
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
		this.stopPendingRefresh();
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
		this.stopPendingRefresh();
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

// 只应由 isEditorMediaAsset 判定过的素材调用；kind 已限定在 image/video/audio。
// 服务端完成但本地尚未缓存时由 editorStatusFromServer 派生为 loading（下载过渡）。
function toLoadingMediaAsset(asset: RecutAsset): MediaAsset {
	return {
		id: asset.id,
		name: asset.name,
		type: asset.kind as MediaAsset["type"],
		file: new File([], asset.name, { type: asset.mimeType }),
		status: editorStatusFromServer(asset.status, false),
		contentHash: asset.contentHash,
		mimeType: asset.mimeType,
		sizeBytes: asset.sizeBytes,
	};
}
