import { describe, expect, it } from "vitest";
import { VisualRuntime } from "./world-runtime";
import type { World, WorldObject } from "./types";
import { TICKS_PER_SECOND } from "@/wasm";

const ticksToSeconds = (ticks: number) => ticks / TICKS_PER_SECOND;

function textObject(id: string, startTicks: number, durationTicks: number): WorldObject {
	return {
		id,
		kind: "text",
		name: id,
		startTime: ticksToSeconds(startTicks),
		duration: ticksToSeconds(durationTicks),
		params: { content: id },
		transform: {
			position: { x: 0, y: 0, z: 0 },
			scaleX: 1,
			scaleY: 1,
			rotationZ: 0,
		},
		renderOrder: 0,
		opacity: 1,
		blendMode: "normal",
	} as WorldObject;
}

function worldWithAbuttedPair(splitTicks: number, tailTicks: number): World {
	return {
		id: "w",
		width: 1920,
		height: 1080,
		fps: 30,
		duration: ticksToSeconds(splitTicks + tailTicks),
		environment: { background: "#000000" },
		objects: [
			textObject("a", 0, splitTicks),
			textObject("b", splitTicks, tailTicks),
		],
	} as World;
}

describe("abutted clips leave no blank frame at the junction", () => {
	it("exactly one object is active for every tick across the junction", () => {
		const splitTicks = 199_999;
		const tailTicks = 120_000;
		const runtime = new VisualRuntime();
		runtime.load(worldWithAbuttedPair(splitTicks, tailTicks));

		for (let t = splitTicks - 5; t <= splitTicks + 5; t += 1) {
			const frame = runtime.evaluate(ticksToSeconds(t));
			expect(frame.objects.map((o) => o.object.id)).toEqual(
				t < splitTicks ? ["a"] : ["b"],
			);
		}
	});

	it("float render times near the junction still hit exactly one object", () => {
		const splitTicks = 199_999;
		const tailTicks = 120_000;
		const runtime = new VisualRuntime();
		runtime.load(worldWithAbuttedPair(splitTicks, tailTicks));
		const splitSec = ticksToSeconds(splitTicks);

		// 播放时间是连续浮点（rAF 推进），在接缝附近以亚 tick 步长扫一遍。
		for (let i = -20; i <= 20; i += 1) {
			const frame = runtime.evaluate(splitSec + i * 1e-9);
			expect(frame.objects).toHaveLength(1);
		}
	});
});
