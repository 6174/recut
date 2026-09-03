import * as THREE from "three";
import type { ContentBounds } from "../types";

export type { ContentBounds } from "../types";

/**
 * [INPUT]: 浏览器 CanvasDrawElement 与 Three CanvasTexture 的离屏绘制能力
 * [OUTPUT]: DomContentSurface、ContentBounds；为旧组件按需输出非透明范围
 * [POS]: runtime/components 的 DOM→完整纹理层；HtmlObject 仅在作者未声明边界时使用像素扫描
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

interface HicCanvas extends HTMLCanvasElement {
	layoutSubtree?: boolean;
	requestPaint?: () => void;
	captureElementImage?: (element: Element) => { close: () => void } & OffscreenCanvas;
}

interface HicContext extends CanvasRenderingContext2D {
	drawElementImage?: (
		source: ImageBitmap | CanvasImageSource | OffscreenCanvas,
		dx: number,
		dy: number,
	) => void;
}

/**
 * 通用 HTML-in-Canvas 内容表面（泛化 DomTextSurface）：
 * 隐藏宿主 DOM 承载任意内容（React portal / innerHTML），paint 事件 → captureElementImage → 纹理。
 * 供 L1（html 字符串模板）与 L2（react JSX）组件把 DOM 内容捕获为 plane 纹理。
 * scale > 1 时超采样：captureCanvas 的 backing store 取 width×scale，CSS 仍为设计尺寸
 * （DOM 内容按 base px 排版），captureElementImage 即以更高分辨率光栅化——同 remotion-kit
 * HtmlInCanvas 的 pixelDensity 语义，避免大画布/retina 下纹理被放大导致锯齿。
 * captureVersion 每成功捕获递增；导出用 waitForCapture 等纹理就绪再读帧，
 * 避免画布读到上一帧的旧纹理造成成片闪动（对齐 remotion-kit delayRender 语义）。
 */

/** 活跃的 DOM 内容表面集合：导出时等待所有表面的捕获完成。 */
export const activeContentSurfaces = new Set<DomContentSurface>();

export class DomContentSurface {
	texture: THREE.CanvasTexture;
	/** 捕获根元素：包含内容区与安全边距，始终与光栅纹理同尺寸。 */
	element: HTMLDivElement;
	/** 内容挂载元素：设计尺寸不变，放在 capture root 的安全边距中心。 */
	contentElement: HTMLDivElement;
	/** 仅旧组件请求测量时回调可见像素范围；null 表示本帧还没有可用内容。 */
	onCaptured: ((bounds: ContentBounds | null) => void) | null = null;
	private captureCanvas: HicCanvas | null = null;
	private offscreen: OffscreenCanvas | null = null;
	private context: HicContext | null = null;
	private outputCanvas: HTMLCanvasElement;
	private outputContext: CanvasRenderingContext2D;
	private host: HTMLDivElement;
	private wantsRepaint = false;
	private destroyed = false;
	private captureFrame = 0;
	private captureVersion = 0;
	private failedCaptures = 0;
	private lastRequestAt = 0;
	/** 新组件由作者声明 box；只有旧组件显式请求时才做昂贵的 alpha 扫描。 */
	private needsContentBounds = false;
	private readonly scale: number;

	constructor(width: number, height: number, scale = 1, padding = 0) {
		this.scale = scale;
		const safePadding = Math.max(0, Math.floor(padding));
		const contentWidth = Math.max(1, width - safePadding * 2);
		const contentHeight = Math.max(1, height - safePadding * 2);
		const renderWidth = Math.max(1, Math.ceil(width * scale));
		const renderHeight = Math.max(1, Math.ceil(height * scale));

		this.captureCanvas = document.createElement("canvas") as HicCanvas;
		this.captureCanvas.width = renderWidth;
		this.captureCanvas.height = renderHeight;
		this.captureCanvas.layoutSubtree = true;
		// CSS 保持设计尺寸：DOM 按 base px 排版，backing 更高 → 超采样捕获。
		this.captureCanvas.style.width = `${width}px`;
		this.captureCanvas.style.height = `${height}px`;

		// 隐藏宿主：必须在视口内且被实际绘制，Chromium 才保留 paint record。
		// opacity 必须 > 0（opacity:0 会让 Chromium 跳过绘制 → captureElementImage 无
		// paint record → 纹理空白）；用 z-index:-1 把它沉到不透明 App 壳（h-screen bg-background）
		// 之下，视觉上不可见但仍在绘制。负 z-index 在某些 iframe/stacking context 中会
		// 被浏览器直接跳过 paint，导致 DOM 已提交但纹理永久透明；保持前景层级、极低
		// 不透明度才能稳定获得 paint record。captureElementImage 读的是元素自身 raster，
		// 与合成透明度无关，因此隐藏不影响捕获质量。
		// 注意 opacity 必须低到合成后不可察觉：铺满画布的组件会把它整块不透明内容
		// （如深色渐变）以 1.1% 合成到编辑器浅绿背景上，形成占满大半屏的可见色带；
		// 0.001 使每通道差量 <1/255，8-bit 屏上与背景像素一致。
		this.host = document.createElement("div");
		this.host.style.cssText = `position:fixed;left:0;top:0;z-index:99999;opacity:0.001;pointer-events:none;width:${width}px;height:${height}px;`;
		document.body.appendChild(this.host);
		this.host.appendChild(this.captureCanvas);

		this.element = document.createElement("div");
		this.element.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;overflow:hidden;`;
		this.captureCanvas.appendChild(this.element);
		this.contentElement = document.createElement("div");
		// 设计坐标系保持不变；动画可以在外层 padding 区域内越界而不被 capture 截断。
		this.contentElement.style.cssText = `position:absolute;left:${safePadding}px;top:${safePadding}px;width:${contentWidth}px;height:${contentHeight}px;overflow:visible;`;
		this.element.appendChild(this.contentElement);

		this.offscreen = this.captureCanvas.transferControlToOffscreen();
		this.context = this.offscreen.getContext("2d") as unknown as HicContext | null;

		this.outputCanvas = document.createElement("canvas");
		this.outputCanvas.width = renderWidth;
		this.outputCanvas.height = renderHeight;
		// 旧组件的选择框需要读取 alpha 范围；显式声明，避免 Chromium 反复 GPU→CPU 回读告警。
		this.outputContext = this.outputCanvas.getContext("2d", {
			willReadFrequently: true,
		})!;

		this.texture = new THREE.CanvasTexture(this.outputCanvas);
		// CanvasDrawElement 捕获的是浏览器的 sRGB 栅格；与视频/图片保持同一输入色域。
		this.texture.colorSpace = THREE.SRGBColorSpace;
		this.texture.minFilter = THREE.LinearFilter;
		this.texture.magFilter = THREE.LinearFilter;
		this.texture.flipY = true;

		activeContentSurfaces.add(this);
		this.captureCanvas.addEventListener("paint", () => this.onPaint());
	}

	/** 内容/动画变化时请求重绘；仅参数/布局变化才重新读取 alpha 边界。 */
	requestUpdate({ measureContentBounds = false }: { measureContentBounds?: boolean } = {}): void {
		if (this.destroyed) return;
		this.needsContentBounds ||= measureContentBounds;
		this.lastRequestAt = performance.now();
		this.wantsRepaint = true;
		this.captureCanvas?.requestPaint?.();
		// Chromium 的 paint 事件在 iframe 中并不可靠：DOM 已提交、requestPaint 已调用，
		// 事件仍可能永远不来。下一帧主动 capture，保证纹理刷新仅依赖已提交的 DOM。
		this.scheduleCapture();
	}

	private scheduleCapture(): void {
		if (this.destroyed || this.captureFrame) return;
		this.captureFrame = requestAnimationFrame(() => {
			this.captureFrame = 0;
			this.onPaint();
		});
	}

	/**
	 * 等待一次新捕获（captureVersion 递增）完成。导出时用于确保纹理就绪后再读帧，
	 * 避免读到上一帧旧纹理导致成片闪动。rAF 轮询（与帧对齐），并跳过自本次等待起
	 * 没有新更新请求的表面（例如暂停中的预览），因此只等真正要更新的表面，
	 * 不会因无关表面阻塞导出。
	 */
	waitForCapture(timeoutMs = 400): Promise<void> {
		if (this.destroyed) return Promise.resolve();
		const startedVersion = this.captureVersion;
		const startAt = performance.now();
		return new Promise((resolve) => {
			const poll = () => {
				const now = performance.now();
				// 该表面自本次等待起（含给异步 commit 的宽限）未收到新更新请求 → 无需等它。
				const stale = now - this.lastRequestAt > 48 && now - startAt > 32;
				if (
					this.destroyed ||
					this.captureVersion > startedVersion ||
					now - startAt >= timeoutMs ||
					stale
				) {
					resolve();
					return;
				}
				requestAnimationFrame(poll);
			};
			requestAnimationFrame(poll);
		});
	}

	private onPaint(): void {
		if (this.captureFrame) {
			cancelAnimationFrame(this.captureFrame);
			this.captureFrame = 0;
		}
		if (this.destroyed || !this.captureCanvas || !this.context || !this.offscreen) return;
		const element = this.captureCanvas.firstElementChild;
		if (!element) return;
		try {
			const image = this.captureCanvas.captureElementImage!(element);
			try {
				this.context.reset();
				if (this.context.drawElementImage) {
					this.context.drawElementImage(image, 0, 0);
				} else {
					this.context.drawImage(image, 0, 0);
				}
				this.outputContext.clearRect(0, 0, this.outputCanvas.width, this.outputCanvas.height);
				this.outputContext.drawImage(this.offscreen, 0, 0);
				this.texture.needsUpdate = true;
				this.wantsRepaint = false;
				this.failedCaptures = 0;
				this.captureVersion += 1;
				let bounds: ContentBounds | null = null;
				if (this.needsContentBounds) {
					bounds = this.getContentBounds();
					// 空 DOM paint 不是完整承载面；保留测量请求，等下一帧真内容就绪。
					if (bounds) this.needsContentBounds = false;
				}
				// 纹理每帧仍要通知 R3F invalidate；null 仅表示 bounds 没有变化或尚不可用。
				this.onCaptured?.(bounds);
			} finally {
				image.close();
			}
		} catch (error) {
			if (this.destroyed) return;
			// DOM 刚变化后 Chromium 可能暂无可用 paint record（InvalidStateError）。
			// 短延迟重试一次，避免这一帧直接用旧纹理（闪动）；有界，防死循环。
			if (this.failedCaptures < 8) {
				this.failedCaptures += 1;
				this.wantsRepaint = false;
				requestAnimationFrame(() => {
					if (this.destroyed || this.failedCaptures === 0) return;
					this.wantsRepaint = true;
					this.captureCanvas?.requestPaint?.();
					this.scheduleCapture();
				});
			} else {
				this.wantsRepaint = false;
				console.warn("[DomContentSurface] capture failed repeatedly:", error);
			}
		}
	}

	/**
	 * 旧组件兼容：DOM root 可以铺满承载面，但选择区按可见 alpha 收紧。
	 * 新组件应使用 definition.getContentBounds，避免逐帧读取整张纹理。
	 */
	private getContentBounds(): ContentBounds | null {
		try {
			const { data, width, height } = this.outputContext.getImageData(
				0,
				0,
				this.outputCanvas.width,
				this.outputCanvas.height,
			);
			let minX = width;
			let minY = height;
			let maxX = -1;
			let maxY = -1;

			for (let y = 0; y < height; y += 1) {
				for (let x = 0; x < width; x += 1) {
					if (data[(y * width + x) * 4 + 3] <= 2) continue;
					minX = Math.min(minX, x);
					minY = Math.min(minY, y);
					maxX = Math.max(maxX, x);
					maxY = Math.max(maxY, y);
				}
			}

			// 空帧表示 Chromium 尚未提交 DOM paint record，不是一个铺满承载面的组件。
			// 返回 null 让上层保持上一次真实 bounds，彻底消除“整画布 ↔ 内容”横跳。
			if (maxX < minX || maxY < minY) return null;

			// 留出一个逻辑像素，避免抗锯齿边缘被裁掉。
			const pad = Math.max(1, Math.ceil(this.scale));
			const left = Math.max(0, minX - pad);
			const top = Math.max(0, minY - pad);
			const right = Math.min(width, maxX + 1 + pad);
			const bottom = Math.min(height, maxY + 1 + pad);
			return {
				x: left / this.scale,
				y: top / this.scale,
				width: (right - left) / this.scale,
				height: (bottom - top) / this.scale,
			};
		} catch {
			// 捕获源不可读时同样不伪造一个完整承载面的选择区。
			return null;
		}
	}

	dispose(): void {
		this.destroyed = true;
		if (this.captureFrame) cancelAnimationFrame(this.captureFrame);
		activeContentSurfaces.delete(this);
		this.texture.dispose();
		this.host.remove();
	}
}
