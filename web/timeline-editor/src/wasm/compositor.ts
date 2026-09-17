/**
 * 纯 JS 2D 合成器：替代 opencut-wasm 的 GPU compositor。
 * 同一接口（initCompositor/uploadTexture/renderFrame/...），用 Canvas 2D 绘制
 * FrameDescriptor，使完整 OpenCut 预览无需 wasm 即可运行。
 */

type LayerItem = {
	type: "layer";
	textureId: string;
	transform: {
		centerX: number;
		centerY: number;
		width: number;
		height: number;
		rotationDegrees: number;
		flipX: boolean;
		flipY: boolean;
	};
	opacity: number;
	blendMode: string;
	effectPassGroups: Array<Array<{ shader: string; uniforms: Record<string, unknown> }>>;
	mask: { textureId: string; feather: number; inverted: boolean } | null;
};

type SceneEffectItem = {
	type: "sceneEffect";
	effectPassGroups: Array<Array<{ shader: string; uniforms: Record<string, unknown> }>>;
};

type Frame = {
	width: number;
	height: number;
	clear: { color: [number, number, number, number] };
	items: Array<LayerItem | SceneEffectItem>;
};

const BLEND_COMPOSITE_OPERATION: Record<string, GlobalCompositeOperation> = {
	normal: "source-over",
	darken: "darken",
	multiply: "multiply",
	"color-burn": "color-burn",
	lighten: "lighten",
	screen: "screen",
	overlay: "overlay",
	"soft-light": "soft-light",
	"hard-light": "hard-light",
	difference: "difference",
	exclusion: "exclusion",
	hue: "hue",
	saturation: "saturation",
	color: "color",
	luminosity: "luminosity",
	"plus-lighter": "lighter",
	"color-dodge": "color-dodge",
};

let compositorCanvas: HTMLCanvasElement | null = null;
let compositorCtx: CanvasRenderingContext2D | null = null;
let textureStore = new Map<string, CanvasImageSource>();
let lastFrameProfile: Array<{ name: string; durationMs: number }> = [];

export function initCompositor(width: number, height: number): void {
	compositorCanvas = document.createElement("canvas");
	compositorCanvas.width = width;
	compositorCanvas.height = height;
	compositorCtx = compositorCanvas.getContext("2d");
}

export function resizeCompositor(width: number, height: number): void {
	if (compositorCanvas) {
		compositorCanvas.width = width;
		compositorCanvas.height = height;
	}
	compositorCtx = compositorCanvas?.getContext("2d") ?? null;
}

export function getCompositorCanvas(): HTMLCanvasElement {
	if (!compositorCanvas) {
		initCompositor(1, 1);
	}
	return compositorCanvas as HTMLCanvasElement;
}

export function uploadTexture({
	id,
	source,
}: {
	id: string;
	source: CanvasImageSource;
	width: number;
	height: number;
}): void {
	textureStore.set(id, source);
}

export function releaseTexture(id: string): void {
	textureStore.delete(id);
}

export function getLastFrameProfile(): Array<{ name: string; durationMs: number }> {
	return lastFrameProfile;
}

function applyGaussianBlur(
	source: CanvasImageSource,
	width: number,
	height: number,
	sigma: number,
): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) return canvas;
	const radius = Math.max(0, Math.round((sigma || 0) * 1.2));
	if (radius === 0) {
		ctx.drawImage(source, 0, 0);
		return canvas;
	}
	ctx.filter = `blur(${radius}px)`;
	ctx.drawImage(source, 0, 0);
	return canvas;
}

export function applyEffectPasses({
	source,
	width,
	height,
	passes,
}: {
	source: OffscreenCanvas;
	width: number;
	height: number;
	passes: Array<{ shader: string; uniforms: Record<string, unknown> }>;
}): OffscreenCanvas {
	let current: CanvasImageSource = source;
	for (const pass of passes) {
		if (pass.shader === "gaussian-blur") {
			const sigma = (pass.uniforms as any).sigma ?? 4;
			current = applyGaussianBlur(current, width, height, sigma);
		}
	}
	if (current === source) return source;
	const out = new OffscreenCanvas(width, height);
	const ctx = out.getContext("2d");
	if (ctx) ctx.drawImage(current, 0, 0);
	return out;
}

export function applyMaskFeather({
	mask,
	width,
	height,
	feather,
}: {
	mask: OffscreenCanvas;
	width: number;
	height: number;
	feather: number;
}): OffscreenCanvas {
	if (!feather || feather <= 0) return mask;
	const out = new OffscreenCanvas(width, height);
	const ctx = out.getContext("2d");
	if (!ctx) return mask;
	ctx.filter = `blur(${Math.max(0, feather * 0.4)}px)`;
	ctx.drawImage(mask, 0, 0);
	return out;
}

export async function initializeGpu(): Promise<void> {
	// 纯 JS 2D 合成器：无需 GPU，总是可用。
	return;
}

function drawLayer(ctx: CanvasRenderingContext2D, item: LayerItem): void {
	const texture = textureStore.get(item.textureId);
	if (!texture) return;

	const { centerX, centerY, width, height, rotationDegrees, flipX, flipY } =
		item.transform;

	// 特效（2D 近似：每 pass 应用到该层纹理）
	let source: CanvasImageSource = texture;
	for (const group of item.effectPassGroups) {
		for (const pass of group) {
			if (pass.shader === "gaussian-blur") {
				const sigma = (pass.uniforms as any).sigma ?? 4;
				source = applyGaussianBlur(source, width, height, sigma);
			}
		}
	}

	ctx.save();
	ctx.translate(centerX, centerY);
	ctx.rotate((rotationDegrees * Math.PI) / 180);
	ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
	ctx.globalAlpha = Math.max(0, Math.min(1, item.opacity));
	const composite = BLEND_COMPOSITE_OPERATION[item.blendMode];
	if (composite) {
		ctx.globalCompositeOperation = composite;
	}
	ctx.drawImage(source, -width / 2, -height / 2, width, height);
	ctx.restore();

	// 遮罩近似：用 mask 纹理做 destination-in
	if (item.mask) {
		const maskSource = textureStore.get(item.mask.textureId);
		if (maskSource) {
			const maskCanvas = document.createElement("canvas");
			maskCanvas.width = width;
			maskCanvas.height = height;
			const maskCtx = maskCanvas.getContext("2d");
			if (maskCtx) {
				maskCtx.clearRect(0, 0, width, height);
				if (item.mask.feather > 0) {
					maskCtx.filter = `blur(${Math.max(0, item.mask.feather * 0.4)}px)`;
				}
				maskCtx.drawImage(maskSource, 0, 0, width, height);
				const tmp = document.createElement("canvas");
				tmp.width = width;
				tmp.height = height;
				const tmpCtx = tmp.getContext("2d");
				if (tmpCtx) {
					tmpCtx.drawImage(compositorCanvas as HTMLCanvasElement, 0, 0);
					tmpCtx.globalCompositeOperation = "destination-in";
					tmpCtx.drawImage(maskCanvas, 0, 0, width, height);
					ctx.clearRect(0, 0, width, height);
					ctx.drawImage(tmp, 0, 0);
				}
			}
		}
	}
}

export function renderFrame(frame: Frame): void {
	const startedAt = performance.now();
	if (!compositorCanvas) {
		initCompositor(frame.width, frame.height);
	}
	if (
		compositorCanvas!.width !== frame.width ||
		compositorCanvas!.height !== frame.height
	) {
		compositorCanvas!.width = frame.width;
		compositorCanvas!.height = frame.height;
	}
	const ctx = compositorCtx;
	if (!ctx) return;

	const [r, g, b, a] = frame.clear.color;
	ctx.globalCompositeOperation = "source-over";
	ctx.globalAlpha = 1;
	ctx.fillStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(
		b * 255,
	)}, ${a})`;
	ctx.fillRect(0, 0, frame.width, frame.height);

	for (const item of frame.items) {
		if (item.type === "layer") {
			drawLayer(ctx, item);
		} else if (item.type === "sceneEffect") {
			for (const group of item.effectPassGroups) {
				for (const pass of group) {
					if (pass.shader === "gaussian-blur") {
						const sigma = (pass.uniforms as any).sigma ?? 4;
						const blurred = applyGaussianBlur(
							compositorCanvas as HTMLCanvasElement,
							frame.width,
							frame.height,
							sigma,
						);
						ctx.clearRect(0, 0, frame.width, frame.height);
						ctx.drawImage(blurred, 0, 0);
					}
				}
			}
		}
	}

	lastFrameProfile = [
		{ name: "wasm.deserialize", durationMs: 0 },
		{ name: "wasm.renderFrameToSurface", durationMs: performance.now() - startedAt },
	];
}
