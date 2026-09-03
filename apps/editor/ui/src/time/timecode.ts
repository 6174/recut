import type { FrameRate } from "./frame-rate";
import { TICKS_PER_SECOND } from "./frame-rate";
import type { MediaTime } from "./media-time";

export type TimeCodeFormat =
	| "MM:SS"
	| "HH:MM:SS"
	| "HH:MM:SS:CS"
	| "HH:MM:SS:FF";

const PARTS: Record<string, number> = {
	"MM:SS": 2,
	"HH:MM:SS": 3,
	"HH:MM:SS:CS": 4,
	"HH:MM:SS:FF": 4,
};

export function guessTimecodeFormat({ value }: { value: string }): TimeCodeFormat {
	const parts = value.split(":").length;
	if (parts <= 2) return "MM:SS";
	if (parts === 3) return "HH:MM:SS";
	return "HH:MM:SS:CS";
}

export function formatTimecode({
	time,
	format = "HH:MM:SS:CS",
	rate,
}: {
	time: MediaTime | number;
	format?: TimeCodeFormat;
	rate?: FrameRate;
}): string {
	const totalSeconds = time / TICKS_PER_SECOND;
	const total = Math.max(0, Math.floor(totalSeconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	const cs = Math.floor(((totalSeconds - Math.floor(totalSeconds)) * 100) % 100);

	const pad = (n: number, w = 2) => String(n).padStart(w, "0");

	switch (format) {
		case "MM:SS":
			return `${pad(minutes)}:${pad(seconds)}`;
		case "HH:MM:SS":
			return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
		case "HH:MM:SS:CS":
			return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(cs)}`;
		case "HH:MM:SS:FF": {
			const fps = rate ? rate.numerator / rate.denominator : 30;
			const frameNumber = Math.floor(
				(totalSeconds - Math.floor(totalSeconds)) * fps,
			);
			return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frameNumber)}`;
		}
	}
}

export function parseTimecode({
	timeCode,
	format,
	rate,
}: {
	timeCode: string;
	format: TimeCodeFormat;
	rate?: FrameRate;
}): number | null {
	const parts = timeCode.trim().split(":");
	const expected = PARTS[format];
	if (!expected || parts.length !== expected) return null;

	const nums = parts.map((p) => parseInt(p, 10));
	if (nums.some((n) => Number.isNaN(n))) return null;

	let seconds: number;
	switch (format) {
		case "MM:SS":
			seconds = nums[0] * 60 + nums[1];
			break;
		case "HH:MM:SS":
			if (nums[1] >= 60 || nums[2] >= 60) return null;
			seconds = nums[0] * 3600 + nums[1] * 60 + nums[2];
			break;
		case "HH:MM:SS:CS":
			if (nums[1] >= 60 || nums[2] >= 60) return null;
			seconds = nums[0] * 3600 + nums[1] * 60 + nums[2] + nums[3] / 100;
			break;
		case "HH:MM:SS:FF": {
			if (nums[1] >= 60 || nums[2] >= 60) return null;
			const fps = rate ? rate.numerator / rate.denominator : 30;
			if (nums[3] >= Math.ceil(fps)) return null;
			seconds = nums[0] * 3600 + nums[1] * 60 + nums[2] + nums[3] / fps;
			break;
		}
		default:
			return null;
	}

	return Math.round(seconds * TICKS_PER_SECOND);
}
