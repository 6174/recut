import type { ParamValues } from "@/params";
import type { SceneTracks, TextElement } from "@/timeline";
import {
	findTrackInSceneTracks,
	updateTrackInSceneTracks,
} from "@/timeline";
import type { SubtitlePlacementStyle } from "./types";
import {
	SUBTITLE_CONTENT_PARAM_KEY,
	SUBTITLE_POSITION_X_KEY,
	SUBTITLE_POSITION_Y_KEY,
	buildSubtitleParams,
	derivePlacementFromCue,
} from "./layout";

export function isCaptionTrack(
	track: { type: string; captionStyle?: unknown } | undefined,
): boolean {
	return (
		!!track &&
		track.type === "text" &&
		(track as { captionStyle?: unknown }).captionStyle !== undefined
	);
}

export function isSubtitleElement(
	element: { type: string; subtitle?: unknown } | undefined,
): boolean {
	return (
		!!element &&
		element.type === "text" &&
		Boolean((element as TextElement).subtitle)
	);
}

/** 找出 before→after 间 params 发生变化的字幕 cue（仅字幕轨上的字幕元素）。 */
export function findChangedSubtitleTargets({
	before,
	after,
}: {
	before: SceneTracks;
	after: SceneTracks;
}): { trackId: string; elementId: string }[] {
	const targets: { trackId: string; elementId: string }[] = [];

	const visitTrack = (beforeTrack: unknown, afterTrack: unknown) => {
		const track = beforeTrack as { type: string; captionStyle?: unknown };
		if (!isCaptionTrack(track)) return;
		const beforeEls = (beforeTrack as { elements: unknown[] }).elements;
		const afterEls = (afterTrack as { elements: unknown[] }).elements;
		for (const afterElement of afterEls) {
			const candidate = afterElement as TextElement;
			if (!isSubtitleElement(candidate)) continue;
			const beforeElement = beforeEls.find(
				(element) => (element as { id: string }).id === candidate.id,
			);
			if (!beforeElement) continue;
			if (
				JSON.stringify((beforeElement as TextElement).params) !==
				JSON.stringify(candidate.params)
			) {
				targets.push({
					trackId: (afterTrack as { id: string }).id,
					elementId: candidate.id,
				});
			}
		}
	};

	const beforeMain = before.main;
	const afterMain = after.main;
	if (beforeMain && afterMain) {
		visitTrack(beforeMain, afterMain);
	}
	const overlayCount = Math.min(before.overlay.length, after.overlay.length);
	for (let i = 0; i < overlayCount; i++) {
		visitTrack(before.overlay[i], after.overlay[i]);
	}
	const audioCount = Math.min(before.audio.length, after.audio.length);
	for (let i = 0; i < audioCount; i++) {
		visitTrack(before.audio[i], after.audio[i]);
	}

	return targets;
}

/** 提交预览时：对发生变化的字幕 cue 逐个广播共享样式（多目标时收敛到最后一个）。 */
export function broadcastChangedSubtitleTracks({
	before,
	after,
	canvasSize,
}: {
	before: SceneTracks;
	after: SceneTracks;
	canvasSize: { width: number; height: number };
}): SceneTracks {
	let tracks = after;
	const targets = findChangedSubtitleTargets({ before, after });
	for (const target of targets) {
		tracks = broadcastSubtitleStyle({
			tracks,
			trackId: target.trackId,
			elementId: target.elementId,
			canvasSize,
		});
	}
	return tracks;
}

/** 从元素 params 提取共享样式（去掉 content 与按 cue 派生的位置）。 */
export function subtitleStyleParamsOf(params: ParamValues): ParamValues {
	const next = { ...params };
	delete next[SUBTITLE_CONTENT_PARAM_KEY];
	delete next[SUBTITLE_POSITION_X_KEY];
	delete next[SUBTITLE_POSITION_Y_KEY];
	return next;
}

function readPositionValue(params: ParamValues, key: string): number {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * 把字幕轨上某条 cue 的当前样式/位置广播到全轨：
 * - 共享样式（除 content 与位置外）强制统一到所有字幕 cue；
 * - 由目标 cue 当前排版位置推导全轨 placement（锚点），逐 cue 重算位置（保持底部对齐/居中）；
 * - 同步 track.captionStyle / track.captionPlacement，供后续新 cue 继承与 AI 读取。
 * 非字幕轨或非字幕元素时原样返回。
 */
export function broadcastSubtitleStyle({
	tracks,
	trackId,
	elementId,
	canvasSize,
}: {
	tracks: SceneTracks;
	trackId: string;
	elementId: string;
	canvasSize: { width: number; height: number };
}): SceneTracks {
	const track = findTrackInSceneTracks({ tracks, trackId });
	if (!isCaptionTrack(track) || track.type !== "text") {
		return tracks;
	}

	const target = track.elements.find(
		(element): element is TextElement =>
			element.id === elementId && isSubtitleElement(element),
	);
	if (!target) {
		return tracks;
	}

	const styleParams = subtitleStyleParamsOf(target.params);
	const targetContent =
		typeof target.params[SUBTITLE_CONTENT_PARAM_KEY] === "string"
			? (target.params[SUBTITLE_CONTENT_PARAM_KEY] as string)
			: "";
	const placement: SubtitlePlacementStyle = derivePlacementFromCue({
		canvasSize,
		styleParams,
		content: targetContent,
		positionX: readPositionValue(target.params, SUBTITLE_POSITION_X_KEY),
		positionY: readPositionValue(target.params, SUBTITLE_POSITION_Y_KEY),
		provisionalPlacement: track.captionPlacement,
	});

	return updateTrackInSceneTracks({
		tracks,
		trackId,
		update: (currentTrack) => {
			if (currentTrack.type !== "text") return currentTrack;

			const elements = currentTrack.elements.map((element) => {
				if (
					element.type !== "text" ||
					!isSubtitleElement(element)
				) {
					return element;
				}
				const content =
					typeof element.params[SUBTITLE_CONTENT_PARAM_KEY] === "string"
						? (element.params[SUBTITLE_CONTENT_PARAM_KEY] as string)
						: "";
				return {
					...element,
					params: buildSubtitleParams({
						canvasSize,
						styleParams,
						placement,
						content,
					}),
				};
			});

			return {
				...currentTrack,
				elements,
				captionStyle: {
					...styleParams,
					[SUBTITLE_POSITION_X_KEY]: readPositionValue(
						target.params,
						SUBTITLE_POSITION_X_KEY,
					),
					[SUBTITLE_POSITION_Y_KEY]: readPositionValue(
						target.params,
						SUBTITLE_POSITION_Y_KEY,
					),
				},
				captionPlacement: placement,
			};
		},
	});
}
