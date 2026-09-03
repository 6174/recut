import type { EditorCore } from "@/core";
import type { ElementBounds } from "@/preview/element-bounds";
import type { ParamValues } from "@/params";
import type {
	SceneTracks,
	TrackType,
	TimelineTrack,
	TimelineElement,
	RetimeConfig,
} from "@/timeline";
import { calculateTotalDuration } from "@/timeline";
import { TimelineDragSource } from "@/timeline/drag-source";
import { findTrackInSceneTracks } from "@/timeline/track-element-update";
import { broadcastChangedSubtitleTracks } from "@/subtitles/shared-style";
import { lastFrameMediaTime, type MediaTime, ZERO_MEDIA_TIME } from "@/wasm";
import {
	canElementBeHidden,
	canElementHaveAudio,
} from "@/timeline/element-utils";
import { isElementMuted } from "@/timeline/audio-state";
import type {
	AnimationPath,
	AnimationInterpolation,
	ScalarCurveKeyframePatch,
} from "@/animation/types";
import type { ParamValue } from "@/params";
import {
	getElementLocalTime,
	hasKeyframesForPath,
	resolveAnimationPathValueAtTime,
	upsertPathKeyframe,
} from "@/animation";
import { NUMBER_CHANNEL_LAYOUT } from "@/params";
import { buildTransformFromParams, type Transform } from "@/rendering";
import { resolveAnimationTarget } from "@/timeline/animation-targets";
import { BatchCommand } from "@/commands";
import {
	AddTrackCommand,
	RemoveTrackCommand,
	ToggleTrackMuteCommand,
	ToggleTrackVisibilityCommand,
	InsertElementCommand,
	DeleteElementsCommand,
	DuplicateElementsCommand,
	UpdateElementsCommand,
	SplitElementsCommand,
	MoveElementCommand,
	TracksSnapshotCommand,
	UpsertKeyframeCommand,
	RemoveKeyframeCommand,
	RetimeKeyframeCommand,
	UpdateScalarKeyframeCurveCommand,
	AddClipEffectCommand,
	DeleteFreeformPathMaskPointsCommand,
	InsertFreeformPathMaskPointCommand,
	RemoveClipEffectCommand,
	UpdateClipEffectParamsCommand,
	ToggleClipEffectCommand,
	ReorderClipEffectsCommand,
	RemoveMaskCommand,
	ToggleMaskInvertedCommand,
	UpsertEffectParamKeyframeCommand,
	RemoveEffectParamKeyframeCommand,
	ToggleSourceAudioSeparationCommand,
} from "@/commands/timeline";
import type { InsertElementParams } from "@/commands/timeline/element/insert-element";
import type {
	PlannedElementMove,
	PlannedTrackCreation,
} from "@/timeline/group-move";
import type { NodeOverlay } from "@/core/state/ephemeral-layer";

/** 通用预览源（既有 previewElements/commitPreview 语义使用的 ephemeral 槽）。 */
const PREVIEW_SOURCE = "preview";

function elementPatchToOverlay(updates: Partial<TimelineElement>): NodeOverlay {
	const { params, animations, ...rest } = updates;
	return {
		params,
		animations,
		patch: rest as Partial<TimelineElement>,
	};
}

export class TimelineManager {
	private listeners = new Set<() => void>();
	public readonly dragSource = new TimelineDragSource();

	constructor(private editor: EditorCore) {}

	addTrack({ type, index }: { type: TrackType; index?: number }): string {
		const command = new AddTrackCommand({ type, index });
		this.editor.command.execute({ command });
		return command.getTrackId();
	}

	removeTrack({ trackId }: { trackId: string }): void {
		const command = new RemoveTrackCommand(trackId);
		this.editor.command.execute({ command });
	}

	insertElement({ element, placement }: InsertElementParams): void {
		const command = new InsertElementCommand({ element, placement });
		this.editor.command.execute({ command });
	}

	updateElementTrim({
		elementId,
		trimStart,
		trimEnd,
		startTime,
		duration,
		pushHistory = true,
	}: {
		elementId: string;
		trimStart: MediaTime;
		trimEnd: MediaTime;
		startTime?: MediaTime;
		duration?: MediaTime;
		pushHistory?: boolean;
	}): void {
		const trackId = this.findTrackIdForElement({ elementId });
		if (!trackId) {
			return;
		}

		const nextUpdates: Partial<TimelineElement> = {
			trimStart,
			trimEnd,
		};
		if (startTime !== undefined) {
			nextUpdates.startTime = startTime;
		}
		if (duration !== undefined) {
			nextUpdates.duration = duration;
		}

		this.updateElements({
			updates: [
				{
					trackId,
					elementId,
					patch: nextUpdates,
				},
			],
			pushHistory,
		});
	}

	updateElementRetime({
		trackId,
		elementId,
		retime,
		pushHistory = true,
	}: {
		trackId: string;
		elementId: string;
		retime?: RetimeConfig;
		pushHistory?: boolean;
	}): void {
		this.updateElements({
			updates: [
				{
					trackId,
					elementId,
					patch: {
						retime,
					},
				},
			],
			pushHistory,
		});
	}

	moveElements({
		moves,
		createTracks,
	}: {
		moves: PlannedElementMove[];
		createTracks?: PlannedTrackCreation[];
	}): void {
		if (moves.length === 0) {
			return;
		}

		const command = new MoveElementCommand({
			moves,
			createTracks,
		});
		this.editor.command.execute({ command });
	}

	toggleTrackMute({ trackId }: { trackId: string }): void {
		const command = new ToggleTrackMuteCommand(trackId);
		this.editor.command.execute({ command });
	}

	toggleTrackVisibility({ trackId }: { trackId: string }): void {
		const command = new ToggleTrackVisibilityCommand(trackId);
		this.editor.command.execute({ command });
	}

	splitElements({
		elements,
		splitTime,
		retainSide = "both",
	}: {
		elements: { trackId: string; elementId: string }[];
		splitTime: MediaTime;
		retainSide?: "both" | "left" | "right";
	}): { trackId: string; elementId: string }[] {
		const command = new SplitElementsCommand({
			elements,
			splitTime,
			retainSide,
		});
		this.editor.command.execute({ command });
		return command.getRightSideElements();
	}

	getTotalDuration(): MediaTime {
		const activeScene = this.editor.scenes.getActiveSceneOrNull();
		if (!activeScene) {
			return ZERO_MEDIA_TIME;
		}

		return calculateTotalDuration({ tracks: activeScene.tracks });
	}

	getLastFrameTime(): MediaTime {
		const duration = this.getTotalDuration();
		const fps = this.editor.project.getActive()?.settings.fps;
		if (!fps || duration <= 0) return duration;
		return lastFrameMediaTime({ duration, fps });
	}

	getTrackById({ trackId }: { trackId: string }): TimelineTrack | null {
		const activeScene = this.editor.scenes.getActiveSceneOrNull();
		if (!activeScene) {
			return null;
		}

		return findTrackInSceneTracks({ tracks: activeScene.tracks, trackId });
	}

	getElementsWithTracks({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): Array<{ track: TimelineTrack; element: TimelineElement }> {
		const result: Array<{ track: TimelineTrack; element: TimelineElement }> =
			[];

		for (const { trackId, elementId } of elements) {
			const track = this.getTrackById({ trackId });
			const element = track?.elements.find(
				(trackElement) => trackElement.id === elementId,
			);

			if (track && element) {
				result.push({ track, element });
			}
		}

		return result;
	}

	deleteElements({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): void {
		const command = new DeleteElementsCommand({ elements });
		this.editor.command.execute({ command });
	}

	toggleSourceAudioSeparation({
		trackId,
		elementId,
	}: {
		trackId: string;
		elementId: string;
	}): void {
		const command = new ToggleSourceAudioSeparationCommand({
			trackId,
			elementId,
		});
		this.editor.command.execute({ command });
	}

	updateElements({
		updates,
		pushHistory = true,
	}: {
		updates: Array<{
			trackId: string;
			elementId: string;
			patch: Partial<TimelineElement>;
		}>;
		pushHistory?: boolean;
	}): void {
		if (updates.length === 0) {
			return;
		}

		const command = new UpdateElementsCommand({
			updates,
		});
		if (pushHistory) {
			this.editor.command.execute({ command });
		} else {
			command.execute();
		}
	}

	addClipEffect({
		trackId,
		elementId,
		effectType,
	}: {
		trackId: string;
		elementId: string;
		effectType: string;
	}): string {
		const command = new AddClipEffectCommand({
			trackId,
			elementId,
			effectType,
		});
		this.editor.command.execute({ command });
		return command.getEffectId() ?? "";
	}

	removeClipEffect({
		trackId,
		elementId,
		effectId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
	}): void {
		const command = new RemoveClipEffectCommand({
			trackId,
			elementId,
			effectId,
		});
		this.editor.command.execute({ command });
	}

	removeMask({
		trackId,
		elementId,
		maskId,
	}: {
		trackId: string;
		elementId: string;
		maskId: string;
	}): void {
		const command = new RemoveMaskCommand({
			trackId,
			elementId,
			maskId,
		});
		this.editor.command.execute({ command });
	}

	deleteFreeformPathMaskPoints({
		trackId,
		elementId,
		maskId,
		pointIds,
	}: {
		trackId: string;
		elementId: string;
		maskId: string;
		pointIds: string[];
	}): void {
		if (pointIds.length === 0) {
			return;
		}
		const command = new DeleteFreeformPathMaskPointsCommand({
			trackId,
			elementId,
			maskId,
			pointIds,
		});
		this.editor.command.execute({ command });
	}

	insertFreeformPathMaskPoint({
		trackId,
		elementId,
		maskId,
		segmentIndex,
		canvasPoint,
		bounds,
	}: {
		trackId: string;
		elementId: string;
		maskId: string;
		segmentIndex: number;
		canvasPoint: { x: number; y: number };
		bounds: ElementBounds;
	}): void {
		const command = new InsertFreeformPathMaskPointCommand({
			trackId,
			elementId,
			maskId,
			segmentIndex,
			canvasPoint,
			bounds,
		});
		this.editor.command.execute({ command });
	}

	updateClipEffectParams({
		trackId,
		elementId,
		effectId,
		params,
		pushHistory = true,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
		params: Partial<ParamValues>;
		pushHistory?: boolean;
	}): void {
		const command = new UpdateClipEffectParamsCommand({
			trackId,
			elementId,
			effectId,
			params,
		});
		if (pushHistory) {
			this.editor.command.execute({ command });
		} else {
			command.execute();
		}
	}

	toggleClipEffect({
		trackId,
		elementId,
		effectId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
	}): void {
		const command = new ToggleClipEffectCommand({
			trackId,
			elementId,
			effectId,
		});
		this.editor.command.execute({ command });
	}

	toggleMaskInverted({
		trackId,
		elementId,
		maskId,
	}: {
		trackId: string;
		elementId: string;
		maskId: string;
	}): void {
		const command = new ToggleMaskInvertedCommand({
			trackId,
			elementId,
			maskId,
		});
		this.editor.command.execute({ command });
	}

	reorderClipEffects({
		trackId,
		elementId,
		fromIndex,
		toIndex,
	}: {
		trackId: string;
		elementId: string;
		fromIndex: number;
		toIndex: number;
	}): void {
		const command = new ReorderClipEffectsCommand({
			trackId,
			elementId,
			fromIndex,
			toIndex,
		});
		this.editor.command.execute({ command });
	}

	upsertKeyframes({
		keyframes,
	}: {
		keyframes: Array<{
			trackId: string;
			elementId: string;
			propertyPath: AnimationPath;
			time: MediaTime;
			value: ParamValue;
			interpolation?: AnimationInterpolation;
			keyframeId?: string;
		}>;
	}): void {
		if (keyframes.length === 0) {
			return;
		}

		const commands = keyframes.map(
			({
				trackId,
				elementId,
				propertyPath,
				time,
				value,
				interpolation,
				keyframeId,
			}) =>
				new UpsertKeyframeCommand({
					trackId,
					elementId,
					propertyPath,
					time,
					value,
					interpolation,
					keyframeId,
				}),
		);
		const command =
			commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
	}

	removeKeyframes({
		keyframes,
	}: {
		keyframes: Array<{
			trackId: string;
			elementId: string;
			propertyPath: AnimationPath;
			keyframeId: string;
		}>;
	}): void {
		if (keyframes.length === 0) {
			return;
		}

		// Pre-sample values at playhead for each (element, property) pair.
		// This preserves "what you see is what you get" when all keyframes are deleted.
		const playheadTime = this.editor.playback.getCurrentTime();
		const valueAtPlayheadMap = new Map<string, ParamValue | null>();

		for (const { trackId, elementId, propertyPath } of keyframes) {
			const key = `${elementId}:${propertyPath}`;
			if (valueAtPlayheadMap.has(key)) {
				continue;
			}

			const element = this.getElementByRef({ trackId, elementId });
			if (!element) {
				valueAtPlayheadMap.set(key, null);
				continue;
			}

			const localTime = getElementLocalTime({
				timelineTime: playheadTime,
				elementStartTime: element.startTime,
				elementDuration: element.duration,
			});

			const target = resolveAnimationTarget({ element, path: propertyPath });
			const baseValue = target?.getBaseValue() ?? null;
			if (baseValue === null) {
				valueAtPlayheadMap.set(key, null);
				continue;
			}

			const value = resolveAnimationPathValueAtTime({
				animations: element.animations,
				propertyPath,
				localTime,
				fallbackValue: baseValue,
			});
			valueAtPlayheadMap.set(key, value);
		}

		const commands = keyframes.map(
			({ trackId, elementId, propertyPath, keyframeId }) =>
				new RemoveKeyframeCommand({
					trackId,
					elementId,
					propertyPath,
					keyframeId,
					valueAtPlayhead:
						valueAtPlayheadMap.get(`${elementId}:${propertyPath}`) ?? null,
				}),
		);
		const command =
			commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
	}

	retimeKeyframe({
		trackId,
		elementId,
		propertyPath,
		keyframeId,
		time,
	}: {
		trackId: string;
		elementId: string;
		propertyPath: AnimationPath;
		keyframeId: string;
		time: MediaTime;
	}): void {
		const command = new RetimeKeyframeCommand({
			trackId,
			elementId,
			propertyPath,
			keyframeId,
			nextTime: time,
		});
		this.editor.command.execute({ command });
	}

	updateKeyframeCurves({
		keyframes,
	}: {
		keyframes: Array<{
			trackId: string;
			elementId: string;
			propertyPath: AnimationPath;
			componentKey: string;
			keyframeId: string;
			patch: ScalarCurveKeyframePatch;
		}>;
	}): void {
		if (keyframes.length === 0) {
			return;
		}

		const commands = keyframes.map(
			({ trackId, elementId, propertyPath, componentKey, keyframeId, patch }) =>
				new UpdateScalarKeyframeCurveCommand({
					trackId,
					elementId,
					propertyPath,
					componentKey,
					keyframeId,
					patch,
				}),
		);
		const command =
			commands.length === 1 ? commands[0] : new BatchCommand(commands);
		this.editor.command.execute({ command });
	}

	upsertEffectParamKeyframe({
		trackId,
		elementId,
		effectId,
		paramKey,
		time,
		value,
		interpolation,
		keyframeId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
		paramKey: string;
		time: MediaTime;
		value: number;
		interpolation?: "linear" | "hold";
		keyframeId?: string;
	}): void {
		const command = new UpsertEffectParamKeyframeCommand({
			trackId,
			elementId,
			effectId,
			paramKey,
			time,
			value,
			interpolation,
			keyframeId,
		});
		this.editor.command.execute({ command });
	}

	removeEffectParamKeyframe({
		trackId,
		elementId,
		effectId,
		paramKey,
		keyframeId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
		paramKey: string;
		keyframeId: string;
	}): void {
		const command = new RemoveEffectParamKeyframeCommand({
			trackId,
			elementId,
			effectId,
			paramKey,
			keyframeId,
		});
		this.editor.command.execute({ command });
	}

	isPreviewActive(): boolean {
		return !this.editor.state.ephemeral.isEmpty();
	}

	previewElements({
		updates,
	}: {
		updates: readonly {
			trackId: string;
			elementId: string;
			updates: Partial<TimelineElement>;
		}[];
	}): void {
		for (const { elementId, updates: elementUpdates } of updates) {
			if (Object.keys(elementUpdates).length === 0) continue;
			this.editor.state.ephemeral.apply({
				sourceId: PREVIEW_SOURCE,
				elementId,
				overlay: elementPatchToOverlay(elementUpdates),
			});
		}
		this.notify();
	}

	commitPreview(): void {
		if (this.editor.state.ephemeral.isEmpty()) return;
		const committedTracks = this.editor.scenes.getActiveSceneOrNull()?.tracks;
		if (!committedTracks) {
			return;
		}
		const afterTracks = this.editor.state.getResolvedTracks();
		const canvasSize = this.editor.project.getActive()?.settings.canvasSize;
		const finalTracks = canvasSize
			? broadcastChangedSubtitleTracks({
					before: committedTracks,
					after: afterTracks,
					canvasSize,
				})
			: afterTracks;
		const command = new TracksSnapshotCommand({
			before: committedTracks,
			after: finalTracks,
		});
		this.editor.command.push({ command });
		this.editor.state.ephemeral.clearSource(PREVIEW_SOURCE);
		this.updateTracks(finalTracks);
	}

	discardPreview(): void {
		if (this.editor.state.ephemeral.isEmpty()) return;
		this.editor.state.ephemeral.clearSource(PREVIEW_SOURCE);
		this.notify();
	}

	/**
	 * Model API（D1）：把瞬时层中的最终 transform 落地到 DocumentData。
	 * 对每个"相比提交值发生变化"的属性 P：若该属性已有动画关键帧 → 在 atTime 处更新/插入关键帧（剪映式）；
	 * 否则写 params 基础值。
	 */
	setElementsTransform({
		updates,
		atTime,
	}: {
		updates: readonly { trackId: string; elementId: string }[];
		atTime: MediaTime;
	}): void {
		const committedTracks = this.editor.scenes.getActiveSceneOrNull()?.tracks;
		const resolvedTracks = this.getPreviewTracks();
		if (!committedTracks || !resolvedTracks) {
			return;
		}

		const TRANSFORM_PATHS = [
			"transform.positionX",
			"transform.positionY",
			"transform.positionZ",
			"transform.scaleX",
			"transform.scaleY",
			"transform.rotate",
		] as const;

		const patchUpdates: {
			trackId: string;
			elementId: string;
			patch: Partial<TimelineElement>;
		}[] = [];

		for (const { trackId, elementId } of updates) {
			const committedTrack = findTrackInSceneTracks({
				tracks: committedTracks,
				trackId,
			});
			const resolvedTrack = findTrackInSceneTracks({
				tracks: resolvedTracks,
				trackId,
			});
			const committedElement = committedTrack?.elements.find(
				(el) => el.id === elementId,
			);
			const resolvedElement = resolvedTrack?.elements.find(
				(el) => el.id === elementId,
			);
			if (!committedElement || !resolvedElement) {
				continue;
			}

			const baseTransform = buildTransformFromParams({
				params: committedElement.params,
			});
			const finalTransform = buildTransformFromParams({
				params: resolvedElement.params,
			});
			const localTime = getElementLocalTime({
				timelineTime: atTime,
				elementStartTime: committedElement.startTime,
				elementDuration: committedElement.duration,
			});

			const finalValues: Record<string, number> = {
				"transform.positionX": finalTransform.position.x,
				"transform.positionY": finalTransform.position.y,
				"transform.positionZ": finalTransform.position.z,
				"transform.scaleX": finalTransform.scaleX,
				"transform.scaleY": finalTransform.scaleY,
				"transform.rotate": finalTransform.rotate,
			};
			const baseValues: Record<string, number> = {
				"transform.positionX": baseTransform.position.x,
				"transform.positionY": baseTransform.position.y,
				"transform.positionZ": baseTransform.position.z,
				"transform.scaleX": baseTransform.scaleX,
				"transform.scaleY": baseTransform.scaleY,
				"transform.rotate": baseTransform.rotate,
			};

			let nextParams = { ...committedElement.params };
			let nextAnimations = committedElement.animations;
			let animationsChanged = false;
			let paramsChanged = false;

			for (const path of TRANSFORM_PATHS) {
				const finalValue = finalValues[path];
				if (Object.is(baseValues[path], finalValue)) {
					continue;
				}
				if (
					hasKeyframesForPath({
						animations: committedElement.animations,
						propertyPath: path,
					})
				) {
					nextAnimations = upsertPathKeyframe({
						animations: nextAnimations,
						propertyPath: path,
						time: localTime as MediaTime,
						value: finalValue,
						channelLayout: NUMBER_CHANNEL_LAYOUT,
						coerceValue: ({ value }) =>
							typeof value === "number" ? value : null,
					});
					animationsChanged = true;
				} else {
					nextParams = { ...nextParams, [path]: finalValue };
					paramsChanged = true;
				}
			}

			if (!animationsChanged && !paramsChanged) {
				continue;
			}
			const patch: Partial<TimelineElement> = { params: nextParams };
			if (animationsChanged) {
				patch.animations = nextAnimations;
			}
			patchUpdates.push({ trackId, elementId, patch });
		}

		if (patchUpdates.length === 0) {
			return;
		}
		const command = new UpdateElementsCommand({ updates: patchUpdates });
		this.editor.command.execute({ command });
	}

	duplicateElements({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): { trackId: string; elementId: string }[] {
		const command = new DuplicateElementsCommand({ elements });
		this.editor.command.execute({ command });
		return command.getDuplicatedElements();
	}

	toggleElementsVisibility({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): void {
		const shouldHide = elements.some(({ trackId, elementId }) => {
			const element = this.getElementByRef({ trackId, elementId });
			return element && canElementBeHidden(element) && !element.hidden;
		});

		const nextUpdates = elements.flatMap(({ trackId, elementId }) => {
			const element = this.getElementByRef({ trackId, elementId });
			if (!element || !canElementBeHidden(element)) {
				return [];
			}

			return [
				{
					trackId,
					elementId,
					patch: { hidden: shouldHide },
				},
			];
		});

		this.updateElements({ updates: nextUpdates });
	}

	toggleElementsMuted({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}): void {
		const shouldMute = elements.some(({ trackId, elementId }) => {
			const element = this.getElementByRef({ trackId, elementId });
			return element && canElementHaveAudio(element) && !isElementMuted({ element });
		});

		const nextUpdates = elements.flatMap(({ trackId, elementId }) => {
			const element = this.getElementByRef({ trackId, elementId });
			if (!element || !canElementHaveAudio(element)) {
				return [];
			}

			return [
				{
					trackId,
					elementId,
					patch: { params: { muted: shouldMute } },
				},
			];
		});

		this.updateElements({ updates: nextUpdates });
	}

	getPreviewTracks(): SceneTracks | null {
		return this.editor.state.getResolvedTracks();
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

	private getElementByRef({
		trackId,
		elementId,
	}: {
		trackId: string;
		elementId: string;
	}): TimelineElement | undefined {
		return this.getTrackById({ trackId })?.elements.find(
			(element) => element.id === elementId,
		);
	}

	private findTrackIdForElement({
		elementId,
	}: {
		elementId: string;
	}): string | null {
		const activeScene = this.editor.scenes.getActiveSceneOrNull();
		if (!activeScene) {
			return null;
		}

		if (
			activeScene.tracks.main.elements.some(
				(element) => element.id === elementId,
			)
		) {
			return activeScene.tracks.main.id;
		}

		for (const track of activeScene.tracks.overlay) {
			if (track.elements.some((element) => element.id === elementId)) {
				return track.id;
			}
		}

		for (const track of activeScene.tracks.audio) {
			if (track.elements.some((element) => element.id === elementId)) {
				return track.id;
			}
		}

		return null;
	}

	updateTracks(newTracks: SceneTracks): void {
		this.editor.state.ephemeral.clearSource(PREVIEW_SOURCE);
		this.editor.scenes.updateSceneTracks({ tracks: newTracks });
		this.notify();
	}
}
