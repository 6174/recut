/**
 * [INPUT]: 依赖效果注册表、参数默认值与 GPU 渲染器。
 * [OUTPUT]: 对外提供 effectPreviewService，使用内建画布样本绘制效果缩略图。
 * [POS]: renderer 的效果预览服务；不依赖发布包中易缺失的外部图片资源。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { createCanvasSurface } from "./canvas-utils";
import { effectsRegistry, resolveEffectPasses } from "@/effects";
import { buildDefaultParamValues } from "@/params/registry";
import type { ParamValues } from "@/params";
import { gpuRenderer } from "./gpu-renderer";

const PREVIEW_SIZE = 160;

class EffectPreviewService {
	private testSourceCanvas: OffscreenCanvas | null = null;

	readonly PREVIEW_SIZE = PREVIEW_SIZE;

	onPreviewImageReady({ callback }: { callback: () => void }): () => void {
		const frameId = requestAnimationFrame(callback);
		return () => cancelAnimationFrame(frameId);
	}

	renderPreview({
		effectType,
		params,
		targetCanvas,
		uniformDimensions,
	}: {
		effectType: string;
		params: ParamValues;
		targetCanvas: HTMLCanvasElement;
		uniformDimensions?: { width: number; height: number };
	}): void {
		const size = PREVIEW_SIZE;
		const targetCtx = targetCanvas.getContext(
			"2d",
		) as CanvasRenderingContext2D | null;
		if (!targetCtx) {
			return;
		}

		targetCanvas.width = size;
		targetCanvas.height = size;

		const source = this.getTestSource({ width: size, height: size });
		if (!source) {
			targetCtx.clearRect(0, 0, size, size);
			return;
		}

		try {
			const definition = effectsRegistry.get(effectType);
			const resolvedParams =
				Object.keys(params).length > 0
					? params
					: buildDefaultParamValues(definition.params);

			const passes = resolveEffectPasses({
				definition,
				effectParams: resolvedParams,
				width: uniformDimensions?.width ?? size,
				height: uniformDimensions?.height ?? size,
			});
			const result = this.applyGpuEffect({
				source,
				width: size,
				height: size,
				passes,
			});

			targetCtx.drawImage(result, 0, 0, size, size);
		} catch (error) {
			console.warn("Failed to render effect preview", { effectType, error });
			targetCtx.clearRect(0, 0, size, size);
			targetCtx.drawImage(source, 0, 0, size, size);
		}
	}

	private createTestSource({
		width,
		height,
	}: {
		width: number;
		height: number;
	}): OffscreenCanvas | null {
		const { canvas, context } = createCanvasSurface({ width, height });
		const background = context.createLinearGradient(0, 0, width, height);
		background.addColorStop(0, "#ffbd6b");
		background.addColorStop(0.48, "#ef5b5b");
		background.addColorStop(1, "#382d68");
		context.fillStyle = background;
		context.fillRect(0, 0, width, height);

		context.fillStyle = "rgba(255, 255, 255, 0.88)";
		context.beginPath();
		context.arc(width * 0.3, height * 0.32, width * 0.16, 0, Math.PI * 2);
		context.fill();
		context.fillStyle = "rgba(22, 28, 50, 0.78)";
		context.fillRect(width * 0.12, height * 0.64, width * 0.76, height * 0.14);
		return canvas;
	}

	private getTestSource({
		width,
		height,
	}: {
		width: number;
		height: number;
	}): OffscreenCanvas | null {
		if (
			!this.testSourceCanvas ||
			this.testSourceCanvas.width !== width ||
			this.testSourceCanvas.height !== height
		) {
			this.testSourceCanvas = this.createTestSource({ width, height });
		}
		return this.testSourceCanvas;
	}

	private applyGpuEffect({
		source,
		width,
		height,
		passes,
	}: {
		source: OffscreenCanvas;
		width: number;
		height: number;
		passes: ReturnType<typeof resolveEffectPasses>;
	}): OffscreenCanvas {
		return gpuRenderer.applyEffect({
			source,
			width,
			height,
			passes,
		});
	}
}

export const effectPreviewService = new EffectPreviewService();
