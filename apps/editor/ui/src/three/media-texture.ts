import * as THREE from "three";

/** CanvasImageSource → THREE.CanvasTexture 缓存（按 source 身份复用，映射 Y 翻转）。 */
const textureCache = new Map<CanvasImageSource, THREE.CanvasTexture>();

export function getOrCreateCanvasTexture(source: CanvasImageSource): THREE.CanvasTexture | null {
	const cached = textureCache.get(source);
	if (cached) return cached;
	if (!(source instanceof HTMLCanvasElement) && !(source instanceof OffscreenCanvas)) {
		return null;
	}
	const texture = new THREE.CanvasTexture(source);
	texture.colorSpace = THREE.NoColorSpace;
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.flipY = true;
	texture.needsUpdate = true;
	textureCache.set(source, texture);
	return texture;
}

/** 视频帧（CanvasImageSource）→ 纹理，每帧标记需更新。 */
export function getVideoTexture(source: CanvasImageSource): THREE.CanvasTexture | null {
	const texture = getOrCreateCanvasTexture(source);
	if (texture) texture.needsUpdate = true;
	return texture;
}

export function clearTextureCache(): void {
	textureCache.clear();
}

/** 把元素源按 contain 适配进画布，返回基础尺寸（px）。 */
export function containFit({
	sourceWidth,
	sourceHeight,
	canvasWidth,
	canvasHeight,
}: {
	sourceWidth: number;
	sourceHeight: number;
	canvasWidth: number;
	canvasHeight: number;
}): { width: number; height: number } {
	const contain = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
	return { width: sourceWidth * contain, height: sourceHeight * contain };
}

export function isCanvasLike(source: CanvasImageSource): source is HTMLCanvasElement | OffscreenCanvas {
	return (
		source instanceof HTMLCanvasElement ||
		(typeof OffscreenCanvas !== "undefined" && source instanceof OffscreenCanvas)
	);
}
