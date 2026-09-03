import type { ElementAnimations } from "@/animation/types";
import type { ParamValues } from "@/params";
import type { Transform } from "@/rendering";
import type { SceneTracks, TimelineElement } from "@/timeline";

/**
 * 瞬时覆盖层（Ephemeral Layer）：交互（拖动/缩放/旋转/hover/scrub/AI 预览）的临时状态，
 * 不写入 DocumentData。按 source 分槽，每个 source 只写自己关心的字段，互不覆盖；
 * resolve 时按优先级合并成单层覆盖，叠加在提交数据之上。
 */
export type SourceId = string;

export interface NodeOverlay {
	/** 位置/缩放/旋转覆盖（拖动会话用）。 */
	transform?: Transform;
	/** 任意参数覆盖。 */
	params?: Partial<ParamValues>;
	/** 动画（关键帧通道）覆盖。 */
	animations?: ElementAnimations;
	/** 节点级瞬态标记（hover / editing 等）。 */
	flags?: Record<string, boolean>;
	/** 任意元素顶层字段覆盖（兼容既有 previewElements 的通用 patch，如 duration/startTime/volume/muted）。 */
	patch?: Partial<TimelineElement>;
}

export class EphemeralLayer {
	private slots = new Map<SourceId, Map<string, NodeOverlay>>();
	private sourceOrder: SourceId[] = [];
	/** 每次 apply/clear 递增，供 getResolvedTracks 判断是否需要重算。 */
	private _version = 0;

	get version(): number {
		return this._version;
	}

	apply({
		sourceId,
		elementId,
		overlay,
	}: {
		sourceId: SourceId;
		elementId: string;
		overlay: NodeOverlay;
	}): void {
		let slot = this.slots.get(sourceId);
		if (!slot) {
			slot = new Map();
			this.slots.set(sourceId, slot);
			this.sourceOrder.push(sourceId);
		}
		const existing = slot.get(elementId);
		slot.set(elementId, mergeOverlays(existing, overlay));
		this._version += 1;
	}

	get({
		sourceId,
		elementId,
	}: {
		sourceId: SourceId;
		elementId: string;
	}): NodeOverlay | undefined {
		return this.slots.get(sourceId)?.get(elementId);
	}

	clearSource(sourceId: SourceId): void {
		if (!this.slots.delete(sourceId)) return;
		this.sourceOrder = this.sourceOrder.filter((id) => id !== sourceId);
		this._version += 1;
	}

	clearNode(elementId: string): void {
		let changed = false;
		for (const slot of this.slots.values()) {
			if (slot.delete(elementId)) changed = true;
		}
		if (changed) this._version += 1;
	}

	isEmpty(): boolean {
		return this.slots.size === 0;
	}

	/** 合并某个元素在所有槽中的覆盖（后写槽覆盖前写槽；params/animations/flags 深度合并）。 */
	resolveNodeOverlay(elementId: string): NodeOverlay | null {
		let result: NodeOverlay | null = null;
		for (const sourceId of this.sourceOrder) {
			const overlay = this.slots.get(sourceId)?.get(elementId);
			if (!overlay) {
				continue;
			}
			result = mergeOverlays(result, overlay);
		}
		return result;
	}

	/** 把覆盖应用到元素上（返回新对象；无覆盖返回原引用，利于 memo）。 */
	applyToElement(element: TimelineElement): TimelineElement {
		const overlay = this.resolveNodeOverlay(element.id);
		if (!overlay) {
			return element;
		}
		const next = { ...element, ...overlay.patch } as TimelineElement;
		if (overlay.transform) {
			next.params = {
				...next.params,
				"transform.positionX": overlay.transform.position.x,
				"transform.positionY": overlay.transform.position.y,
				"transform.positionZ": overlay.transform.position.z,
				"transform.scaleX": overlay.transform.scaleX,
				"transform.scaleY": overlay.transform.scaleY,
				"transform.rotate": overlay.transform.rotate,
			};
		}
		if (overlay.params) {
			next.params = { ...next.params, ...overlay.params };
		}
		if (overlay.animations) {
			next.animations = overlay.animations;
		}
		return next;
	}

	/** 返回应用了覆盖的 tracks（无覆盖时原引用，利于 memo）。 */
	resolveTracks(tracks: SceneTracks): SceneTracks {
		if (this.isEmpty()) {
			return tracks;
		}
		const applyTrack = <TTrack extends { elements: TimelineElement[] }>(
			track: TTrack,
		): TTrack => {
			if (!track.elements.some((element) => this.resolveNodeOverlay(element.id))) {
				return track;
			}
			return {
				...track,
				elements: track.elements.map((element) => this.applyToElement(element)),
			} as TTrack;
		};
		return {
			overlay: tracks.overlay.map(applyTrack),
			main: applyTrack(tracks.main),
			audio: tracks.audio.map(applyTrack),
		};
	}
}

function mergeOverlays(a: NodeOverlay | null, b: NodeOverlay): NodeOverlay {
	if (!a) {
		return b;
	}
	return {
		transform: b.transform ?? a.transform,
		params: { ...a.params, ...b.params },
		animations: b.animations ?? a.animations,
		flags: { ...a.flags, ...b.flags },
		patch: b.patch ?? a.patch,
	};
}
