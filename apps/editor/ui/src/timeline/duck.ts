import type { SceneTracks } from "./types";
import { TICKS_PER_SECOND } from "@/wasm";

/**
 * 自动混音（auto-duck）的确定性包络计算 —— Preview 与 Export 共用同一算法
 * （与 background.js 的 buildDuckEnvelope 同构，保证 Preview==Export）。
 *
 * 语义：音频轨 role=anchor 的出声区间把 role=follower 的轨下压 duckDepthDb(dB)，
 * 间隙回升到原电平；SFX 轨（role=none）不参与。
 */

export const DUCK_DEFAULT_DEPTH_DB = 8;
export const DUCK_FADE_SILENCE_DB = -100;

export type DuckEnvelope = {
	depthDb: number;
	spans: Array<{ startSec: number; endSec: number }>;
	factorAt: (sec: number) => number;
};

export type TrackRole = "anchor" | "follower" | "none";

export function trackRoleOf(track: { role?: TrackRole }): TrackRole {
	return track.role ?? "none";
}

export function dBToLinear(db: number): number {
	return 10 ** (db / 20);
}

function allTracks(tracks: SceneTracks) {
	return [...tracks.overlay, tracks.main, ...tracks.audio];
}

function collectAnchorSpans(tracks: SceneTracks): Array<{
	startSec: number;
	endSec: number;
}> {
	const spans: Array<{ startSec: number; endSec: number }> = [];
	for (const track of allTracks(tracks)) {
		if (trackRoleOf(track) !== "anchor" || (track as { muted?: boolean }).muted)
			continue;
		for (const element of track.elements) {
			if (element.type !== "audio" && element.type !== "video") continue;
			if (element.params.muted === true) continue;
			const volume = element.params.volume;
			const baseVolume = typeof volume === "number" ? volume : 0;
			if (baseVolume <= DUCK_FADE_SILENCE_DB + 40) continue;
			const start = element.startTime / TICKS_PER_SECOND;
			const end = (element.startTime + element.duration) / TICKS_PER_SECOND;
			if (end <= start) continue;
			spans.push({ startSec: start, endSec: end });
		}
	}

	spans.sort((a, b) => a.startSec - b.startSec);
	const merged: Array<{ startSec: number; endSec: number }> = [];
	for (const span of spans) {
		const last = merged[merged.length - 1];
		if (last && span.startSec <= last.endSec) {
			if (span.endSec > last.endSec) last.endSec = span.endSec;
		} else {
			merged.push({ startSec: span.startSec, endSec: span.endSec });
		}
	}
	return merged;
}

function autoInitDuckDepth(tracks: SceneTracks): number {
	let sum = 0;
	let count = 0;
	for (const track of allTracks(tracks)) {
		if (trackRoleOf(track) !== "anchor") continue;
		for (const element of track.elements) {
			if (element.type !== "audio" && element.type !== "video") continue;
			const volume = element.params.volume;
			const value = typeof volume === "number" ? volume : 0;
			if (value > DUCK_FADE_SILENCE_DB + 40) {
				sum += value;
				count += 1;
			}
		}
	}
	if (count === 0) return DUCK_DEFAULT_DEPTH_DB;
	const averageDb = sum / count;
	return Math.max(4, Math.min(16, 10 - averageDb));
}

export function buildDuckEnvelope(
	tracks: SceneTracks,
	depthDb?: number,
): DuckEnvelope {
	const spans = collectAnchorSpans(tracks);
	const depth =
		typeof depthDb === "number" && Number.isFinite(depthDb)
			? depthDb
			: autoInitDuckDepth(tracks);
	const duckFactor = dBToLinear(-depth);
	return {
		depthDb: depth,
		spans,
		factorAt: (sec: number) => {
			for (const span of spans) {
				if (sec >= span.startSec && sec < span.endSec) return duckFactor;
			}
			return 1;
		},
	};
}
