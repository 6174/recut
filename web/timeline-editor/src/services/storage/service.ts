import type { TProject, TProjectMetadata } from "@timeline/project/types";
import { getProjectDurationFromScenes } from "@timeline/timeline/scenes";
import type { MediaAsset } from "@timeline/media/types";
import { IndexedDBAdapter } from "./indexeddb-adapter";
import { OPFSAdapter } from "./opfs-adapter";
import { mediaContentCache } from "./media-cache";
import { recut } from "@timeline/recut/sdk";
import { syncTimelineComponents } from "@timeline/recut/components";
import { demoAssets, demoProject, isDemoMode } from "@timeline/demo/demo-store";
import {
	type StorageCapacityCheckResult,
	StorageQuotaExceededError,
	evaluateStorageCapacity,
	isStorageQuotaExceededError,
	readStorageQuotaStatus,
} from "./quota";
import type {
	MediaAssetData,
	StorageConfig,
	SerializedProject,
	SerializedScene,
} from "./types";
import type { SavedSoundsData, SavedSound, SoundEffect } from "@timeline/sounds/types";
import {
	migrations,
	runStorageMigrations,
} from "@timeline/services/storage/migrations";
import type {
	AudioTrack,
	Bookmark,
	OverlayTrack,
	SceneTracks,
	TScene,
	VideoTrack,
} from "@timeline/timeline";
import { roundMediaTime } from "@timeline/wasm";

function normalizeBookmarks({ raw }: { raw: unknown }): Bookmark[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((item): Bookmark | null => {
			if (typeof item === "number") {
				return { time: roundMediaTime({ time: item }) };
			}
			const obj = item as Record<string, unknown>;
			if (
				typeof obj !== "object" ||
				obj === null ||
				typeof obj.time !== "number"
			) {
				return null;
			}
			return {
				time: roundMediaTime({ time: obj.time }),
				...(typeof obj.note === "string" && { note: obj.note }),
				...(typeof obj.color === "string" && { color: obj.color }),
				...(typeof obj.duration === "number" && {
					duration: roundMediaTime({ time: obj.duration }),
				}),
			};
		})
		.filter((b): b is Bookmark => b !== null);
}

function toDate(value: unknown): Date {
	return value instanceof Date ? value : new Date(value as string);
}

/** 清除已移除功能遗留的 sticker 轨道/元素，避免旧项目数据在渲染时崩溃。 */
function stripLegacyStickerData({
	tracks,
}: {
	tracks: SceneTracks;
}): SceneTracks {
	if (!tracks || typeof tracks !== "object") return tracks;

	const cleanElements = (elements: unknown): unknown =>
		Array.isArray(elements)
			? elements.filter(
					(element) =>
						!(element && (element as { type?: string }).type === "sticker"),
				)
			: elements;

	const cleanTrack = (track: unknown): unknown => {
		if (!track || typeof track !== "object") return track;
		return {
			...track,
			elements: cleanElements((track as { elements?: unknown }).elements),
		};
	};

	return {
		...tracks,
		overlay: Array.isArray(tracks.overlay)
			? (tracks.overlay
					.filter((track) => (track as { type?: string }).type !== "sticker")
					.map(cleanTrack) as OverlayTrack[])
			: tracks.overlay,
		audio: Array.isArray(tracks.audio)
			? (tracks.audio.map(cleanTrack) as AudioTrack[])
			: tracks.audio,
		main: cleanTrack(tracks.main) as VideoTrack,
	};
}

/** Recut 平台返回的 TProject（ISO 日期字符串）→ 本地 Date 形态。 */
export function normalizeRecutProject(raw: any): TProject {
	const scenes: TScene[] = (raw.scenes ?? []).map((scene: any) => ({
		id: scene.id,
		name: scene.name,
		isMain: scene.isMain,
		tracks: stripLegacyStickerData({ tracks: scene.tracks }),
		bookmarks: normalizeBookmarks({ raw: scene.bookmarks }),
		createdAt: toDate(scene.createdAt),
		updatedAt: toDate(scene.updatedAt),
	}));
	return {
		metadata: {
			id: raw.metadata.id,
			name: raw.metadata.name,
			thumbnail: raw.metadata.thumbnail ?? null,
			duration: roundMediaTime({
				time:
					raw.metadata.duration ??
					getProjectDurationFromScenes({ scenes }),
			}),
			createdAt: toDate(raw.metadata.createdAt),
			updatedAt: toDate(raw.metadata.updatedAt),
		},
		scenes,
		currentSceneId: raw.currentSceneId ?? scenes[0]?.id ?? "",
		settings: raw.settings,
		version: raw.version ?? 1,
		timelineViewState: raw.timelineViewState,
	};
}

class StorageService {
	private projectsAdapter: IndexedDBAdapter<SerializedProject>;
	private savedSoundsAdapter: IndexedDBAdapter<SavedSoundsData>;
	private config: StorageConfig;
	private migrationsPromise: Promise<void> | null = null;
	// 同一 (projectId, assetId) 的 save/delete 串行化：引用计数是读-改-写，
	// 并发调用（如启动时多处 loadProjectMedia）不能各自读旧值再加计数。
	private mediaLocks = new Map<string, Promise<unknown>>();

	private withMediaLock<T>(key: string, task: () => Promise<T>): Promise<T> {
		const previous = this.mediaLocks.get(key) ?? Promise.resolve();
		const next = previous.then(task, task);
		const tail = next.then(
			() => undefined,
			() => undefined,
		);
		this.mediaLocks.set(key, tail);
		void tail.then(() => {
			if (this.mediaLocks.get(key) === tail) {
				this.mediaLocks.delete(key);
			}
		});
		return next;
	}

	constructor() {
		this.config = {
			projectsDb: "video-editor-projects",
			mediaDb: "video-editor-media",
			savedSoundsDb: "video-editor-saved-sounds",
			version: 1,
		};

		this.projectsAdapter = new IndexedDBAdapter<SerializedProject>({
			dbName: this.config.projectsDb,
			storeName: "projects",
			version: this.config.version,
		});

		this.savedSoundsAdapter = new IndexedDBAdapter<SavedSoundsData>({
			dbName: this.config.savedSoundsDb,
			storeName: "saved-sounds",
			version: this.config.version,
		});
	}

	private async ensureMigrations(): Promise<void> {
		if (this.migrationsPromise) {
			await this.migrationsPromise;
			return;
		}

		this.migrationsPromise = runStorageMigrations({ migrations }).then(
			() => undefined,
		);
		await this.migrationsPromise;
	}

	private getProjectMediaAdapters({ projectId }: { projectId: string }) {
		const mediaMetadataAdapter = new IndexedDBAdapter<MediaAssetData>({
			dbName: `${this.config.mediaDb}-${projectId}`,
			storeName: "media-metadata",
			version: this.config.version,
		});

		return { mediaMetadataAdapter };
	}

	async canStoreFile({
		size,
	}: {
		size: number;
	}): Promise<StorageCapacityCheckResult> {
		const quotaStatus = await readStorageQuotaStatus();
		return evaluateStorageCapacity({
			requiredBytes: size,
			quotaStatus,
		});
	}

	isQuotaExceededError({ error }: { error: unknown }): boolean {
		return isStorageQuotaExceededError({ error });
	}

	private stripAudioBuffers({ tracks }: { tracks: SceneTracks }): SceneTracks {
		return {
			...tracks,
			audio: tracks.audio.map((track) => ({
				...track,
				elements: track.elements.map((element) => {
					const { buffer: _buffer, ...rest } = element;
					return rest;
				}),
			})),
		};
	}

	async saveProject({ project }: { project: TProject }): Promise<void> {
		if (isDemoMode()) {
			return;
		}
		const duration =
			project.metadata.duration ??
			getProjectDurationFromScenes({ scenes: project.scenes });
		const serializedScenes: SerializedScene[] = project.scenes.map((scene) => ({
			id: scene.id,
			name: scene.name,
			isMain: scene.isMain,
			tracks: this.stripAudioBuffers({ tracks: scene.tracks }),
			bookmarks: scene.bookmarks,
			createdAt: scene.createdAt.toISOString(),
			updatedAt: scene.updatedAt.toISOString(),
		}));

		const serializedProject: SerializedProject = {
			metadata: {
				id: project.metadata.id,
				name: project.metadata.name,
				thumbnail: project.metadata.thumbnail,
				duration,
				createdAt: project.metadata.createdAt.toISOString(),
				updatedAt: project.metadata.updatedAt.toISOString(),
			},
			scenes: serializedScenes,
			currentSceneId: project.currentSceneId,
			settings: project.settings,
			version: project.version,
			timelineViewState: project.timelineViewState,
		};

		// Recut 平台持久化（替代 IndexedDB）
		try {
			await recut.background.call("project.save", {
				project: serializedProject,
			});
			return;
		} catch (error) {
			console.warn(
				"[storage] Recut project.save failed, falling back to local IndexedDB:",
				error,
			);
		}

		await this.projectsAdapter.set({
			key: project.metadata.id,
			value: serializedProject,
		});
	}

	async loadProject({
		id,
	}: {
		id: string;
	}): Promise<{ project: TProject } | null> {
		if (isDemoMode() && demoProject) {
			return { project: demoProject };
		}
		// Recut 平台加载（替代 IndexedDB）
		try {
			const result = await recut.background.call("project.load", {});
			const raw = result?.project;
			if (raw && typeof raw === "object" && raw.metadata) {
				const project = normalizeRecutProject(raw);
				void syncTimelineComponents(project);
				return { project };
			}
		} catch (error) {
			console.warn(
				"[storage] Recut project.load failed, falling back to local IndexedDB:",
				error,
			);
		}

		await this.ensureMigrations();
		const serializedProject = await this.projectsAdapter.get(id);

		if (!serializedProject) return null;

		if (
			typeof serializedProject !== "object" ||
			serializedProject === null ||
			typeof serializedProject.metadata !== "object" ||
			serializedProject.metadata === null
		) {
			console.warn(
				"[storage] Skipping malformed project entry (missing metadata):",
				{ id, entry: serializedProject },
			);
			return null;
		}

		const scenes =
			serializedProject.scenes?.map((scene) => ({
				id: scene.id,
				name: scene.name,
				isMain: scene.isMain,
				tracks: stripLegacyStickerData({ tracks: scene.tracks }),
				bookmarks: normalizeBookmarks({ raw: scene.bookmarks }),
				createdAt: new Date(scene.createdAt),
				updatedAt: new Date(scene.updatedAt),
			})) ?? [];

		const project: TProject = {
			metadata: {
				id: serializedProject.metadata.id,
				name: serializedProject.metadata.name,
				thumbnail: serializedProject.metadata.thumbnail,
				duration: roundMediaTime({
					time:
						serializedProject.metadata.duration ??
						getProjectDurationFromScenes({ scenes }),
				}),
				createdAt: new Date(serializedProject.metadata.createdAt),
				updatedAt: new Date(serializedProject.metadata.updatedAt),
			},
			scenes,
			currentSceneId: serializedProject.currentSceneId || "",
			settings: serializedProject.settings,
			version: serializedProject.version,
			timelineViewState: serializedProject.timelineViewState,
		};

		void syncTimelineComponents(project);
		return { project };
	}

	async loadAllProjects(): Promise<TProject[]> {
		const projectIds = await this.projectsAdapter.list();
		const projects: TProject[] = [];

		for (const id of projectIds) {
			const result = await this.loadProject({ id });
			if (result?.project) {
				projects.push(result.project);
			}
		}

		return projects.sort(
			(a, b) => b.metadata.updatedAt.getTime() - a.metadata.updatedAt.getTime(),
		);
	}

	async loadAllProjectsMetadata(): Promise<TProjectMetadata[]> {
		await this.ensureMigrations();
		const serializedProjects = await this.projectsAdapter.getAll();

		const metadata: TProjectMetadata[] = [];
		for (const serializedProject of serializedProjects) {
			if (
				typeof serializedProject !== "object" ||
				serializedProject === null ||
				typeof serializedProject.metadata !== "object" ||
				serializedProject.metadata === null
			) {
				console.warn(
					"[storage] Skipping malformed project entry (missing metadata):",
					serializedProject,
				);
				continue;
			}

			metadata.push({
				id: serializedProject.metadata.id,
				name: serializedProject.metadata.name,
				thumbnail: serializedProject.metadata.thumbnail,
				duration: roundMediaTime({
					time:
						serializedProject.metadata.duration ??
						getProjectDurationFromScenes({
							scenes: (serializedProject.scenes ?? []) as unknown as TScene[],
						}),
				}),
				createdAt: new Date(serializedProject.metadata.createdAt),
				updatedAt: new Date(serializedProject.metadata.updatedAt),
			});
		}

		return metadata.sort(
			(a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
		);
	}

	async deleteProject({ id }: { id: string }): Promise<void> {
		await this.projectsAdapter.remove(id);
	}

	async saveMediaAsset({
		projectId,
		mediaAsset,
	}: {
		projectId: string;
		mediaAsset: MediaAsset;
	}): Promise<void> {
		return this.withMediaLock(`${projectId}:${mediaAsset.id}`, () =>
			this.persistMediaAsset({ projectId, mediaAsset }),
		);
	}

	private async persistMediaAsset({
		projectId,
		mediaAsset,
	}: {
		projectId: string;
		mediaAsset: MediaAsset;
	}): Promise<void> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({ projectId });

		const contentHash = mediaAsset.contentHash;
		if (!contentHash) {
			throw new Error(
				"media asset is missing contentHash; upload it to the Recut service first",
			);
		}

		const fileBytes =
			mediaAsset.file && mediaAsset.file.size > 0 ? mediaAsset.file : undefined;
		const size = mediaAsset.sizeBytes ?? fileBytes?.size ?? mediaAsset.file?.size ?? 0;
		const mimeType = mediaAsset.mimeType ?? mediaAsset.file?.type ?? undefined;

		const existing = await mediaMetadataAdapter.get(mediaAsset.id);
		const hashChanged = Boolean(existing?.contentHash && existing.contentHash !== contentHash);
		const entry = await mediaContentCache.getEntry(contentHash);
		// 已有内容索引且是本项目同 hash 的引用时不重复计数；否则视为新增引用。
		const needsRetain =
			!existing || existing.contentHash !== contentHash || !entry;

		if (needsRetain) {
			// 内容按 hash 全局去重：字节缺失或首次落盘时才写；已有字节直接复用。
			if (fileBytes && !(await mediaContentCache.has(contentHash))) {
				await mediaContentCache.store({
					hash: contentHash,
					file: fileBytes,
					size,
					mimeType,
				});
			} else if (!entry) {
				// 没有字节可写且没有索引：可能是下载路径先 store 过，这里只确保索引存在。
				await mediaContentCache.store({
					hash: contentHash,
					size,
					mimeType,
				});
			}
			await mediaContentCache.retain({ hash: contentHash, size, mimeType });
		}

		try {
			await mediaMetadataAdapter.set({
				key: mediaAsset.id,
				value: {
					id: mediaAsset.id,
					name: mediaAsset.name,
					type: mediaAsset.type,
					size,
					lastModified: mediaAsset.file?.lastModified ?? Date.now(),
					width: mediaAsset.width,
					height: mediaAsset.height,
					duration: mediaAsset.duration,
					fps: mediaAsset.fps,
					hasAudio: mediaAsset.hasAudio,
					ephemeral: mediaAsset.ephemeral,
					thumbnailUrl: mediaAsset.thumbnailUrl,
					contentHash,
					mimeType,
				},
			});
		} catch (error) {
			if (needsRetain) {
				await mediaContentCache.release(contentHash).catch(() => undefined);
			}
			if (this.isQuotaExceededError({ error })) {
				throw new StorageQuotaExceededError({ requiredBytes: size });
			}
			throw error;
		}

		// 同一 assetId 内容被替换：元数据更新成功后再释放旧内容的引用。
		if (hashChanged && existing?.contentHash) {
			await mediaContentCache.release(existing.contentHash).catch(() => undefined);
		}
	}

	async loadMediaAsset({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<MediaAsset | null> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({ projectId });

		const metadata = await mediaMetadataAdapter.get(id);
		if (!metadata) return null;

		const file = metadata.contentHash
			? await mediaContentCache.resolveFile(metadata.contentHash, {
					name: metadata.name,
					mimeType: metadata.mimeType,
				})
			: null;
		if (!file) return null;

		return {
			id: metadata.id,
			name: metadata.name,
			type: metadata.type,
			file,
			url: URL.createObjectURL(file),
			width: metadata.width,
			height: metadata.height,
			duration: metadata.duration,
			fps: metadata.fps,
			hasAudio: metadata.hasAudio,
			thumbnailUrl: metadata.thumbnailUrl,
			ephemeral: metadata.ephemeral,
			status: "completed",
			contentHash: metadata.contentHash,
			mimeType: metadata.mimeType,
			sizeBytes: metadata.size,
		};
	}

	async loadAllMediaAssets({
		projectId,
	}: {
		projectId: string;
	}): Promise<MediaAsset[]> {
		if (isDemoMode()) {
			return demoAssets;
		}
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({
			projectId,
		});

		const mediaIds = await mediaMetadataAdapter.list();
		const mediaItems: MediaAsset[] = [];

		for (const id of mediaIds) {
			const item = await this.loadMediaAsset({ projectId, id });
			if (item) {
				mediaItems.push(item);
			}
		}

		return mediaItems;
	}

	/** 读取项目媒体元数据（不解析字节）；用于按 contentHash 做缓存命中/引用对账。 */
	async listMediaAssetMetadata({
		projectId,
	}: {
		projectId: string;
	}): Promise<MediaAssetData[]> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({ projectId });
		return mediaMetadataAdapter.getAll();
	}

	async deleteMediaAsset({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<void> {
		return this.withMediaLock(`${projectId}:${id}`, () =>
			this.persistDeleteMediaAsset({ projectId, id }),
		);
	}

	private async persistDeleteMediaAsset({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<void> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({ projectId });

		const metadata = await mediaMetadataAdapter.get(id);
		await mediaMetadataAdapter.remove(id);
		if (metadata?.contentHash) {
			await mediaContentCache.release(metadata.contentHash).catch(() => undefined);
		}
	}

	async deleteProjectMedia({
		projectId,
	}: {
		projectId: string;
	}): Promise<void> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({ projectId });

		const entries = await mediaMetadataAdapter.getAll();
		await mediaMetadataAdapter.clear();
		for (const entry of entries) {
			if (entry.contentHash) {
				await mediaContentCache.release(entry.contentHash).catch(() => undefined);
			}
		}
	}

	async clearAllData(): Promise<void> {
		await this.projectsAdapter.clear();
		// project-specific media and timelines cleaned up when projects are deleted
	}

	async getStorageInfo(): Promise<{
		projects: number;
		isOPFSSupported: boolean;
		isIndexedDBSupported: boolean;
	}> {
		const projectIds = await this.projectsAdapter.list();

		return {
			projects: projectIds.length,
			isOPFSSupported: this.isOPFSSupported(),
			isIndexedDBSupported: this.isIndexedDBSupported(),
		};
	}

	async getProjectStorageInfo({ projectId }: { projectId: string }): Promise<{
		mediaItems: number;
	}> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({
			projectId,
		});

		const mediaIds = await mediaMetadataAdapter.list();

		return {
			mediaItems: mediaIds.length,
		};
	}

	async loadSavedSounds(): Promise<SavedSoundsData> {
		try {
			const savedSoundsData = await this.savedSoundsAdapter.get("user-sounds");
			return (
				savedSoundsData || {
					sounds: [],
					lastModified: new Date().toISOString(),
				}
			);
		} catch (error) {
			console.error("Failed to load saved sounds:", error);
			return { sounds: [], lastModified: new Date().toISOString() };
		}
	}

	async saveSoundEffect({
		soundEffect,
	}: {
		soundEffect: SoundEffect;
	}): Promise<void> {
		try {
			const currentData = await this.loadSavedSounds();

			if (currentData.sounds.some((sound) => sound.id === soundEffect.id)) {
				return; // Already saved
			}

			const savedSound: SavedSound = {
				id: soundEffect.id,
				name: soundEffect.name,
				username: soundEffect.username,
				previewUrl: soundEffect.previewUrl,
				downloadUrl: soundEffect.downloadUrl,
				duration: soundEffect.duration,
				tags: soundEffect.tags,
				license: soundEffect.license,
				savedAt: new Date().toISOString(),
			};

			const updatedData: SavedSoundsData = {
				sounds: [...currentData.sounds, savedSound],
				lastModified: new Date().toISOString(),
			};

			await this.savedSoundsAdapter.set({
				key: "user-sounds",
				value: updatedData,
			});
		} catch (error) {
			console.error("Failed to save sound effect:", error);
			throw error;
		}
	}

	async removeSavedSound({ soundId }: { soundId: number }): Promise<void> {
		try {
			const currentData = await this.loadSavedSounds();

			const updatedData: SavedSoundsData = {
				sounds: currentData.sounds.filter((sound) => sound.id !== soundId),
				lastModified: new Date().toISOString(),
			};

			await this.savedSoundsAdapter.set({
				key: "user-sounds",
				value: updatedData,
			});
		} catch (error) {
			console.error("Failed to remove saved sound:", error);
			throw error;
		}
	}

	async isSoundSaved({ soundId }: { soundId: number }): Promise<boolean> {
		try {
			const currentData = await this.loadSavedSounds();
			return currentData.sounds.some((sound) => sound.id === soundId);
		} catch (error) {
			console.error("Failed to check if sound is saved:", error);
			return false;
		}
	}

	async clearSavedSounds(): Promise<void> {
		try {
			await this.savedSoundsAdapter.remove("user-sounds");
		} catch (error) {
			console.error("Failed to clear saved sounds:", error);
			throw error;
		}
	}

	isOPFSSupported(): boolean {
		return OPFSAdapter.isSupported();
	}

	isIndexedDBSupported(): boolean {
		return "indexedDB" in window;
	}

	isFullySupported(): boolean {
		return this.isIndexedDBSupported() && this.isOPFSSupported();
	}
}

export const storageService = new StorageService();
export { StorageService };
