import type { RetimeConfig } from "@timeline/timeline";
import { clampRetimeRate } from "@timeline/retime/rate";

export function buildConstantRetime({
	rate,
	maintainPitch = false,
}: {
	rate: number;
	maintainPitch?: boolean;
}): RetimeConfig {
	return { rate: clampRetimeRate({ rate }), maintainPitch };
}
