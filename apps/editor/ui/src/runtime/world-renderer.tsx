/**
 * [INPUT]: 依赖 VisualRuntime 的世界帧求值与 WorldScene 的 R3F 渲染能力。
 * [OUTPUT]: 对外提供 WorldRenderer、常规渲染与同 context 的隔离帧快照；读帧前等待视觉媒体。
 * [POS]: runtime 的 renderer 宿主；预览、导出和缩略图共用其世界渲染契约。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { createRoot, type Root } from "react-dom/client";
import type { FrameRate } from "@/wasm";
import { VisualRuntime } from "./world-runtime";
import { WorldScene } from "./world-scene";
import { activeContentSurfaces } from "./components/html-surface";
import { waitForVisualMediaFrames } from "./texture";
import type { World, WorldFrame } from "./types";

interface SnapshotRequest {
	id: number;
	world: World;
	frame: WorldFrame;
	resolve: (dataUrl: string | null) => void;
}

/**
 * 世界渲染器：保留 ThreeRenderer 的 render({world, time}) 契约，供预览/导出/缩略图复用。
 * 底层完全交给 R3F：世界对象即场景对象，材质/深度/光照由 three 统一处理。
 */
export class WorldRenderer {
	width: number;
	height: number;
	fps: FrameRate;

	private host: HTMLDivElement;
	private root: Root;
	private canvas: HTMLCanvasElement;
	private runtime = new VisualRuntime();
	private world: World | null = null;
	private frame: WorldFrame = { time: 0, objects: [] };
	private snapshotRequest: SnapshotRequest | null = null;
	private snapshotQueue: SnapshotRequest[] = [];
	private nextSnapshotId = 1;
	private disposed = false;

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
	}

	private renderCanvas() {
		if (!this.world || this.disposed) return;
		this.root.render(
			<WorldScene
				world={this.world}
				frame={this.frame}
				canvas={this.canvas}
				snapshot={this.snapshotRequest}
				onSnapshotComplete={this.completeSnapshot}
			/>,
		);
	}

	private completeSnapshot = (id: number, dataUrl: string | null): void => {
		const request = this.snapshotRequest;
		if (!request || request.id !== id) return;
		this.snapshotRequest = null;
		request.resolve(dataUrl);
		// 移除 portal 中的临时场景与 DOM surface；主预览的 world/frame 从未变化。
		this.renderCanvas();
		this.pumpSnapshotQueue();
	};

	/** R3F 只有一个 snapshot pass；排队是并发 preview.batch 的确定性边界。 */
	private pumpSnapshotQueue(): void {
		if (this.disposed || this.snapshotRequest || this.snapshotQueue.length === 0) return;
		this.snapshotRequest = this.snapshotQueue.shift() ?? null;
		this.renderCanvas();
	}

	getCanvas(): HTMLCanvasElement {
		return this.canvas;
	}

	getOutputCanvas(): HTMLCanvasElement {
		return this.getCanvas();
	}

	/**
	 * 在常驻 WebGL context 内渲染一份隔离的帧快照。
	 * 该 pass 使用独立 Scene + WebGLRenderTarget，不重设播放头、不替换预览场景，
	 * 也不会向 node registry 注册临时对象，因此不会干扰选择框或交互命中。
	 */
	async captureFrameDataUrl({
		world,
		time,
	}: {
		world: World;
		time: number;
	}): Promise<string | null> {
		if (this.disposed || !this.world) return null;
		const snapshotRuntime = new VisualRuntime();
		snapshotRuntime.load(world);
		const frame = snapshotRuntime.evaluate(time);
		snapshotRuntime.dispose();

		return new Promise<string | null>((resolve) => {
			this.snapshotQueue.push({
				id: this.nextSnapshotId++,
				world,
				frame,
				resolve,
			});
			this.pumpSnapshotQueue();
		});
	}

	async renderToCanvas({
		world,
		time,
		targetCanvas,
	}: {
		world: World;
		time: number;
		targetCanvas: HTMLCanvasElement;
	}) {
		await this.render({ world, time });
		const ctx = targetCanvas.getContext("2d");
		if (!ctx) return;
		ctx.drawImage(this.getCanvas(), 0, 0, targetCanvas.width, targetCanvas.height);
	}

	async render({
		world,
		time,
		waitForDraw = true,
	}: {
		world: World;
		time: number;
		/** true：等待纹理捕获 + 当前帧出图（导出/快照读帧需要）。预览传 false 即时返回，元素跟随交互更跟手。 */
		waitForDraw?: boolean;
	}) {
		this.runtime.load(world);
		this.world = world;
		this.frame = this.runtime.evaluate(time);
		this.renderCanvas();
		if (!waitForDraw) return;
		// 1) 等 html/react 承载面把当前帧的 DOM 捕获为纹理（texture 就绪），
		//    避免读到上一帧旧纹理导致成片闪动（对齐 remotion-kit delayRender 语义）。
		await Promise.all(
			[...activeContentSurfaces].map((surface) => surface.waitForCapture()),
		);
		await waitForVisualMediaFrames();
		// 2) 捕获完成即触发 invalidate，同一帧已调度重绘；再等一帧兜底确保绘制完成
		//    （导出读帧需要）。逐帧只等 1 rAF，尽可能贴近实时。
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	}

	setSize({ width, height }: { width: number; height: number }) {
		if (width === this.width && height === this.height) return;
		this.width = width;
		this.height = height;
		this.canvas.width = width;
		this.canvas.height = height;
		this.host.style.width = `${width}px`;
		this.host.style.height = `${height}px`;
		this.renderCanvas();
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.snapshotRequest?.resolve(null);
		this.snapshotRequest = null;
		for (const request of this.snapshotQueue.splice(0)) request.resolve(null);
		this.runtime.dispose();
		this.root.unmount();
		this.host.remove();
	}
}
