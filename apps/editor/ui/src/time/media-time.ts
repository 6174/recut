import type { FrameRate } from "./frame-rate";
import { TICKS_PER_SECOND } from "./frame-rate";

/**
 * 整数 tick 时间。镜像 Rust `MediaTime(i64)`：120000 ticks/秒。
 * branded type：读免费，写被 gate（mediaTime/roundMediaTime）。
 */
export type MediaTime = number & { readonly __mediaTime: unique symbol };

function isMediaTime(value: number): value is MediaTime {
	return Number.isInteger(value);
}

function requireMediaTime({
	value,
	context,
}: {
	value: number;
	context: string;
}): MediaTime {
	if (!isMediaTime(value)) {
		throw new Error(`${context}: expected an integer tick count, got ${value}`);
	}
	return value;
}

export const ZERO_MEDIA_TIME = requireMediaTime({ value: 0, context: "ZERO_MEDIA_TIME" });

export function mediaTime({ ticks }: { ticks: number }): MediaTime {
	return requireMediaTime({ value: ticks, context: "mediaTime()" });
}

/** 投射到整数 tick 网格（半值远离零舍入，匹配 Rust round）。 */
export function roundMediaTime({ time }: { time: number }): MediaTime {
	const roundedMagnitude = Math.round(Math.abs(time));
	if (roundedMagnitude === 0) return ZERO_MEDIA_TIME;
	return requireMediaTime({
		value: time < 0 ? -roundedMagnitude : roundedMagnitude,
		context: "roundMediaTime()",
	});
}

export function mediaTimeFromSeconds({ seconds }: { seconds: number }): MediaTime {
	return requireMediaTime({
		value: Math.round(seconds * TICKS_PER_SECOND),
		context: "mediaTimeFromSeconds()",
	});
}

export function mediaTimeToSeconds({ time }: { time: MediaTime }): number {
	return time / TICKS_PER_SECOND;
}

export function addMediaTime({ a, b }: { a: MediaTime; b: MediaTime }): MediaTime {
	return requireMediaTime({ value: a + b, context: "addMediaTime()" });
}

export function subMediaTime({ a, b }: { a: MediaTime; b: MediaTime }): MediaTime {
	return requireMediaTime({ value: a - b, context: "subMediaTime()" });
}

export function maxMediaTime({ a, b }: { a: MediaTime; b: MediaTime }): MediaTime {
	return a > b ? a : b;
}

export function minMediaTime({ a, b }: { a: MediaTime; b: MediaTime }): MediaTime {
	return a < b ? a : b;
}

export function clampMediaTime({
	time,
	min,
	max,
}: {
	time: MediaTime;
	min: MediaTime;
	max: MediaTime;
}): MediaTime {
	if (time < min) return min;
	if (time > max) return max;
	return time;
}

export function roundToFrame({
	time,
	rate,
}: {
	time: number;
	rate: FrameRate;
}): number {
	return (
		Math.round((time * rate.numerator) / rate.denominator) *
		(rate.denominator / rate.numerator)
	);
}

export function floorToFrame({
	time,
	rate,
}: {
	time: number;
	rate: FrameRate;
}): number {
	return (
		Math.floor((time * rate.numerator) / rate.denominator) *
		(rate.denominator / rate.numerator)
	);
}

export function isFrameAligned({
	time,
	rate,
}: {
	time: number;
	rate: FrameRate;
}): boolean {
	return Number.isInteger((time * rate.numerator) / rate.denominator);
}

export function roundFrameTime({
	time,
	fps,
}: {
	time: MediaTime;
	fps: FrameRate;
}): MediaTime {
	return requireMediaTime({
		value: roundToFrame({ time, rate: fps }),
		context: "roundFrameTime()",
	});
}

export function roundFrameTicks({
	ticks,
	fps,
}: {
	ticks: number;
	fps: FrameRate;
}): number {
	return roundToFrame({ time: ticks, rate: fps });
}

export function snappedSeekTime({
	time,
	duration,
	rate,
}: {
	time: number;
	duration: number;
	rate: FrameRate;
}): number {
	const last = lastFrameTime({ duration, rate });
	const clamped = Math.max(0, Math.min(time, last));
	return roundToFrame({ time: clamped, rate });
}

export function snapSeekMediaTime({
	time,
	duration,
	fps,
}: {
	time: MediaTime;
	duration: MediaTime;
	fps: FrameRate;
}): MediaTime {
	return requireMediaTime({
		value: snappedSeekTime({ time, duration, rate: fps }),
		context: "snapSeekMediaTime()",
	});
}

export function lastFrameTime({
	duration,
	rate,
}: {
	duration: number;
	rate: FrameRate;
}): number {
	const ticksPer = (TICKS_PER_SECOND * rate.denominator) / rate.numerator;
	if (!Number.isInteger(ticksPer) || ticksPer <= 0) return duration;
	const frames = Math.ceil(duration / ticksPer) - 1;
	if (frames < 0) return 0;
	return frames * ticksPer;
}

export function lastFrameMediaTime({
	duration,
	fps,
}: {
	duration: MediaTime;
	fps: FrameRate;
}): MediaTime {
	return requireMediaTime({
		value: lastFrameTime({ duration, rate: fps }),
		context: "lastFrameMediaTime()",
	});
}
