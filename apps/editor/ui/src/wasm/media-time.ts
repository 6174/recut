import type { FrameRate } from "@/time/frame-rate";
import { parseTimecode, type MediaTime } from "@/time";

export function parseMediaTimecode({
	timeCode,
	format,
	fps,
}: {
	timeCode: string;
	format: "MM:SS" | "HH:MM:SS" | "HH:MM:SS:CS" | "HH:MM:SS:FF";
	fps: FrameRate;
}): MediaTime | null {
	const parsed = parseTimecode({ timeCode, format, rate: fps });
	return parsed == null ? null : (parsed as MediaTime);
}
