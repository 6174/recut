import * as THREE from "three";
import { FONT_SIZE_SCALE_REFERENCE } from "@/text/typography";

/**
 * 原生 HTML-in-Canvas（WICG canvas-draw-element flag）文字纹理。
 * 模式同 remotion-kit HtmlSurface：layoutSubtree canvas 承载真实 DOM 文字，
 * paint 事件 → captureElementImage → drawElementImage → 纹理。
 *
 * 与 remotion-kit 的差异：纹理 image 用**普通 HTMLCanvasElement**（drawElementImage
 * 在普通 2D context 上同样可用）。经实测 OffscreenCanvas 直接作为 three CanvasTexture
 * 的 image 上传到 GPU 会得到黑色，普通 canvas 则可靠。
 */

export interface DomTextParams {
	text: string;
	fontSize: number;
	fontFamily: string;
	fillColor: string;
	textAlign?: "left" | "center" | "right";
	fontWeight?: number | string;
	fontStyle?: string;
	letterSpacing?: number;
	lineHeight?: number;
	strokeColor?: string;
	strokeWidth?: number;
}

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

/** HTML-in-Canvas 特性检测（Chrome 149+，需 chrome://flags/#canvas-draw-element）。 */
export function isHtmlInCanvasSupported(): boolean {
	if (typeof document === "undefined") return false;
	try {
		const canvas = document.createElement("canvas") as HicCanvas;
		const ctx = canvas.getContext("2d") as unknown as HicContext | null;
		return (
			typeof canvas.captureElementImage === "function" &&
			typeof canvas.layoutSubtree === "boolean" &&
			typeof ctx?.drawElementImage === "function"
		);
	} catch {
		return false;
	}
}

function textKey(params: DomTextParams, width: number, height: number): string {
	return `${width}x${height}|${params.text}|${params.fontSize}|${params.fontFamily}|${params.fillColor}|${params.textAlign ?? "center"}|${params.fontWeight ?? 400}|${params.fontStyle ?? "normal"}|${params.letterSpacing ?? 0}|${params.lineHeight ?? 0}|${params.strokeColor ?? ""}|${params.strokeWidth ?? 0}`;
}

function applyStyles(el: HTMLElement, params: DomTextParams, width: number, height: number) {
	// opencut 语义：scaledFontSize = fontSize × canvasHeight / 90；lineHeight 为倍数；letterSpacing 不缩放
	const scaledFontSize = params.fontSize * (height / FONT_SIZE_SCALE_REFERENCE);
	const lineHeightPx = scaledFontSize * (params.lineHeight ?? 1.2);
	const scaledStrokeWidth =
		params.strokeWidth && params.strokeWidth > 0
			? params.strokeWidth * (height / FONT_SIZE_SCALE_REFERENCE)
			: 0;
	const strokeStyle =
		scaledStrokeWidth > 0 && params.strokeColor
			? `-webkit-text-stroke:${scaledStrokeWidth}px ${params.strokeColor};paint-order:stroke fill;`
			: "";
	el.style.cssText = [
		"position:absolute",
		"left:0",
		"top:0",
		`width:${width}px`,
		`height:${height}px`,
		"display:flex",
		"align-items:center",
		`justify-content:${params.textAlign === "left" ? "flex-start" : params.textAlign === "right" ? "flex-end" : "center"}`,
		`font-family:${params.fontFamily}`,
		`font-size:${scaledFontSize}px`,
		`font-weight:${params.fontWeight ?? 400}`,
		`font-style:${params.fontStyle ?? "normal"}`,
		`letter-spacing:${params.letterSpacing ?? 0}px`,
		`line-height:${lineHeightPx}px`,
		`color:${params.fillColor}`,
		`text-align:${params.textAlign ?? "center"}`,
		strokeStyle,
		"white-space:pre-wrap",
		"overflow:hidden",
	].join(";");
}

export class DomTextSurface {
	texture: THREE.CanvasTexture;
	/** update() 请求了 paint 但尚未捕获（用于触发一次补合成）。 */
	wantsRepaint = false;
	/** 每次捕获成功后回调（对齐 remotion-kit 的 captureVersion → invalidate）。 */
	onCaptured: (() => void) | null = null;
	private captureCanvas: HicCanvas | null = null;
	private offscreen: OffscreenCanvas | null = null;
	private context: HicContext | null = null;
	private outputCanvas: HTMLCanvasElement;
	private outputContext: CanvasRenderingContext2D;
	private element: HTMLDivElement;
	private host: HTMLDivElement;
	private key = "";
	private destroyed = false;

	constructor(width: number, height: number) {
		this.captureCanvas = document.createElement("canvas") as HicCanvas;
		this.captureCanvas.width = width;
		this.captureCanvas.height = height;
		this.captureCanvas.layoutSubtree = true;

		// 隐藏宿主：屏上、被合成（chromium 才触发 paint），但必须低到合成后不可察觉
		// （0.011 会把铺满画布的不透明文字/内容以 1.1% 合成到 App 背景上，肉眼可见）。
		this.host = document.createElement("div");
		this.host.style.cssText = `position:fixed;left:0;top:0;z-index:99999;opacity:0.001;pointer-events:none;width:${width}px;height:${height}px;`;
		document.body.appendChild(this.host);
		this.host.appendChild(this.captureCanvas);

		this.element = document.createElement("div");
		this.captureCanvas.appendChild(this.element);

		// capture：transferControlToOffscreen + drawElementImage（remotion-kit 路径）
		this.offscreen = this.captureCanvas.transferControlToOffscreen();
		this.context = this.offscreen.getContext("2d") as unknown as HicContext | null;

		// 纹理输出：普通 HTML canvas（OffscreenCanvas 直接作为 three 纹理 image 上传会得黑色）
		this.outputCanvas = document.createElement("canvas");
		this.outputCanvas.width = width;
		this.outputCanvas.height = height;
		this.outputContext = this.outputCanvas.getContext("2d")!;

		this.texture = new THREE.CanvasTexture(this.outputCanvas);
		this.texture.colorSpace = THREE.NoColorSpace;
		this.texture.minFilter = THREE.LinearFilter;
		this.texture.magFilter = THREE.LinearFilter;
		this.texture.flipY = true;

		this.captureCanvas.addEventListener("paint", () => this.onPaint());
	}

	private onPaint() {
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
				// 复制到普通 canvas 作为纹理 image（避免 OffscreenCanvas 上传问题）
				this.outputContext.clearRect(0, 0, this.outputCanvas.width, this.outputCanvas.height);
				this.outputContext.drawImage(this.offscreen, 0, 0);
				this.texture.needsUpdate = true;
				this.wantsRepaint = false;
				this.onCaptured?.();
			} finally {
				image.close();
			}
		} catch (error) {
			console.warn("[DomTextSurface] capture failed:", error);
			this.wantsRepaint = false;
		}
	}

	/** 内容/样式变化才请求重绘（requestPaint）。 */
	update(params: DomTextParams, width: number, height: number): void {
		const nextKey = textKey(params, width, height);
		if (nextKey !== this.key) {
			this.key = nextKey;
			applyStyles(this.element, params, width, height);
			this.element.textContent = params.text;
			this.wantsRepaint = true;
			this.captureCanvas?.requestPaint?.();
		}
	}

	dispose() {
		this.destroyed = true;
		this.texture.dispose();
		this.host.remove();
	}
}
