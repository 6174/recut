import type { MediaAsset } from "@/media/types";
import type { TBackground } from "@/project/types";
import type { SceneTracks, TimelineElement } from "@/timeline/types";
import { TICKS_PER_SECOND } from "@/wasm";
import type { ParamValue } from "@/params";
import {
	readBlendModeFromParams,
	readOpacityFromParams,
} from "@/rendering";
import type { World, WorldObject } from "./types";

function ticksToSeconds(ticks: number): number {
	return ticks / TICKS_PER_SECOND;
}

function toNumber(value: ParamValue | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function buildWorld({
	scene,
	mediaAssets,
	canvasSize,
	fps,
	duration,
	background,
}: {
	scene: { id: string; tracks: SceneTracks };
	mediaAssets: MediaAsset[];
	canvasSize: { width: number; height: number };
	fps: number;
	/** 秒。 */
	duration: number;
	background: TBackground;
}): World {
	const mediaMap = new Map(mediaAssets.map((media) => [media.id, media]));
	const objects: WorldObject[] = [];
	let renderOrder = 0;

	// 轨道顺序（底 → 顶）：主轨最底，overlay 顶部轨道最前。
	// 时间线 UI 按 [...overlay, main] 从上到下显示，顶部轨道在最上层，
	// 因此 overlay 需要反转：overlay[0]（列表顶部）获得最高 renderOrder。
	const tracks = [scene.tracks.main, ...scene.tracks.overlay.slice().reverse()];
	for (const track of tracks) {
		if ("hidden" in track && track.hidden) continue;
		for (const element of track.elements) {
			if ("hidden" in element && element.hidden) continue;
			const object = elementToObject({ element, mediaMap });
			if (!object) continue;
			object.renderOrder = renderOrder++;
			objects.push(object);
		}
	}

	return {
		id: scene.id,
		width: canvasSize.width,
		height: canvasSize.height,
		fps,
		duration,
		environment: {
			background: background.type === "color" ? background.color : "#000000",
		},
		objects,
	};
}

function elementToObject({
	element,
	mediaMap,
}: {
	element: TimelineElement;
	mediaMap: Map<string, MediaAsset>;
}): WorldObject | null {
	const params = element.params;
	const common = {
		id: element.id,
		name: element.name,
		startTime: ticksToSeconds(element.startTime),
		duration: ticksToSeconds(element.duration),
		params,
		animations: element.animations,
		motionProgram: element.motionProgram,
		motion: element.motion,
		textMotion: element.textMotion,
		transform: {
			position: {
				x: toNumber(params["transform.positionX"], 0),
				y: toNumber(params["transform.positionY"], 0),
				z: toNumber(params["transform.positionZ"], 0),
			},
			scaleX: toNumber(params["transform.scaleX"], 1),
			scaleY: toNumber(params["transform.scaleY"], 1),
			rotationZ: toNumber(params["transform.rotate"], 0),
		},
		renderOrder: 0,
		opacity: readOpacityFromParams({ params }),
		blendMode: readBlendModeFromParams({ params }),
	};

	switch (element.type) {
		case "video": {
			const media = mediaMap.get(element.mediaId);
			return {
				...common,
				kind: "video",
				assetId: element.mediaId,
				url: media?.url,
				sourceWidth: media?.width,
				sourceHeight: media?.height,
				trimStart: ticksToSeconds(element.trimStart),
			};
		}
		case "image": {
			const media = mediaMap.get(element.mediaId);
			return {
				...common,
				kind: "image",
				assetId: element.mediaId,
				url: media?.url,
				sourceWidth: media?.width,
				sourceHeight: media?.height,
			};
		}
		case "text":
			return { ...common, kind: "text" };
		case "component":
			return {
				...common,
				kind: "component",
				componentId: element.componentId,
			};
		// v1 暂不迁移：graphic / effect / audio
		default:
			return null;
	}
}
