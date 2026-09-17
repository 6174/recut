import type { SnapPoint } from "@timeline/timeline/snapping";
import type { MediaTime } from "@timeline/wasm";

export function getPlayheadSnapPoints({
	playheadTime,
}: {
	playheadTime: MediaTime;
}): SnapPoint[] {
	return [{ time: playheadTime, type: "playhead" }];
}
