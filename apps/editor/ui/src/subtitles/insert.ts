import { EditorCore } from "@/core";
import { Command, type CommandResult } from "@/commands/base-command";
import type { ParamValues } from "@/params";
import type { SceneTracks, TextTrack } from "@/timeline";
import {
	findTrackInSceneTracks,
	updateTrackInSceneTracks,
} from "@/timeline";
import { buildEmptyTrack } from "@/timeline/placement";
import { generateUUID } from "@/utils/id";
import { mediaTime } from "@/wasm";
import { buildSubtitleTextElement } from "./build-subtitle-text-element";
import { defaultSubtitlePlacement } from "./layout";
import { subtitleStyleParamsOf } from "./shared-style";
import type {
	CaptionSource,
	SubtitleCue,
	SubtitlePlacementStyle,
} from "./types";

export interface CaptionTrackImportOptions {
	/** 复用已有轨道（text 轨会被升级为字幕轨）；缺省新建字幕轨。 */
	trackId?: string;
	/** 全轨共享样式；缺省取第一条 cue 解析出的样式。 */
	captionStyle?: ParamValues;
	/** 全轨锚点；缺省 bottom 5%。 */
	captionPlacement?: SubtitlePlacementStyle;
	/** 各 cue 起始基准偏移（拖放导入时用）。 */
	startOffsetTicks?: number;
	/** 字幕轨对全局 transcript 素材的引用（生成字幕时写，项目只存引用）。 */
	captionSource?: CaptionSource;
	source?: "srt" | "ass" | "transcript";
}

class InsertCaptionsCommand extends Command {
	private savedState: SceneTracks | null = null;
	private readonly trackId: string;
	private readonly trackIndex: number;
	private readonly cueElements: ReturnType<typeof buildSubtitleTextElement>[];
	private readonly captionStyle: ParamValues;
	private readonly captionPlacement: SubtitlePlacementStyle;
	private readonly captionSource: CaptionSource | undefined;

	constructor({
		trackId,
		trackIndex = 0,
		cueElements,
		captionStyle,
		captionPlacement,
		captionSource,
	}: {
		trackId: string;
		trackIndex?: number;
		cueElements: ReturnType<typeof buildSubtitleTextElement>[];
		captionStyle: ParamValues;
		captionPlacement: SubtitlePlacementStyle;
		captionSource?: CaptionSource;
	}) {
		super();
		this.trackId = trackId;
		this.trackIndex = trackIndex;
		this.cueElements = cueElements;
		this.captionStyle = captionStyle;
		this.captionPlacement = captionPlacement;
		this.captionSource = captionSource;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;

		const existing = findTrackInSceneTracks({
			tracks: this.savedState,
			trackId: this.trackId,
		});

		let tracks: SceneTracks;
		if (existing && existing.type === "text") {
			tracks = updateTrackInSceneTracks({
				tracks: this.savedState,
				trackId: this.trackId,
				update: (track) => ({
					...track,
					captionStyle: this.captionStyle,
					captionPlacement: this.captionPlacement,
					...(this.captionSource ? { captionSource: this.captionSource } : {}),
					elements: [
						...track.elements,
						...this.cueElements.map((element) => ({
							...element,
							id: generateUUID(),
						})),
					],
				}),
			});
		} else {
			const newTrack = buildEmptyTrack({
				id: this.trackId,
				type: "text",
			}) as TextTrack;
			newTrack.captionStyle = this.captionStyle;
			newTrack.captionPlacement = this.captionPlacement;
			if (this.captionSource) {
				newTrack.captionSource = this.captionSource;
			}
			newTrack.elements = this.cueElements.map((element) => ({
				...element,
				id: generateUUID(),
			}));
			const insertIndex = Math.min(this.trackIndex, this.savedState.overlay.length);
			tracks = {
				...this.savedState,
				overlay: [
					...this.savedState.overlay.slice(0, insertIndex),
					newTrack,
					...this.savedState.overlay.slice(insertIndex),
				],
			};
		}

		editor.timeline.updateTracks(tracks);
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}

	getTrackId(): string {
		return this.trackId;
	}
}

/**
 * 把字幕 cue 铺到一条字幕轨上：每条 cue 是独立 text 元素（带 subtitle 标记），
 * 轨道携带共享样式 captionStyle + 锚点 captionPlacement，可整体广播/移动。
 */
export function insertCaptionChunksAsTextTrack({
	editor,
	captions,
	options,
}: {
	editor: EditorCore;
	captions: SubtitleCue[];
	options?: CaptionTrackImportOptions;
}): string | null {
	if (captions.length === 0) {
		return null;
	}

	const canvasSize = editor.project.getActive().settings.canvasSize;
	const source = options?.source ?? "srt";
	const startOffsetTicks = options?.startOffsetTicks ?? 0;

	const existingTrack = options?.trackId
		? findTrackInSceneTracks({
				tracks: editor.scenes.getActiveScene().tracks,
				trackId: options.trackId,
			})
		: null;

	const baseStyle =
		options?.captionStyle ??
		(existingTrack?.type === "text" && existingTrack.captionStyle
			? existingTrack.captionStyle
			: undefined);
	const basePlacement =
		options?.captionPlacement ??
		(existingTrack?.type === "text" && existingTrack.captionPlacement
			? existingTrack.captionPlacement
			: undefined);

	const cueElements = captions.map((caption, index) =>
		buildSubtitleTextElement({
			index,
			caption,
			canvasSize,
			baseStyle,
			basePlacement,
			source,
			startOffset: mediaTime({ ticks: startOffsetTicks }),
		}),
	);

	const firstStyleParams = subtitleStyleParamsOf(cueElements[0].params);
	const captionStyle =
		baseStyle ?? firstStyleParams;
	const captionPlacement =
		basePlacement ?? defaultSubtitlePlacement();

	const trackId =
		options?.trackId ?? `track-caption-${generateUUID().slice(0, 8)}`;
	const command = new InsertCaptionsCommand({
		trackId,
		cueElements,
		captionStyle,
		captionPlacement,
	});
	editor.command.execute({ command });

	return trackId;
}
