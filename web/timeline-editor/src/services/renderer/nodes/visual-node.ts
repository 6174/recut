import { BaseNode } from "./base-node";
import type { Effect, EffectPass } from "@timeline/effects/types";
import type { Mask } from "@timeline/masks/types";
import type { BlendMode, Transform } from "@timeline/rendering";
import type { RetimeConfig, VisualElement } from "@timeline/timeline";

export interface VisualNodeParams {
	id: string;
	duration: number;
	timeOffset: number;
	trimStart: number;
	trimEnd: number;
	retime?: RetimeConfig;
	transform: Transform;
	animations?: VisualElement["animations"];
	opacity: number;
	blendMode?: BlendMode;
	effects?: Effect[];
	masks?: Mask[];
}

export interface ResolvedVisualNodeState {
	localTime: number;
	transform: Transform;
	opacity: number;
	effectPasses: EffectPass[][];
}

export interface ResolvedVisualSourceNodeState extends ResolvedVisualNodeState {
	source: CanvasImageSource;
	sourceWidth: number;
	sourceHeight: number;
	/** 数据源内容版本（如视频帧时间戳）。用于避免复用同一 canvas 对象时漏上传。 */
	sourceVersion?: number;
}

export abstract class VisualNode<
	Params extends VisualNodeParams = VisualNodeParams,
	Resolved extends ResolvedVisualNodeState = ResolvedVisualNodeState,
> extends BaseNode<Params, Resolved> {}
