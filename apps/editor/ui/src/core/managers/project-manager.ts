/**
 * [INPUT]: 依赖 EditorCore 的项目、时间线与播放状态，依赖 WorldRenderer 生成独立预览帧；demo 模式跳过浏览器持久化迁移。
 * [OUTPUT]: 对外提供 ProjectManager，负责项目生命周期、持久化、缩略图与导出状态；字体水合不阻塞项目可用性。
 * [POS]: core/managers 的项目真相源；首帧缩略图渲染必须与用户正在编辑的播放头隔离。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { EditorCore } from "@/core";
import type {
	TProject,
	TProjectMetadata,
	TProjectSortKey,
	TProjectSortOption,
	TProjectSettings,
	TTimelineViewState,
} from "@/project/types";
import type { ExportOptions, ExportResult, ExportState } from "@/export";
import {
	normalizeRecutProject,
	storageService,
} from "@/services/storage/service";
import { toast } from "sonner";
import { t, getRecutLocale } from "@/i18n";
import { generateUUID } from "@/utils/id";
import { UpdateProjectSettingsCommand } from "@/commands/project";
import { DEFAULT_BACKGROUND_COLOR } from "@/background/color";
import { DEFAULT_CANVAS_SIZE } from "@/canvas/sizes";
import { DEFAULT_FPS } from "@/fps/defaults";
import { buildDefaultScene, getProjectDurationFromScenes } from "@/timeline/scenes";
import { WorldRenderer } from "@/runtime";
import { buildWorld } from "@/runtime/build-world";
import { mediaTimeToSeconds } from "@/wasm";
import {
	CURRENT_PROJECT_VERSION,
	migrations,
	runStorageMigrations,
	type MigrationProgress,
} from "@/services/storage/migrations";
import { loadFontsBySource } from "@/fonts/google-fonts";
import { syncTimelineComponents } from "@/recut/components";
import { restoreLibraryAudioSourceUrls } from "@/audio-library/restore";
import { DEFAULTS } from "@/timeline/defaults";
import { getElementFontFamilies } from "@/timeline/element-utils";
import { getRaisedProjectFpsForImportedMedia } from "@/fps/utils";
import type { MediaAsset } from "@/media/types";
import { isDemoMode } from "@/demo/demo-store";

export interface MigrationState {
	isMigrating: boolean;
	fromVersion: number | null;
	toVersion: number | null;
	projectName: string | null;
}

export class ProjectManager {
	private active: TProject | null = null;
	private savedProjects: TProjectMetadata[] = [];
	private isLoading = true;
	private isInitialized = false;
	private invalidProjectIds = new Set<string>();
	private storageMigrationPromise: Promise<void> | null = null;
	private listeners = new Set<() => void>();
	private migrationState: MigrationState = {
		isMigrating: false,
		fromVersion: null,
		toVersion: null,
		projectName: null,
	};
	private exportState: ExportState = {
		isExporting: false,
		progress: 0,
		frameTimeMs: 0,
		result: null,
	};
	private exportCancelRequested = false;
	/** 常驻预览 renderer 由 PreviewCanvas 注入；封面只可复用它，绝不自行创建 context。 */
	private previewRenderer: WorldRenderer | null = null;

	constructor(private editor: EditorCore) {}

	private async ensureStorageMigrations(): Promise<void> {
		if (isDemoMode()) return;
		if (this.storageMigrationPromise) {
			await this.storageMigrationPromise;
			return;
		}

		this.storageMigrationPromise = (async () => {
			await runStorageMigrations({
				migrations,
				onProgress: (progress: MigrationProgress) => {
					this.migrationState = progress;
					this.notify();
				},
			});
		})();

		await this.storageMigrationPromise;
	}

	async createNewProject({ name }: { name: string }): Promise<string> {
		const mainScene = buildDefaultScene({ name: "Main scene", isMain: true });
		const newProject: TProject = {
			metadata: {
				id: generateUUID(),
				name,
				duration: getProjectDurationFromScenes({ scenes: [mainScene] }),
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			scenes: [mainScene],
			currentSceneId: mainScene.id,
			settings: {
				fps: DEFAULT_FPS,
				canvasSize: DEFAULT_CANVAS_SIZE,
				canvasSizeMode: "preset",
				lastCustomCanvasSize: null,
				originalCanvasSize: null,
				background: {
					type: "color",
					color: DEFAULT_BACKGROUND_COLOR,
				},
			},
			version: CURRENT_PROJECT_VERSION,
		};

		this.active = newProject;
		this.notify();

		this.editor.media.clearAllAssets();
		this.editor.scenes.initializeScenes({
			scenes: newProject.scenes,
			currentSceneId: newProject.currentSceneId,
		});

		try {
			await storageService.saveProject({ project: newProject });
			this.updateMetadata(newProject);

			return newProject.metadata.id;
		} catch (error) {
			toast.error(t(getRecutLocale(), "project.failedSaveNew"));
			throw error;
		}
	}

	async loadProject({ id }: { id: string }): Promise<void> {
		// 所有加载路径（包括 Agent 修改后的热重载）都先让 UI 脱离场景依赖。
		// 旧场景保留到新场景完整就绪，避免向 React 发布空场景这一非法中间状态。
		this.isLoading = true;
		this.notify();

		this.editor.save.pause();
		await this.ensureStorageMigrations();
		this.editor.media.clearAllAssets();

		try {
			const result = await storageService.loadProject({ id });
			if (!result) {
				throw new Error(`Project with id ${id} not found`);
			}

			const project = result.project;

			// 恢复内部缓存音频（音频库下载）的可播放 sourceUrl。
			await restoreLibraryAudioSourceUrls({ scenes: project.scenes ?? [] });

			this.active = project;
			this.editor.scenes.initializeScenes({
				scenes: project.scenes ?? [],
				currentSceneId: project.currentSceneId,
			});
			this.notify();

			await this.editor.media.loadProjectMedia({ projectId: id });

			const fontFamilies = [
				...new Set(
					(project.scenes ?? []).flatMap((scene) =>
						getElementFontFamilies({ tracks: scene.tracks }),
					),
				),
			];
			void this.loadProjectFonts({ families: fontFamilies }).catch((error) => {
				console.warn("[project] font hydration deferred:", error);
			});
			if (!project.metadata.thumbnail) {
				try {
					const didUpdateThumbnail = await this.updateThumbnailFromTimeline();
					if (didUpdateThumbnail) {
						await this.saveCurrentProject();
					}
				} catch (error) {
					console.error("Failed to generate project thumbnail:", error);
				}
			}
		} catch (error) {
			console.error("Failed to load project:", error);
			throw error;
		} finally {
			this.isLoading = false;
			this.notify();
			this.editor.save.resume();
		}
	}

	/**
	 * 按来源回灌项目用到的字体：system 家族跳过，upload 家族从 service 读字节
	 * 注册到 document.fonts，其余走自托管 Google 目录。service 不可达时退化为
	 * 仅加载 Google 家族（保持旧行为）。
	 */
	private async loadProjectFonts({
		families,
	}: {
		families: string[];
	}): Promise<void> {
		const { loadFontCatalog } = await import("@/fonts/service-catalog");
		const uploaded = new Map<string, string>();
		const catalog = await loadFontCatalog();
		if (catalog) {
			for (const font of catalog.local) {
				uploaded.set(font.family, font.id);
			}
		}
		const needsSource = families.filter((family) => !uploaded.has(family));
		if (needsSource.length > 0) {
			await loadFontsBySource({ families: needsSource, uploaded });
		}
	}

	async saveCurrentProject(): Promise<void> {
		if (!this.active) return;

		try {
			const scenes = this.editor.scenes.getScenes();
			const updatedProject = {
				...this.active,
				scenes,
				metadata: {
					...this.active.metadata,
					duration: getProjectDurationFromScenes({ scenes }),
					updatedAt: new Date(),
				},
			};

			await storageService.saveProject({ project: updatedProject });
			this.active = updatedProject;
			this.updateMetadata(updatedProject);
		} catch (error) {
			console.error("Failed to save project:", error);
		}
	}

	async export({ options }: { options: ExportOptions }): Promise<ExportResult> {
		this.exportCancelRequested = false;
		this.exportState = { isExporting: true, progress: 0, frameTimeMs: 0, result: null };
		this.notify();

		const result = await this.editor.renderer.exportProject({
			options,
			onProgress: ({ progress, frameTimeMs }) => {
				this.exportState = {
					...this.exportState,
					progress,
					frameTimeMs: frameTimeMs ?? this.exportState.frameTimeMs,
				};
				this.notify();
			},
			onCancel: () => this.exportCancelRequested,
		});

		this.exportState = {
			isExporting: false,
			progress: this.exportState.progress,
			frameTimeMs: this.exportState.frameTimeMs,
			result,
		};
		this.notify();

		return result;
	}

	cancelExport(): void {
		this.exportCancelRequested = true;
	}

	clearExportState(): void {
		this.exportState = { isExporting: false, progress: 0, frameTimeMs: 0, result: null };
		this.notify();
	}

	getExportState(): ExportState {
		return this.exportState;
	}

	async loadAllProjects(): Promise<void> {
		if (!this.isInitialized) {
			this.isLoading = true;
			this.notify();
		}

		try {
			await this.ensureStorageMigrations();
			try {
				const metadata = await storageService.loadAllProjectsMetadata();
				this.savedProjects = metadata;
				this.notify();
			} catch (error) {
				console.error("Failed to load projects:", error);
			} finally {
				this.isLoading = false;
				this.isInitialized = true;
				this.notify();
			}
		} catch (error) {
			console.error("Failed to run migrations:", error);
			this.isLoading = false;
			this.isInitialized = true;
			this.notify();
		}
	}

	async deleteProjects({ ids }: { ids: string[] }): Promise<void> {
		const uniqueIds = Array.from(new Set(ids));
		if (uniqueIds.length === 0) return;

		try {
			await Promise.all(
				uniqueIds.map((id) =>
					Promise.all([
						storageService.deleteProjectMedia({ projectId: id }),
						storageService.deleteProject({ id }),
					]),
				),
			);

			const idSet = new Set(uniqueIds);
			this.savedProjects = this.savedProjects.filter(
				(project) => !idSet.has(project.id),
			);

			const shouldClearActive =
				this.active && idSet.has(this.active.metadata.id);

			if (shouldClearActive) {
				this.active = null;
				this.editor.media.clearAllAssets();
				this.editor.scenes.clearScenes();
			}

			this.notify();
		} catch (error) {
			console.error("Failed to delete projects:", error);
		}
	}

	closeProject(): void {
		this.active = null;
		this.notify();

		this.editor.media.clearAllAssets();
		this.editor.scenes.clearScenes();
	}

	async renameProject({
		id,
		name,
	}: {
		id: string;
		name: string;
	}): Promise<void> {
		try {
			const result = await storageService.loadProject({ id });
			if (!result) {
				toast.error(t(getRecutLocale(), "project.notFound"), {
					description: t(getRecutLocale(), "common.tryAgain"),
				});
				return;
			}

			const updatedProject: TProject = {
				...result.project,
				metadata: {
					...result.project.metadata,
					name,
					updatedAt: new Date(),
				},
			};

			await storageService.saveProject({ project: updatedProject });

			if (this.active?.metadata.id === id) {
				this.active = updatedProject;
				this.notify();
			}

			this.updateMetadata(updatedProject);
		} catch (error) {
			console.error("Failed to rename project:", error);
			toast.error(t(getRecutLocale(), "project.failedRename"), {
				description:
					error instanceof Error ? error.message : t(getRecutLocale(), "common.tryAgain"),
			});
		}
	}

	async duplicateProjects({ ids }: { ids: string[] }): Promise<string[]> {
		const uniqueIds = Array.from(new Set(ids));
		if (uniqueIds.length === 0) return [];

		try {
			const getDuplicateBaseName = ({ name }: { name: string }) => {
				const match = name.match(/^\((\d+)\)\s+(.+)$/);
				const number = match ? Number.parseInt(match[1], 10) : null;
				const baseName = match ? match[2] : name;
				return { baseName, number };
			};

			const loadResults = await Promise.all(
				uniqueIds.map(async (projectId) => {
					const result = await storageService.loadProject({ id: projectId });
					return { projectId, project: result?.project ?? null };
				}),
			);

			const missingProjectIds = loadResults
				.filter((result) => !result.project)
				.map((result) => result.projectId);

			if (missingProjectIds.length > 0) {
				toast.error(
					missingProjectIds.length === 1
						? t(getRecutLocale(), "project.notFound")
						: t(getRecutLocale(), "project.notFoundMany"),
					{
						description:
							missingProjectIds.length === 1
								? t(getRecutLocale(), "common.tryAgain")
								: t(getRecutLocale(), "project.someNotFound"),
					},
				);
				throw new Error(`Projects not found: ${missingProjectIds.join(", ")}`);
			}

			const projectsToDuplicate = loadResults.flatMap((result) =>
				result.project ? [result.project] : [],
			);

			const maxNumberByBaseName = new Map<string, number>();

			for (const project of this.savedProjects) {
				const { baseName, number } = getDuplicateBaseName({
					name: project.name,
				});

				if (number === null) continue;

				const currentMax = maxNumberByBaseName.get(baseName);
				if (currentMax === undefined || number > currentMax) {
					maxNumberByBaseName.set(baseName, number);
				}
			}

			const nextNumberByBaseName = new Map<string, number>();
			for (const [baseName, maxNumber] of maxNumberByBaseName) {
				nextNumberByBaseName.set(baseName, maxNumber + 1);
			}

			const duplicationPlans = projectsToDuplicate.map((project) => {
				const { baseName } = getDuplicateBaseName({
					name: project.metadata.name,
				});
				const nextNumber = nextNumberByBaseName.get(baseName) ?? 1;
				nextNumberByBaseName.set(baseName, nextNumber + 1);

				const newProjectId = generateUUID();
				const newProject: TProject = {
					...project,
					metadata: {
						...project.metadata,
						id: newProjectId,
						name: `(${nextNumber}) ${baseName}`,
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				};

				return {
					newProjectId,
					newProject,
					sourceProjectId: project.metadata.id,
				};
			});

			await Promise.all(
				duplicationPlans.map(({ newProject }) =>
					storageService.saveProject({ project: newProject }),
				),
			);

			await Promise.all(
				duplicationPlans.map(async ({ sourceProjectId, newProjectId }) => {
					const sourceMediaAssets = await storageService.loadAllMediaAssets({
						projectId: sourceProjectId,
					});

					await Promise.all(
						sourceMediaAssets.map((mediaAsset) =>
							storageService.saveMediaAsset({
								projectId: newProjectId,
								mediaAsset,
							}),
						),
					);
				}),
			);

			for (const { newProject } of duplicationPlans) {
				this.updateMetadata(newProject);
			}

			return duplicationPlans.map((plan) => plan.newProjectId);
		} catch (error) {
			console.error("Failed to duplicate projects:", error);
			toast.error(t(getRecutLocale(), "project.failedDuplicate"), {
				description:
					error instanceof Error
						? error.message
						: t(getRecutLocale(), "common.tryAgain"),
			});
			throw error;
		}
	}

	async updateSettings({
		settings,
		pushHistory = true,
	}: {
		settings: Partial<TProjectSettings>;
		pushHistory?: boolean;
	}): Promise<void> {
		if (!this.active) return;

		const command = new UpdateProjectSettingsCommand(settings);
		if (pushHistory) {
			this.editor.command.execute({ command });
			return;
		}

		command.execute();
	}

	ratchetFpsForImportedMedia({
		importedAssets,
	}: {
		importedAssets: Array<Pick<MediaAsset, "type" | "fps">>;
	}): import("opencut-wasm").FrameRate | null {
		if (!this.active) return null;

		const nextFps = getRaisedProjectFpsForImportedMedia({
			currentFps: this.active.settings.fps,
			importedAssets,
		});
		if (nextFps === null) return null;

		new UpdateProjectSettingsCommand({ fps: nextFps }).execute();
		return nextFps;
	}

	async updateThumbnail({ thumbnail }: { thumbnail: string }): Promise<void> {
		if (!this.active) return;

		const updatedProject: TProject = {
			...this.active,
			metadata: { ...this.active.metadata, thumbnail, updatedAt: new Date() },
		};
		this.active = updatedProject;
		this.notify();
		this.updateMetadata(updatedProject);
		this.editor.save.markDirty();
	}

	async prepareExit(): Promise<void> {
		if (!this.active) return;

		try {
			const didUpdateThumbnail = await this.updateThumbnailFromTimeline();
			if (didUpdateThumbnail) {
				await this.editor.save.flush();
			}
		} catch (error) {
			console.error("Failed to generate project thumbnail on exit:", error);
		}
	}

	getFilteredAndSortedProjects({
		searchQuery,
		sortOption,
	}: {
		searchQuery: string;
		sortOption: TProjectSortOption;
	}): TProjectMetadata[] {
		const filteredProjects = this.savedProjects.filter((project) =>
			project.name.toLowerCase().includes(searchQuery.toLowerCase()),
		);

		const [key, order] = sortOption.split("-") as [
			TProjectSortKey,
			"asc" | "desc",
		];

		const sortedProjects = [...filteredProjects].sort((a, b) => {
			const aValue = a[key];
			const bValue = b[key];

			if (order === "asc") {
				if (aValue < bValue) return -1;
				if (aValue > bValue) return 1;
				return 0;
			}
			if (aValue > bValue) return -1;
			if (aValue < bValue) return 1;
			return 0;
		});

		return sortedProjects;
	}

	isInvalidProjectId({ id }: { id: string }): boolean {
		return this.invalidProjectIds.has(id);
	}

	markProjectIdAsInvalid({ id }: { id: string }): void {
		this.invalidProjectIds.add(id);
		this.notify();
	}

	clearInvalidProjectIds(): void {
		this.invalidProjectIds.clear();
		this.notify();
	}

	getActive(): TProject {
		if (!this.active) {
			throw new Error("No active project");
		}
		return this.active;
	}

	/**
	 * for agents:
	 * in most cases, the project is guaranteed to be active, in which getActive() should be used instead.
	 * for very rare cases, this function may be used.
	 */
	getActiveOrNull(): TProject | null {
		return this.active;
	}

	getTimelineViewState(): TTimelineViewState {
		return this.active?.timelineViewState ?? DEFAULTS.timeline.viewState;
	}

	setTimelineViewState({ viewState }: { viewState: TTimelineViewState }): void {
		if (!this.active) return;
		this.active = {
			...this.active,
			timelineViewState: viewState ?? undefined,
		};
		this.editor.save.markDirty();
		this.notify();
	}

	getSavedProjects(): TProjectMetadata[] {
		return this.savedProjects;
	}

	getIsLoading(): boolean {
		return this.isLoading;
	}

	getIsInitialized(): boolean {
		return this.isInitialized;
	}

	getMigrationState(): MigrationState {
		return this.migrationState;
	}

	setActiveProject({ project }: { project: TProject }): void {
		this.active = project;
		this.notify();
	}

	/**
	 * 应用 Host 推送的最新文档快照。这个路径只替换文档，不走完整 loadProject：
	 * 完整加载会清空媒体、触发 loading 状态并重置 UI，正是 AI 连续编辑时的刷新闪烁来源。
	 */
	async applyRemoteProject({
		rawProject,
		version,
	}: {
		rawProject: unknown;
		version?: number;
	}): Promise<void> {
		if (!rawProject || typeof rawProject !== "object") {
			throw new Error("remote project document is missing");
		}

		const previousTime = this.editor.playback.getCurrentTime();
		const previousSelection = this.editor.selection.getSnapshot();
		const project = normalizeRecutProject(rawProject);
		if (typeof version === "number" && Number.isFinite(version)) {
			project.version = version;
		}

		this.editor.save.pause();
		try {
			this.active = project;
			this.editor.scenes.initializeScenes({
				scenes: project.scenes,
				currentSceneId: project.currentSceneId,
			});
			this.notify();
			// 媒体是可重建缓存；异步更新清单，不阻塞画面先显示新的时间线。
			void this.editor.media.loadProjectMedia({
				projectId: project.metadata.id,
			}).catch((error) => {
				console.warn("[project] remote media refresh deferred:", error);
			});
			void syncTimelineComponents(project);
		} finally {
			this.editor.save.resume();
		}

		this.editor.playback.seek({ time: previousTime });
		this.editor.selection.restoreSnapshot({ snapshot: previousSelection });
	}

	/**
	 * RFC applyRemoteOperations：UI 不重放 background applyOp。
	 * Host 已把 operations fold 进 document 快照；这里应用快照并保留播放头/选区。
	 * 无 document 时返回 ok:false，由同步层走 timeline.delta 或 loadProject。
	 */
	async applyRemoteOperations({
		document,
		version,
		toVersion,
	}: {
		operations?: unknown[];
		document?: unknown;
		version?: number;
		fromVersion?: number;
		toVersion?: number;
	}): Promise<{ ok: boolean }> {
		if (!document || typeof document !== "object") return { ok: false };
		await this.applyRemoteProject({
			rawProject: document,
			version: toVersion ?? version,
		});
		return { ok: true };
	}

	getAppliedVersion(): number {
		return this.active?.version ?? 0;
	}

	setPreviewRenderer(renderer: WorldRenderer | null): void {
		this.previewRenderer = renderer;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private async updateThumbnailFromTimeline(): Promise<boolean> {
		const thumbnailDataUrl = await this.renderFirstFrameDataUrl();
		if (!thumbnailDataUrl) return false;
		await this.updateThumbnail({ thumbnail: thumbnailDataUrl });
		return true;
	}

	/**
	 * 渲染时间线首帧（t=0）为 PNG data URL。供本地缩略图与平台自动封面复用。
	 *
	 * 实现：始终复用常驻 preview renderer 的隔离 render-target pass。它不暂停、seek
	 * 或替换用户正在看的场景，也绝不创建第二个 WebGL context。
	 */
	async renderFirstFrameDataUrl(): Promise<string | null> {
		return this.renderFrameDataUrl({ time: 0 });
	}

	/**
	 * 渲染时间线任意时刻（秒）为 PNG data URL。供封面帧选择器预览与手动封面使用。
	 * 与 renderFirstFrameDataUrl 共用同一常驻 preview renderer 隔离 pass。
	 */
	async renderFrameDataUrl({ time }: { time: number }): Promise<string | null> {
		if (!this.active || !this.previewRenderer) return null;

		// AI 组件异步加载：先 await 再渲染，避免抓到空占位。
		await syncTimelineComponents(this.active);

		const world = this.buildFirstFrameWorld();
		return world
			? this.previewRenderer.captureFrameDataUrl({ world, time })
			: null;
	}

	private buildFirstFrameWorld(): import("@/runtime/types").World | null {
		const scene = this.editor.scenes.getActiveSceneOrNull();
		if (!scene || !this.active) return null;
		const mediaAssets = this.editor.media.getAssets();
		const duration = this.editor.timeline.getTotalDuration();
		const { canvasSize, background, fps } = this.active.settings;

		const world = buildWorld({
			scene,
			mediaAssets,
			canvasSize,
			fps: fps.numerator / fps.denominator,
			duration: mediaTimeToSeconds({
				time: duration || (1 as import("@/wasm").MediaTime),
			}),
			background,
		});
		world.isPreview = true;
		return world;
	}

	private updateMetadata(project: TProject): void {
		const index = this.savedProjects.findIndex(
			(p) => p.id === project.metadata.id,
		);

		if (index !== -1) {
			this.savedProjects = this.savedProjects.with(index, project.metadata);
		} else {
			this.savedProjects = [project.metadata, ...this.savedProjects];
		}

		this.notify();
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}
}
