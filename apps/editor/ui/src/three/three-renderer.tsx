import { createRoot, type Root } from "react-dom/client";
import type { AnyBaseNode } from "@/services/renderer/nodes/base-node";
import { resolveRenderTree } from "@/services/renderer/resolve";
import type { FrameRate } from "@/wasm";
import { EditorCanvas } from "./editor-canvas";
import { buildRenderModel, type RenderModel } from "./render-model";

interface Coordinator {
	resolve: (() => void) | null;
	reject: ((error: unknown) => void) | null;
}

/**
 * R3F 渲染器：宿主一个声明式 EditorCanvas（frameloop="never"），
 * 保留 CanvasRenderer.render({node,time}) 契约供预览/导出/缩略图复用。
 * 逐帧：resolve 节点树 → buildRenderModel（扁平层列表）→ React 提交 → 合成器 runComposite。
 */
export class ThreeRenderer {
	width: number;
	height: number;
	fps: FrameRate;

	private host: HTMLDivElement;
	private root: Root;
	private canvas: HTMLCanvasElement;
	private model: RenderModel = { background: null, layers: [] };
	private coordinator: Coordinator = { resolve: null, reject: null };

	constructor({ width, height, fps }: { width: number; height: number; fps: FrameRate }) {
		this.width = width;
		this.height = height;
		this.fps = fps;

		this.canvas = document.createElement("canvas");
		this.canvas.width = width;
		this.canvas.height = height;

		this.host = document.createElement("div");
		this.host.style.cssText = `position:absolute;left:-99999px;top:0;width:${width}px;height:${height}px;overflow:hidden;pointer-events:none;`;
		document.body.appendChild(this.host);

		this.root = createRoot(this.host);
		this.renderCanvas();
	}

	private renderCanvas() {
		this.root.render(
			<EditorCanvas
				layers={this.model.layers}
				width={this.width}
				height={this.height}
				background={this.model.background}
				canvas={this.canvas}
				onComposited={() => {
					const resolve = this.coordinator.resolve;
					this.coordinator.resolve = null;
					this.coordinator.reject = null;
					resolve?.();
				}}
				onError={(error) => {
					const reject = this.coordinator.reject;
					this.coordinator.resolve = null;
					this.coordinator.reject = null;
					reject?.(error);
				}}
			/>,
		);
	}

	getCanvas(): HTMLCanvasElement {
		return this.canvas;
	}

	getOutputCanvas(): HTMLCanvasElement {
		return this.getCanvas();
	}

	async renderToCanvas({
		node,
		time,
		targetCanvas,
	}: {
		node: AnyBaseNode;
		time: number;
		targetCanvas: HTMLCanvasElement;
	}) {
		await this.render({ node, time });
		const ctx = targetCanvas.getContext("2d");
		if (!ctx) return;
		ctx.drawImage(this.getCanvas(), 0, 0, targetCanvas.width, targetCanvas.height);
	}

	async render({ node, time }: { node: AnyBaseNode; time: number }) {
		try {
			await resolveRenderTree({ node, renderer: this, time });
			this.model = buildRenderModel({
				root: node,
				width: this.width,
				height: this.height,
			});

			const composite = new Promise<void>((resolve, reject) => {
				this.coordinator.resolve = resolve;
				this.coordinator.reject = reject;
			});
			this.renderCanvas();
			await composite;
		} finally {
			this.coordinator.resolve = null;
			this.coordinator.reject = null;
		}
	}

	setSize({ width, height }: { width: number; height: number }) {
		if (width === this.width && height === this.height) return;
		this.width = width;
		this.height = height;
		this.host.style.width = `${width}px`;
		this.host.style.height = `${height}px`;
		this.renderCanvas();
	}

	dispose() {
		this.root.unmount();
		this.host.remove();
	}
}
