/**
 * 帧率（有理数）。镜像 Rust time crate 的 FrameRate。
 */
export interface FrameRate {
	numerator: number;
	denominator: number;
}

export const FPS_23_976: FrameRate = { numerator: 24000, denominator: 1001 };
export const FPS_24: FrameRate = { numerator: 24, denominator: 1 };
export const FPS_25: FrameRate = { numerator: 25, denominator: 1 };
export const FPS_29_97: FrameRate = { numerator: 30000, denominator: 1001 };
export const FPS_30: FrameRate = { numerator: 30, denominator: 1 };
export const FPS_48: FrameRate = { numerator: 48, denominator: 1 };
export const FPS_50: FrameRate = { numerator: 50, denominator: 1 };
export const FPS_59_94: FrameRate = { numerator: 60000, denominator: 1001 };
export const FPS_60: FrameRate = { numerator: 60, denominator: 1 };
export const FPS_120: FrameRate = { numerator: 120, denominator: 1 };

/** 每帧 tick 数；非整帧率（如 7/3）返回 null。 */
export function ticksPerFrame({ rate }: { rate: FrameRate }): number | null {
	const ticks = (TICKS_PER_SECOND * rate.denominator) / rate.numerator;
	return Number.isInteger(ticks) ? ticks : null;
}

export function frameRateToFloat({ rate }: { rate: FrameRate }): number {
	return rate.numerator / rate.denominator;
}

export function frameRateEquals(
	a: FrameRate | null | undefined,
	b: FrameRate | null | undefined,
): boolean {
	if (!a || !b) return a === b;
	return a.numerator === b.numerator && a.denominator === b.denominator;
}

export function floatToFrameRate(rate: number): FrameRate {
	return { numerator: Math.round(rate), denominator: 1 };
}

export function frameToSeconds({
	frame,
	rate,
}: {
	frame: number;
	rate: FrameRate;
}): number {
	return frame * (rate.denominator / rate.numerator);
}

export function secondsToFrame({
	seconds,
	rate,
}: {
	seconds: number;
	rate: FrameRate;
}): number {
	return seconds * (rate.numerator / rate.denominator);
}

export const TICKS_PER_SECOND = 120_000;
