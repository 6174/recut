/**
 * [INPUT]: 依赖 timeline group-move 的组构建/轨道解析，以及时间线类型与 MediaTime 工具。
 * [OUTPUT]: 验证同轨多选拖动复用目标轨道，并在真实冲突时只创建一条新轨道。
 * [POS]: timeline/group-move 的回归测试；锁定横向多选拖动不被错误拆轨的契约。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { GraphicElement, GraphicTrack, SceneTracks, VideoTrack } from "@/timeline";
import { mediaTimeFromSeconds } from "@/wasm";

let buildMoveGroup: typeof import("./build-group").buildMoveGroup;
let resolveGroupMove: typeof import("./resolve-move").resolveGroupMove;

beforeAll(async () => {
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: { location: { search: "" } },
	});
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: { language: "en" },
	});
	({ buildMoveGroup } = await import("./build-group"));
	({ resolveGroupMove } = await import("./resolve-move"));
});

function graphicElement(id: string, startSeconds: number): GraphicElement {
	return {
		id,
		name: id,
		type: "graphic",
		definitionId: "test-graphic",
		startTime: mediaTimeFromSeconds({ seconds: startSeconds }),
		duration: mediaTimeFromSeconds({ seconds: 1 }),
		trimStart: mediaTimeFromSeconds({ seconds: 0 }),
		trimEnd: mediaTimeFromSeconds({ seconds: 1 }),
		params: {},
	};
}

function tracks(elements: GraphicElement[]): SceneTracks {
	const main: VideoTrack = {
		id: "main",
		name: "Main",
		type: "video",
		elements: [],
		muted: false,
		hidden: false,
	};
	const graphicTrack: GraphicTrack = {
		id: "graphic-1",
		name: "Graphics",
		type: "graphic",
		elements,
		hidden: false,
	};
	return { overlay: [graphicTrack], main, audio: [] };
}

function selectedGroup(sceneTracks: SceneTracks) {
	return buildMoveGroup({
		anchorRef: { trackId: "graphic-1", elementId: "e1" },
		selectedElements: [
			{ trackId: "graphic-1", elementId: "e1" },
			{ trackId: "graphic-1", elementId: "e2" },
		],
		tracks: sceneTracks,
	});
}

describe("resolveGroupMove", () => {
	it("同一轨道上的多选元素移动到空闲区时复用目标轨道", () => {
		const sceneTracks = tracks([
			graphicElement("e1", 0),
			graphicElement("e2", 2),
			graphicElement("e3", 4),
		]);
		const group = selectedGroup(sceneTracks);
		expect(group).not.toBeNull();

		const result = resolveGroupMove({
			group: group!,
			tracks: sceneTracks,
			anchorStartTime: mediaTimeFromSeconds({ seconds: 6 }),
			target: { kind: "existingTrack", anchorTargetTrackId: "graphic-1" },
		});

		expect(result?.createTracks).toEqual([]);
		expect(result?.moves.map((move) => move.targetTrackId)).toEqual([
			"graphic-1",
			"graphic-1",
		]);
	});

	it("同轨目标确实冲突时只为整组创建一条新轨道", () => {
		const sceneTracks = tracks([
			graphicElement("e1", 0),
			graphicElement("e2", 2),
			graphicElement("stationary", 6),
		]);
		const group = selectedGroup(sceneTracks);
		expect(group).not.toBeNull();

		const existingResult = resolveGroupMove({
			group: group!,
			tracks: sceneTracks,
			anchorStartTime: mediaTimeFromSeconds({ seconds: 6 }),
			target: { kind: "existingTrack", anchorTargetTrackId: "graphic-1" },
		});
		expect(existingResult).toBeNull();

		const fallbackResult = resolveGroupMove({
			group: group!,
			tracks: sceneTracks,
			anchorStartTime: mediaTimeFromSeconds({ seconds: 6 }),
			target: {
				kind: "newTracks",
				anchorInsertIndex: 1,
				newTrackIds: ["new-1"],
			},
		});

		expect(fallbackResult?.createTracks).toHaveLength(1);
		expect(fallbackResult?.moves.map((move) => move.targetTrackId)).toEqual([
			"new-1",
			"new-1",
		]);
	});
});
