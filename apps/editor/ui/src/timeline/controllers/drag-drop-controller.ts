import type { DragEvent } from "react";
import { toast } from "sonner";
import { t, getRecutLocale } from "@/i18n";
import { processMediaAssets } from "@/media/processing";
import { showMediaUploadToast } from "@/media/upload-toast";
import {
	DEFAULT_NEW_ELEMENT_DURATION,
	toElementDurationTicks,
} from "@/timeline/creation";
import { BASE_TIMELINE_PIXELS_PER_SECOND } from "@/timeline/scale";
import type { FrameRate } from "opencut-wasm";
import {
	buildTextElement,
	buildGraphicElement,
	buildElementFromMedia,
	buildEffectElement,
} from "@/timeline/element-utils";
import { AddTrackCommand, InsertElementCommand } from "@/commands/timeline";
import { BatchCommand } from "@/commands";
import type { Command } from "@/commands/base-command";
import { computeDropTarget } from "@/timeline/components/drop-target";
import { getTimelineDisplayTracks } from "@/timeline/components/track-layout";
import type { TimelineDragSource } from "@/timeline/drag-source";
import type {
	TrackType,
	DropTarget,
	ElementType,
	SceneTracks,
	TimelineTrack,
	CreateTimelineElement,
} from "@/timeline";
import type { TimelineDragData } from "@/timeline/drag";
import type { MediaAsset } from "@/media/types";
import type { ProcessedMediaAsset } from "@/media/processing";
import { roundFrameTime, type MediaTime } from "@/wasm";
import { parseSubtitleFile } from "@/subtitles/parse";
import { insertCaptionChunksAsTextTrack } from "@/subtitles/insert";
import { EditorCore } from "@/core";

const SUBTITLE_EXTENSIONS = new Set(["srt", "ass"]);

function isSubtitleFileName(file: File): boolean {
	const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
	return SUBTITLE_EXTENSIONS.has(extension);
}

// --- Config ---

export interface DragDropConfig {
	zoomLevel: number;
	getContainerEl: () => HTMLDivElement | null;
	getHeaderEl: () => HTMLElement | null;
	getTracksScrollEl: () => HTMLDivElement | null;
	getActiveProjectFps: () => FrameRate | null;
	getActiveProjectId: () => string | null;
	getSceneTracks: () => SceneTracks;
	getCurrentPlayheadTime: () => MediaTime;
	getMediaAssets: () => MediaAsset[];
	dragSource: TimelineDragSource;
	addMediaAsset: (args: {
		projectId: string;
		asset: ProcessedMediaAsset;
	}) => Promise<MediaAsset | null>;
	executeCommand: (command: Command) => void;
	insertElement: (args: {
		placement: { mode: "explicit"; trackId: string };
		element: CreateTimelineElement;
	}) => void;
	addClipEffect: (args: {
		trackId: string;
		elementId: string;
		effectType: string;
	}) => void;
}

export interface DragDropConfigRef {
	readonly current: DragDropConfig;
}

// --- State ---

interface DragOverState {
	kind: "over";
	dropTarget: DropTarget | null;
	elementType: ElementType | null;
}

type DragDropState = { kind: "idle" } | DragOverState;

interface TimelineCoords {
	mouseX: number;
	mouseY: number;
}

// --- Pure helpers ---

function elementTypeFromDrag({
	dragData,
}: {
	dragData: TimelineDragData;
}): ElementType {
	switch (dragData.type) {
		case "text":
			return "text";
		case "graphic":
			return "graphic";
		case "effect":
			return "effect";
		case "media":
			return dragData.mediaType;
	}
}

function getTargetElementTypesForDrag({
	dragData,
}: {
	dragData: TimelineDragData;
}): string[] | undefined {
	if (dragData.type === "effect") return dragData.targetElementTypes;
	if (dragData.type === "media") return dragData.targetElementTypes;
	return undefined;
}

function getDurationForDrag({
	dragData,
	mediaAssets,
}: {
	dragData: TimelineDragData;
	mediaAssets: MediaAsset[];
}): MediaTime {
	if (dragData.type !== "media") return DEFAULT_NEW_ELEMENT_DURATION;
	const media = mediaAssets.find((asset) => asset.id === dragData.id);
	return toElementDurationTicks({ seconds: media?.duration });
}

function orderedTracks({
	sceneTracks,
}: {
	sceneTracks: SceneTracks;
}): TimelineTrack[] {
	return getTimelineDisplayTracks({ tracks: sceneTracks });
}

// --- Controller ---

export class DragDropController {
	private state: DragDropState = { kind: "idle" };
	private enterCount = 0;
	private readonly subscribers = new Set<() => void>();
	private readonly configRef: DragDropConfigRef;

	constructor(deps: { configRef: DragDropConfigRef }) {
		this.configRef = deps.configRef;
		this.onDragEnter = this.onDragEnter.bind(this);
		this.onDragOver = this.onDragOver.bind(this);
		this.onDragLeave = this.onDragLeave.bind(this);
		this.onDrop = this.onDrop.bind(this);
	}

	private get config(): DragDropConfig {
		return this.configRef.current;
	}

	get isDragOver(): boolean {
		return this.state.kind !== "idle";
	}

	get dropTarget(): DropTarget | null {
		return this.state.kind === "over" ? this.state.dropTarget : null;
	}

	get dragElementType(): ElementType | null {
		return this.state.kind === "over" ? this.state.elementType : null;
	}

	subscribe(fn: () => void): () => void {
		this.subscribers.add(fn);
		return () => this.subscribers.delete(fn);
	}

	destroy(): void {
		this.subscribers.clear();
	}

	// --- Drag event handlers (bound, stable, passed as React props) ---

	onDragEnter(event: DragEvent): void {
		event.preventDefault();
		const hasAsset = this.config.dragSource.isActive();
		const hasFiles = event.dataTransfer.types.includes("Files");
		if (!hasAsset && !hasFiles) return;

		this.enterCount += 1;
		if (this.state.kind === "idle") {
			this.setOver({ dropTarget: null, elementType: null });
		}
	}

	onDragOver(event: DragEvent): void {
		event.preventDefault();

		const coords = this.getMouseTimelineCoords({ event });
		if (!coords) return;

		const dragData = this.config.dragSource.getActive();
		const hasFiles = event.dataTransfer.types.includes("Files");
		const isExternal = hasFiles && !dragData;

		if (!dragData) {
			if (hasFiles && isExternal) {
				const subtitleFiles = Array.from(
					event.dataTransfer.files ?? [],
				).filter(isSubtitleFileName);
				if (subtitleFiles.length > 0) {
					// 字幕文件拖放：显示文本落点定位线，落点为第一条 cue 起点。
					const target = computeDropTarget({
						elementType: "text",
						mouseX: coords.mouseX,
						mouseY: coords.mouseY,
						tracks: this.config.getSceneTracks(),
						playheadTime: this.config.getCurrentPlayheadTime(),
						isExternalDrop: true,
						elementDuration: DEFAULT_NEW_ELEMENT_DURATION,
						pixelsPerSecond: BASE_TIMELINE_PIXELS_PER_SECOND,
						zoomLevel: this.config.zoomLevel,
					});
					this.setOver({ dropTarget: target, elementType: "text" });
					event.dataTransfer.dropEffect = "copy";
					return;
				}
				this.setOver({ dropTarget: null, elementType: null });
			}
			return;
		}

		const elementType = elementTypeFromDrag({ dragData });
		const duration = getDurationForDrag({
			dragData,
			mediaAssets: this.config.getMediaAssets(),
		});
		const targetElementTypes = getTargetElementTypesForDrag({ dragData });

		const sceneTracks = this.config.getSceneTracks();
		const target = computeDropTarget({
			elementType,
			mouseX: coords.mouseX,
			mouseY: coords.mouseY,
			tracks: sceneTracks,
			playheadTime: this.config.getCurrentPlayheadTime(),
			isExternalDrop: isExternal,
			elementDuration: duration,
			pixelsPerSecond: BASE_TIMELINE_PIXELS_PER_SECOND,
			zoomLevel: this.config.zoomLevel,
			targetElementTypes,
		});

		const fps = this.config.getActiveProjectFps();
		target.xPosition = fps
			? roundFrameTime({ time: target.xPosition, fps })
			: target.xPosition;

		this.setOver({ dropTarget: target, elementType });
		event.dataTransfer.dropEffect = "copy";
	}

	onDragLeave(event: DragEvent): void {
		event.preventDefault();
		if (this.enterCount === 0) return;
		this.enterCount -= 1;
		if (this.enterCount === 0) {
			this.setIdle();
		}
	}

	onDrop(event: DragEvent): void {
		event.preventDefault();
		this.enterCount = 0;

		const dragData = this.config.dragSource.getActive();
		const hasFiles = event.dataTransfer.files?.length > 0;
		if (!dragData && !hasFiles) return;

		const currentTarget = this.dropTarget;
		this.setIdle();

		try {
			if (dragData) {
				if (!currentTarget) return;
				this.executeAssetDrop({ target: currentTarget, dragData });
				return;
			}

			const coords = this.getMouseTimelineCoords({ event });
			if (!coords) return;
			this.executeFileDrop({
				files: Array.from(event.dataTransfer.files),
				mouseX: coords.mouseX,
				mouseY: coords.mouseY,
			}).catch((error) => {
				console.error("Failed to process file drop:", error);
			});
		} catch (error) {
			console.error("Failed to process drop:", error);
		}
	}

	// --- Private ---

	private setOver(state: {
		dropTarget: DropTarget | null;
		elementType: ElementType | null;
	}): void {
		this.state = { kind: "over", ...state };
		this.notify();
	}

	private setIdle(): void {
		this.state = { kind: "idle" };
		this.notify();
	}

	private notify(): void {
		for (const fn of this.subscribers) fn();
	}

	private getMouseTimelineCoords({
		event,
	}: {
		event: DragEvent;
	}): TimelineCoords | null {
		const scrollContainer = this.config.getTracksScrollEl();
		const referenceRect =
			scrollContainer?.getBoundingClientRect() ??
			this.config.getContainerEl()?.getBoundingClientRect();
		if (!referenceRect) return null;

		const scrollLeft = scrollContainer?.scrollLeft ?? 0;
		const scrollTop = scrollContainer?.scrollTop ?? 0;
		const headerHeight =
			this.config.getHeaderEl()?.getBoundingClientRect().height ?? 0;

		return {
			mouseX: event.clientX - referenceRect.left + scrollLeft,
			mouseY: event.clientY - referenceRect.top + scrollTop - headerHeight,
		};
	}

	// Shared insertion logic — new track vs existing track.
	private insertAtTarget({
		element,
		target,
		trackType,
	}: {
		element: CreateTimelineElement;
		target: DropTarget;
		trackType: TrackType;
	}): void {
		if (target.isNewTrack) {
			const addTrackCmd = new AddTrackCommand({
				type: trackType,
				index: target.trackIndex,
			});
			this.config.executeCommand(
				new BatchCommand([
					addTrackCmd,
					new InsertElementCommand({
						element,
						placement: { mode: "explicit", trackId: addTrackCmd.getTrackId() },
					}),
				]),
			);
			return;
		}

		const tracks = orderedTracks({ sceneTracks: this.config.getSceneTracks() });
		const track = tracks[target.trackIndex];
		if (!track) return;
		this.config.insertElement({
			placement: { mode: "explicit", trackId: track.id },
			element,
		});
	}

	private executeAssetDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: TimelineDragData;
	}): void {
		switch (dragData.type) {
			case "text":
				this.executeTextDrop({ target, dragData });
				return;
			case "graphic":
				this.executeGraphicDrop({ target, dragData });
				return;
			case "effect":
				this.executeEffectDrop({ target, dragData });
				return;
			case "media":
				this.executeMediaDrop({ target, dragData });
				return;
		}
	}

	private executeTextDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "text" }>;
	}): void {
		const element = buildTextElement({
			raw: {
				name: dragData.name ?? "",
				params: { content: dragData.content ?? "" },
			},
			startTime: target.xPosition,
		});
		this.insertAtTarget({ element, target, trackType: "text" });
	}

	private executeGraphicDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "graphic" }>;
	}): void {
		const element = buildGraphicElement({
			definitionId: dragData.definitionId,
			name: dragData.name,
			startTime: target.xPosition,
			params: dragData.params,
		});
		this.insertAtTarget({ element, target, trackType: "graphic" });
	}

	private executeMediaDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "media" }>;
	}): void {
		if (target.targetElement) {
			// Replace media source — not yet implemented
			return;
		}

		const mediaAsset = this.config
			.getMediaAssets()
			.find((asset) => asset.id === dragData.id);
		if (!mediaAsset) return;

		const trackType: TrackType =
			dragData.mediaType === "audio" ? "audio" : "video";
		const element = buildElementFromMedia({
			mediaId: mediaAsset.id,
			mediaType: mediaAsset.type,
			name: mediaAsset.name,
			duration: toElementDurationTicks({ seconds: mediaAsset.duration }),
			startTime: target.xPosition,
		});
		this.insertAtTarget({ element, target, trackType });
	}

	private executeEffectDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "effect" }>;
	}): void {
		if (target.targetElement) {
			this.config.addClipEffect({
				trackId: target.targetElement.trackId,
				elementId: target.targetElement.elementId,
				effectType: dragData.effectType,
			});
			return;
		}

		const element = buildEffectElement({
			effectType: dragData.effectType,
			startTime: target.xPosition,
		});

		const existingEffectTrack = orderedTracks({
			sceneTracks: this.config.getSceneTracks(),
		}).find((track) => track.type === "effect");

		if (existingEffectTrack) {
			this.config.insertElement({
				placement: { mode: "explicit", trackId: existingEffectTrack.id },
				element,
			});
			return;
		}

		this.insertAtTarget({ element, target, trackType: "effect" });
	}

	private async executeFileDrop({
		files,
		mouseX,
		mouseY,
	}: {
		files: File[];
		mouseX: number;
		mouseY: number;
	}): Promise<void> {
		const projectId = this.config.getActiveProjectId();
		if (!projectId) return;

		const subtitleFiles = files.filter(isSubtitleFileName);
		const mediaFiles = files.filter((file) => !isSubtitleFileName(file));

		if (subtitleFiles.length > 0) {
			await this.executeSubtitleFileDrop({
				files: subtitleFiles,
				mouseX,
				mouseY,
			});
		}
		if (mediaFiles.length === 0) {
			return;
		}

		await showMediaUploadToast({
			filesCount: mediaFiles.length,
			promise: async () => {
				const processedAssets = await processMediaAssets({ files: mediaFiles });

				// Sequential on purpose: each iteration reads getSceneTracks()
				// to decide placement (reuse empty main vs new track) and that
				// decision depends on the effects of prior inserts.
				for (const asset of processedAssets) {
					const createdAsset = await this.config.addMediaAsset({
						projectId,
						asset,
					});
					if (!createdAsset) continue;

					const duration = toElementDurationTicks({
						seconds: createdAsset.duration,
					});

					const sceneTracks = this.config.getSceneTracks();
					const currentTime = this.config.getCurrentPlayheadTime();

					const reuseMainTrackId =
						createdAsset.type !== "audio" &&
						sceneTracks.overlay.length === 0 &&
						sceneTracks.audio.length === 0 &&
						sceneTracks.main.elements.length === 0
							? sceneTracks.main.id
							: null;

					if (reuseMainTrackId) {
						this.config.insertElement({
							placement: { mode: "explicit", trackId: reuseMainTrackId },
							element: buildElementFromMedia({
								mediaId: createdAsset.id,
								mediaType: createdAsset.type,
								name: createdAsset.name,
								duration,
								startTime: currentTime,
							}),
						});
						continue;
					}

					const dropTarget = computeDropTarget({
						elementType: createdAsset.type,
						mouseX,
						mouseY,
						tracks: sceneTracks,
						playheadTime: currentTime,
						isExternalDrop: true,
						elementDuration: duration,
						pixelsPerSecond: BASE_TIMELINE_PIXELS_PER_SECOND,
						zoomLevel: this.config.zoomLevel,
					});

					const trackType: TrackType =
						createdAsset.type === "audio" ? "audio" : "video";
					this.insertAtTarget({
						element: buildElementFromMedia({
							mediaId: createdAsset.id,
							mediaType: createdAsset.type,
							name: createdAsset.name,
							duration,
							startTime: dropTarget.xPosition,
						}),
						target: dropTarget,
						trackType,
					});
				}

				return {
					uploadedCount: processedAssets.length,
					assetNames: processedAssets.map((asset) => asset.name),
				};
			},
		});
	}

	/** 把拖入的 SRT/ASS 直接铺成字幕轨（每条 cue 独立 text 元素）。 */
	private async executeSubtitleFileDrop({
		files,
		mouseX,
		mouseY,
	}: {
		files: File[];
		mouseX: number;
		mouseY: number;
	}): Promise<void> {
		const currentTime = this.config.getCurrentPlayheadTime();
		const dropTarget = computeDropTarget({
			elementType: "text",
			mouseX,
			mouseY,
			tracks: this.config.getSceneTracks(),
			playheadTime: currentTime,
			isExternalDrop: true,
			elementDuration: DEFAULT_NEW_ELEMENT_DURATION,
			pixelsPerSecond: BASE_TIMELINE_PIXELS_PER_SECOND,
			zoomLevel: this.config.zoomLevel,
		});
		const startOffsetTicks = dropTarget?.xPosition ?? currentTime;

		for (const file of files) {
			try {
				const input = await file.text();
				const result = parseSubtitleFile({ fileName: file.name, input });
				if (result.captions.length === 0) {
					toast.error(t(getRecutLocale(), "captions.noValidCuesFile", { name: file.name }));
					continue;
				}
				const extension = file.name.split(".").pop()?.toLowerCase();
				insertCaptionChunksAsTextTrack({
					editor: EditorCore.getInstance(),
					captions: result.captions,
					options: {
						startOffsetTicks,
						source: extension === "ass" ? "ass" : "srt",
					},
				});
			} catch (error) {
				console.error("Failed to import subtitle file:", file.name, error);
				toast.error(t(getRecutLocale(), "captions.importFailed", { name: file.name }));
			}
		}
	}
}
