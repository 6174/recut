import * as THREE from "three";
import { getMaskDefinition } from "@/masks";
import type { Mask } from "@/masks/types";
import { createCanvasSurface } from "@/services/renderer/canvas-utils";

export interface MaskQuad {
	centerX: number;
	centerY: number;
	width: number;
	height: number;
	rotationDegrees: number;
	flipX: boolean;
	flipY: boolean;
}

const cache = new Map<string, THREE.CanvasTexture>();

function quadHash(quad: MaskQuad): string {
	return `${quad.centerX.toFixed(2)}:${quad.centerY.toFixed(2)}:${quad.width.toFixed(2)}:${quad.height.toFixed(2)}:${quad.rotationDegrees.toFixed(2)}:${quad.flipX ? 1 : 0}:${quad.flipY ? 1 : 0}`;
}

function drawTransformedCanvas({
	ctx,
	source,
	transform,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	source: CanvasImageSource;
	transform: MaskQuad;
}) {
	const x = transform.centerX - transform.width / 2;
	const y = transform.centerY - transform.height / 2;
	const flipX = transform.flipX ? -1 : 1;
	const flipY = transform.flipY ? -1 : 1;
	const hasTransform =
		transform.rotationDegrees !== 0 || flipX !== 1 || flipY !== 1;
	if (hasTransform) {
		ctx.save();
		ctx.translate(transform.centerX, transform.centerY);
		ctx.rotate((transform.rotationDegrees * Math.PI) / 180);
		ctx.scale(flipX, flipY);
		ctx.translate(-transform.centerX, -transform.centerY);
	}
	ctx.drawImage(source, x, y, transform.width, transform.height);
	if (hasTransform) ctx.restore();
}

/** 计算元素的 mask 纹理（全画布大小，白色 alpha 形状）。feather>0 时对形状做模糊羽化。 */
export function buildMaskTexture({
	mask,
	nodeId,
	quad,
	canvasWidth,
	canvasHeight,
}: {
	mask: Mask;
	nodeId: string;
	quad: MaskQuad;
	canvasWidth: number;
	canvasHeight: number;
}): THREE.CanvasTexture | null {
	const definition = getMaskDefinition(mask.type);
	if (!definition) return null;
	if (definition.isActive?.(mask.params) === false) return null;

	const key = `${nodeId}|${mask.type}|${JSON.stringify(mask.params)}|${quadHash(quad)}|${canvasWidth}x${canvasHeight}`;
	const cached = cache.get(key);
	if (cached) return cached;

	const { body } = definition.renderer;
	const width = Math.round(quad.width);
	const height = Math.round(quad.height);
	const { canvas: elementMaskCanvas, context: elementMaskCtx } =
		createCanvasSurface({ width, height });

	switch (body.kind) {
		case "fillPath": {
			const path2d = body.buildPath({
				resolvedParams: mask.params,
				width: quad.width,
				height: quad.height,
			});
			elementMaskCtx.fillStyle = "white";
			elementMaskCtx.fill(path2d);
			break;
		}
		case "drawOpaque":
			body.drawOpaque({
				resolvedParams: mask.params,
				ctx: elementMaskCtx,
				width,
				height,
			});
			break;
		case "drawWithFeather": {
			const usesOpaqueFastPath =
				mask.params.feather === 0 && Boolean(body.opaqueFastPath);
			if (usesOpaqueFastPath && body.opaqueFastPath) {
				const path2d = body.opaqueFastPath.buildPath({
					resolvedParams: mask.params,
					width: quad.width,
					height: quad.height,
				});
				elementMaskCtx.fillStyle = "white";
				elementMaskCtx.fill(path2d);
			} else {
				body.drawWithFeather({
					resolvedParams: mask.params,
					ctx: elementMaskCtx,
					width,
					height,
					feather: mask.params.feather,
				});
			}
			break;
		}
	}

	const fullCanvas = document.createElement("canvas");
	fullCanvas.width = canvasWidth;
	fullCanvas.height = canvasHeight;
	const fullCtx = fullCanvas.getContext("2d");
	if (!fullCtx) return null;
	fullCtx.clearRect(0, 0, canvasWidth, canvasHeight);

	// 羽化：drawWithFeather 已解析进纹理；其余类型用 blur 近似
	if (body.kind !== "drawWithFeather" && mask.params.feather > 0) {
		fullCtx.filter = `blur(${Math.max(0, mask.params.feather * 0.4)}px)`;
	}
	drawTransformedCanvas({ ctx: fullCtx, source: elementMaskCanvas, transform: quad });

	const texture = new THREE.CanvasTexture(fullCanvas);
	texture.colorSpace = THREE.NoColorSpace;
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.flipY = true;
	texture.needsUpdate = true;

	if (cache.size > 256) cache.clear();
	cache.set(key, texture);
	return texture;
}

/**
 * 多蒙版合并：将多个 mask 各自的保留区做交集，烘焙成一张全画布纹理。
 * 非反转 mask → 保留形状内部（combined *= shapeAlpha，destination-in）；
 * 反转 mask → 保留形状外部（combined *= 1 - shapeAlpha，destination-out）。
 * 结果以 inverted=false 交给合成器（反转已烘焙进 alpha）。
 */
export function buildCombinedMaskTexture({
	masks,
	nodeId,
	quad,
	canvasWidth,
	canvasHeight,
}: {
	masks: Mask[];
	nodeId: string;
	quad: MaskQuad;
	canvasWidth: number;
	canvasHeight: number;
}): THREE.CanvasTexture | null {
	if (masks.length === 0) return null;

	const key = `${nodeId}|${masks
		.map((m) => `${m.type}|${JSON.stringify(m.params)}`)
		.join("||")}|${quadHash(quad)}|${canvasWidth}x${canvasHeight}`;
	const cached = cache.get(key);
	if (cached) return cached;

	const textures: { texture: THREE.CanvasTexture; inverted: boolean }[] = [];
	for (const mask of masks) {
		const texture = buildMaskTexture({ mask, nodeId, quad, canvasWidth, canvasHeight });
		if (!texture) continue;
		textures.push({ texture, inverted: mask.params.inverted });
	}
	if (textures.length === 0) return null;

	const canvas = document.createElement("canvas");
	canvas.width = canvasWidth;
	canvas.height = canvasHeight;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;

	ctx.clearRect(0, 0, canvasWidth, canvasHeight);
	ctx.fillStyle = "white";
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);

	for (const { texture, inverted } of textures) {
		ctx.globalCompositeOperation = inverted ? "destination-out" : "destination-in";
		ctx.drawImage(texture.image as CanvasImageSource, 0, 0);
	}
	ctx.globalCompositeOperation = "source-over";

	const combined = new THREE.CanvasTexture(canvas);
	combined.colorSpace = THREE.NoColorSpace;
	combined.minFilter = THREE.LinearFilter;
	combined.magFilter = THREE.LinearFilter;
	combined.flipY = true;
	combined.needsUpdate = true;

	if (cache.size > 256) cache.clear();
	cache.set(key, combined);
	return combined;
}
