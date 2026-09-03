import type { AnyBaseNode } from "@/services/renderer/nodes/base-node";
import { ColorNode } from "@/services/renderer/nodes/color-node";
import { BlurBackgroundNode } from "@/services/renderer/nodes/blur-background-node";
import { EffectLayerNode } from "@/services/renderer/nodes/effect-layer-node";
import { TextNode } from "@/services/renderer/nodes/text-node";
import { GraphicNode } from "@/services/renderer/nodes/graphic-node";
import { VideoNode } from "@/services/renderer/nodes/video-node";
import { ImageNode } from "@/services/renderer/nodes/image-node";
import {
	ComponentNode,
	type ResolvedComponentNodeState,
} from "@/services/renderer/nodes/component-node";
import type { ResolvedVisualSourceNodeState } from "@/services/renderer/nodes/visual-node";
import type { EffectPass } from "@/effects/types";
import type { Mask } from "@/masks/types";
import type { ParamValues } from "@/params";
import type { BlendMode, Transform } from "@/rendering";
import * as THREE from "three";
import { containFit } from "./media-texture";
import type { DomTextParams } from "./dom-text-surface";
import { buildCombinedMaskTexture, type MaskQuad } from "./mask-texture";

export interface ResolvedLayer {
	id: string;
	kind: "color" | "video" | "image" | "graphic" | "text" | "effect" | "blur-background" | "component";
	source?: CanvasImageSource;
	sourceWidth: number;
	sourceHeight: number;
	/** 数据源内容版本（视频帧时间戳等），用于避免 canvas 对象复用导致漏上传。 */
	sourceVersion?: number;
	transform: Transform;
	opacity: number;
	blendMode: BlendMode;
	effectPasses: EffectPass[][];
	mask: { texture: THREE.CanvasTexture; inverted: boolean } | null;
	text?: DomTextParams;
	/** 文字层：直接绘制到全画布纹理的回调（复用 OpenCut renderTextToContext 布局）。 */
	textDraw?: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void;
	/** 组件层：由组件注册表渲染，ComponentStage 负责离屏绘制。 */
	component?: {
		componentId: string;
		params: ParamValues;
		localTime: number;
	};
	fit: "contain" | "cover" | "none";
}

export interface RenderModel {
	background: string | null;
	layers: ResolvedLayer[];
}

function textParamsFromNode(node: TextNode): DomTextParams {
	const p = (node.params as any) ?? {};
	const el = p.params ?? p;
	const resolved = (node.resolved as any) ?? {};
	return {
		text: (el.content as string) ?? (p.content as string) ?? "",
		fontSize: (el.fontSize as number) ?? (p.fontSize as number) ?? 72,
		fontFamily: (el.fontFamily as string) ?? (p.fontFamily as string) ?? "system-ui, sans-serif",
		fillColor: (resolved.textColor as string) ?? (el.color as string) ?? (el.fillColor as string) ?? (p.fillColor as string) ?? "#ffffff",
		textAlign: ((el.textAlign ?? p.textAlign ?? "center") as "left" | "center" | "right"),
		fontWeight: (el.fontWeight as number | string) ?? (p.fontWeight as number | string) ?? 400,
		fontStyle: (el.fontStyle as string) ?? (p.fontStyle as string) ?? "normal",
		letterSpacing: (el.letterSpacing as number | undefined) ?? (p.letterSpacing as number | undefined),
		lineHeight: (el.lineHeight as number | undefined) ?? (p.lineHeight as number | undefined),
		strokeColor:
			el["stroke.enabled"] === true
				? ((el["stroke.color"] as string) ?? "#000000")
				: undefined,
		strokeWidth:
			el["stroke.enabled"] === true
				? ((el["stroke.width"] as number | undefined) ?? 0)
				: 0,
	};
}

function resolveMask(
	node: AnyBaseNode,
	resolved: ResolvedVisualSourceNodeState,
	visualParams: any,
	width: number,
	height: number,
): { texture: THREE.CanvasTexture; inverted: boolean } | null {
	const masks: Mask[] = visualParams.masks ?? [];
	if (masks.length === 0) return null;
	const fit = containFit({
		sourceWidth: resolved.sourceWidth,
		sourceHeight: resolved.sourceHeight,
		canvasWidth: width,
		canvasHeight: height,
	});
	const quad: MaskQuad = {
		centerX: width / 2 + resolved.transform.position.x,
		centerY: height / 2 + resolved.transform.position.y,
		width: fit.width * resolved.transform.scaleX,
		height: fit.height * resolved.transform.scaleY,
		rotationDegrees: resolved.transform.rotate,
		flipX: false,
		flipY: false,
	};
	const texture = buildCombinedMaskTexture({
		masks,
		nodeId: `layer-${visualParams.id}`,
		quad,
		canvasWidth: width,
		canvasHeight: height,
	});
	if (!texture) return null;
	return { texture, inverted: false };
}

/** 已 resolve 的节点树 → 扁平渲染模型（背景 + 图层，自底向上）。 */
export function buildRenderModel({
	root,
	width,
	height,
}: {
	root: AnyBaseNode;
	width: number;
	height: number;
}): RenderModel {
	let background: string | null = null;
	const layers: ResolvedLayer[] = [];

	for (const child of root.children) {
		if (child instanceof ColorNode) {
			const color = (child.params as any).color as string;
			if (color && color !== "transparent") {
				background = color;
			}
			continue;
		}

		if (!child.resolved) continue;

		if (child instanceof BlurBackgroundNode) {
			const resolved = child.resolved as any;
			layers.push({
				id: `blur-bg-${child.params.mediaId}`,
				kind: "blur-background",
				source: resolved.backdropSource.source,
				sourceWidth: resolved.backdropSource.width,
				sourceHeight: resolved.backdropSource.height,
				sourceVersion: resolved.backdropSource.version,
				transform: { position: { x: 0, y: 0, z: 0 }, scaleX: 1, scaleY: 1, rotate: 0 },
				opacity: 1,
				blendMode: "normal",
				effectPasses: [resolved.passes],
				mask: null,
				fit: "cover",
			});
			continue;
		}

		if (child instanceof EffectLayerNode) {
			const resolved = child.resolved as { passes: EffectPass[] };
			layers.push({
				id: `scene-effect-${child.params.effectType}`,
				kind: "effect",
				sourceWidth: width,
				sourceHeight: height,
				transform: { position: { x: 0, y: 0, z: 0 }, scaleX: 1, scaleY: 1, rotate: 0 },
				opacity: 1,
				blendMode: "normal",
				effectPasses: [resolved.passes],
				mask: null,
				fit: "none",
			});
			continue;
		}

		if (child instanceof TextNode) {
			const resolved = child.resolved as any;
			layers.push({
				id: `text-${child.params.id}`,
				kind: "text",
				sourceWidth: width,
				sourceHeight: height,
				transform: resolved.transform,
				opacity: resolved.opacity,
				blendMode: (child.params as any).blendMode ?? "normal",
				effectPasses: resolved.effectPasses,
				mask: null,
				text: textParamsFromNode(child),
				fit: "none",
			});
			continue;
		}

		if (child instanceof ComponentNode) {
			const resolved = child.resolved as ResolvedComponentNodeState;
			layers.push({
				id: `layer-${child.params.id}`,
				kind: "component",
				component: {
					componentId: child.params.componentId,
					params: resolved.params,
					localTime: resolved.localTime,
				},
				sourceWidth: width,
				sourceHeight: height,
				transform: resolved.transform,
				opacity: resolved.opacity,
				blendMode: (child.params as any).blendMode ?? "normal",
				effectPasses: resolved.effectPasses,
				mask: null,
				fit: "none",
			});
			continue;
		}

		if (child instanceof VideoNode || child instanceof ImageNode || child instanceof GraphicNode) {
			const resolved = child.resolved as ResolvedVisualSourceNodeState;
			if (!resolved.source) continue;
			const visualParams = child.params as any;
			layers.push({
				id: `layer-${visualParams.id}`,
				kind: child instanceof VideoNode ? "video" : child instanceof ImageNode ? "image" : "graphic",
				source: resolved.source,
				sourceWidth: resolved.sourceWidth,
				sourceHeight: resolved.sourceHeight,
				sourceVersion: resolved.sourceVersion,
				transform: resolved.transform,
				opacity: resolved.opacity,
				blendMode: visualParams.blendMode ?? "normal",
				effectPasses: resolved.effectPasses,
				mask: resolveMask(child, resolved, visualParams, width, height),
				fit: "contain",
			});
			continue;
		}
	}

	return { background, layers };
}
