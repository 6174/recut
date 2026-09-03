/**
 * [INPUT]: 依赖 recut.assets SDK 返回的受宿主授权字幕 part URL。
 * [OUTPUT]: 提供从全局 Asset 下载并导入字幕的读取流程。
 * [POS]: subtitles 的平台素材适配层；不自行推导 Service 地址。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { recut } from "@/recut/sdk";
import { parseSubtitleFile } from "@/subtitles/parse";
import type { SubtitleCue } from "@/subtitles/types";
import { buildCaptionChunks } from "@/transcription/caption";
import type { TranscriptionSegment } from "@/transcription/types";

export interface RecutSubtitleSelection {
	id: string;
	name: string;
	kind: string;
	mimeType: string;
	status: string;
}

export interface RecutSubtitleResult {
	captions: SubtitleCue[];
	skippedCueCount: number;
	warnings: string[];
}

/** 打开全局 Recut 素材选择器，返回用户挑选的字幕（transcript）素材。 */
export async function pickRecutSubtitle(): Promise<RecutSubtitleSelection | null> {
	const selection = await recut.media.pick({
		kinds: ["transcript"],
		multiple: false,
	});
	if (!selection) return null;
	const asset = Array.isArray(selection) ? selection[0] : selection;
	if (!asset || typeof asset !== "object" || typeof asset.id !== "string") {
		return null;
	}
	return asset as RecutSubtitleSelection;
}

async function fetchTextPart({
	assetId,
	part,
}: {
	assetId: string;
	part: "srt" | "json";
}): Promise<string> {
	const response = await fetch(await recut.assets.partURL({ assetId, part }));
	if (!response.ok) {
		throw new Error(`Failed to fetch subtitles (${response.status})`);
	}
	return response.text();
}

/** 从 transcript 素材拉取字幕 cue：优先 SRT part，缺失时回退 JSON part。 */
export async function fetchRecutSubtitleCues({
	assetId,
}: {
	assetId: string;
}): Promise<RecutSubtitleResult> {
	try {
		const srt = await fetchTextPart({ assetId, part: "srt" });
		const result = parseSubtitleFile({ fileName: "transcript.srt", input: srt });
		if (result.captions.length > 0) {
			return result;
		}
	} catch (error) {
		console.warn("Failed to read SRT part, falling back to JSON:", error);
	}

	const json = await fetchTextPart({ assetId, part: "json" });
	const parsed: unknown = JSON.parse(json);
	const segments = extractSegments(parsed);
	const chunks = buildCaptionChunks({ segments });
	if (chunks.length === 0) {
		return { captions: [], skippedCueCount: 0, warnings: [] };
	}
	return {
		captions: chunks,
		skippedCueCount: 0,
		warnings: [
			"Imported subtitles from the transcript JSON; word-level timings may be approximate.",
		],
	};
}

function extractSegments(parsed: unknown): TranscriptionSegment[] {
	if (!parsed || typeof parsed !== "object") return [];
	const segments = (parsed as { segments?: unknown }).segments;
	if (!Array.isArray(segments)) return [];
	return segments
		.filter(
			(segment): segment is Record<string, unknown> =>
				Boolean(
					segment &&
						typeof segment === "object" &&
						typeof (segment as Record<string, unknown>).text === "string" &&
						typeof (segment as Record<string, unknown>).start === "number" &&
						typeof (segment as Record<string, unknown>).end === "number",
				),
		)
		.map((segment) => ({
			text: String(segment.text),
			start: Number(segment.start),
			end: Number(segment.end),
		}));
}
