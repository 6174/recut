/*
 * [INPUT]: 依赖 pomelo-core（PomeloRendererAdapter / PomeloBlock）、pomelo-tiles（TileController）、
 *          canvas2d-rasterizer、vello-rasterizer、op-bridge
 * [OUTPUT]: 对外提供 VelloRendererAdapter：pomelo 的渲染器适配层——接管 vdom diff/patch 后的 block 树，
 *           把 VelloBlock 的绘制 op 汇总成 chunk 交给 TileController 瓦片渲染；vello(WebGPU) 可用时优先，
 *           否则回退 Canvas2DRasterizer。
 * [POS]: pomelo-vello 的适配器实现（M2 接入层）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { PomeloRendererAdapter } from "../pomelo-core/pomelo-renderer/pomelo-renderer-adapter";
import type { IElement } from "../pomelo-core/pomelo-types/render.types";
import { TileController } from "../pomelo-core/pomelo-tiles/controller";
import type { RenderChunk, TileRasterizer, Viewport } from "../pomelo-core/pomelo-tiles/types";
import { Canvas2DRasterizer } from "./canvas2d-rasterizer";
import { VelloGpuRasterizer } from "./vello-rasterizer";
import { encodeOps } from "./op-bridge";
import { VelloElement } from "./vello-element";
import { VelloBlock } from "./vello-block";

const FONT_ID = 1;
const CJK_FONT_ID = 3;

interface SyncedBlock {
  draw: number;
  position: number;
}

export interface VelloRendererAdapterOptions {
  /** 优先尝试 vello(WebGPU)；不可用时回退 Canvas2D。默认 true。 */
  preferGpu?: boolean;
  background?: string;
}

export class VelloRendererAdapter extends PomeloRendererAdapter {
  canvas: HTMLCanvasElement | null = null;
  controller: TileController<unknown, unknown> | null = null;
  rasterizerName = "none";
  viewport: Viewport | null = null;

  private rasterizer: TileRasterizer<unknown, unknown> | null = null;
  private readonly synced = new Map<string, SyncedBlock>();
  private readonly dirtyBlocks = new Set<string>();
  private readonly movedBlocks = new Set<string>();
  private readonly removedBlocks = new Set<string>();
  private readonly imageIds = new Map<string, number>();
  private readonly imagePending = new Set<string>();
  private nextImageId = 10_000;
  private readonly options: VelloRendererAdapterOptions;
  private disposeTicker: { dispose(): void } | null = null;
  private contentGeneration = 0;
  private initialSettled = false;
  private navigationGeneration = 0;
  private dirty = true;

  constructor(options: VelloRendererAdapterOptions = {}) {
    super();
    this.options = options;
  }

  async onInit(renderer: Parameters<PomeloRendererAdapter["onInit"]>[0]): Promise<void> {
    super.onInit(renderer);
    const container = this.editor.getContainerDom();
    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);
    this.canvas = canvas;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let rasterizer: TileRasterizer<unknown, unknown> | null = null;
    if (this.options.preferGpu !== false) {
      try {
        if (await VelloGpuRasterizer.isAvailable()) {
          const gpu = await VelloGpuRasterizer.create(canvas, dpr);
          await this.registerFonts(gpu);
          rasterizer = gpu as unknown as TileRasterizer<unknown, unknown>;
        }
      } catch (error) {
        console.warn("[pomelo-vello-adapter] vello unavailable, falling back to Canvas2D", error);
        rasterizer = null;
      }
    }
    if (!rasterizer) {
      rasterizer = new Canvas2DRasterizer(canvas, this.options.background ?? "#0b0f19", dpr) as unknown as TileRasterizer<unknown, unknown>;
    }
    this.rasterizer = rasterizer;
    this.rasterizerName = rasterizer.name;

    const width = Math.max(1, container.clientWidth || 800);
    const height = Math.max(1, container.clientHeight || 600);
    rasterizer.resize(width, height, dpr);
    this.viewport = { panX: 0, panY: 0, zoom: 1, width, height, dpr };
    this.controller = new TileController<unknown, unknown>({
      pageId: this.editor.state.rootBlockId ?? "pomelo-vello",
      rasterizer,
      budgetMs: 5,
      maxJobsPerFrame: 32,
    });
    // BlockPatcher 广播失效 → 只处理受影响的 block（增量），避免全量扫描比对
    this.onBlockInvalidated = (blockId, kind) => {
      if (kind === "content") this.dirtyBlocks.add(blockId);
      else if (kind === "position") this.movedBlocks.add(blockId);
      else this.removedBlocks.add(blockId);
      this.dirty = true;
    };
    this.disposeTicker = this.editor.ticker.add(() => this.flush(), "update");
  }

  private async registerFonts(gpu: VelloGpuRasterizer): Promise<void> {
    try {
      let latin: Uint8Array | null = null;
      const latinResponse = await fetch("/vello-wasm/space-grotesk.ttf");
      if (latinResponse.ok) {
        latin = new Uint8Array(await latinResponse.arrayBuffer());
        gpu.registerFont(FONT_ID, latin);
      }
      // 优先完整 CJK 字体（真实世界内容为中文）；缺失时回退到内置子集（仅 demo 字符）
      let cjk = await fetch("/vello-wasm/noto-sans-sc.otf");
      if (!cjk.ok) cjk = await fetch("/vello-wasm/noto-cjk-subset.otf");
      if (cjk.ok) {
        gpu.registerFont(CJK_FONT_ID, new Uint8Array(await cjk.arrayBuffer()));
        if (latin) gpu.setFontFallback(FONT_ID, CJK_FONT_ID);
      }
    } catch (error) {
      console.warn("[pomelo-vello-adapter] font load failed", error);
    }
  }

  createIElement(tag: string, block: Parameters<PomeloRendererAdapter["createIElement"]>[1], props?: Record<string, unknown>): IElement {
    return new VelloElement(tag, block, props);
  }

  render(): void {
    super.render();
    this.syncChunks();
    // 首次挂载做一次有界「settle」：循环渲染直到可见瓦片全覆盖（或上限），保证首屏完整，
    // 不依赖 ticker 是否被触发（此前首屏可能只画了部分瓦片）。
    if (!this.initialSettled && this.controller && this.viewport) {
      this.initialSettled = true;
      for (let i = 0; i < 60; i++) {
        this.flush();
        const trace = this.controller.telemetry.snapshot().lastTrace;
        if (trace?.covered && this.controller.scheduler.pending() === 0) break;
      }
    }
  }

  getView(): HTMLCanvasElement | null {
    return this.canvas;
  }

  getScreenSize(): { width: number; height: number } {
    return { width: this.viewport?.width ?? this.containerSize.width, height: this.viewport?.height ?? this.containerSize.height };
  }

  invalidate(): void {
    this.dirty = true;
  }

  setTransform(x: number, y: number, scale: number): void {
    if (!this.viewport) return;
    this.viewport = { ...this.viewport, panX: x, panY: y, zoom: scale };
    this.transform = { x, y, scale };
    this.navigationGeneration++;
    this.dirty = true;
  }

  setContainerSize(width: number, height: number): void {
    if (!this.rasterizer || !this.viewport) return;
    this.rasterizer.resize(width, height, this.viewport.dpr);
    this.viewport = { ...this.viewport, width, height };
    this.dirty = true;
  }

  /** vdom patch 后，把 VelloBlock 的绘制同步成 chunk（增量：区分内容变更与位置变更）。 */
  private syncChunks(): void {
    const controller = this.controller;
    if (!controller) return;
    let changed = false;

    for (const id of this.removedBlocks) {
      if (this.synced.has(id)) {
        controller.removeChunk(id);
        this.synced.delete(id);
        changed = true;
      }
    }
    this.removedBlocks.clear();

    const active = new Set<string>();
    for (const block of this.renderedBlockMap.values()) {
      if (!(block instanceof VelloBlock)) continue;
      const id = block.record.id;
      active.add(id);
      const entry = this.synced.get(id);
      const contentDirty = !entry || this.dirtyBlocks.has(id) || entry.draw !== block.drawVersion;
      const boundsChanged = entry ? entry.position !== block.boundsVersion : false;
      const posDirty = !contentDirty && (boundsChanged || this.movedBlocks.has(id));
      const bounds = block.bounds;
      const estimatedCost = bounds.maxX - bounds.minX + (bounds.maxY - bounds.minY);

      if (contentDirty) {
        const payload = { velloOps: encodeOps(block.ops), canvas: block.canvasPainter } as {
          velloOps: Uint8Array;
          canvas?: (ctx: CanvasRenderingContext2D) => void;
        };
        if (!entry) {
          controller.addChunk({ id, nodeIds: [id], bounds, estimatedCost, payload });
          this.synced.set(id, { draw: block.drawVersion, position: block.boundsVersion });
        } else {
          controller.invalidateChunk(id, { bounds, estimatedCost, payload });
          entry.draw = block.drawVersion;
          entry.position = block.boundsVersion;
        }
        changed = true;
      } else if (posDirty && entry) {
        controller.invalidateChunk(id, { bounds });
        entry.position = block.boundsVersion;
        changed = true;
      }
    }
    this.dirtyBlocks.clear();
    this.movedBlocks.clear();

    for (const id of Array.from(this.synced.keys())) {
      if (!active.has(id)) {
        controller.removeChunk(id);
        this.synced.delete(id);
        changed = true;
      }
    }

    if (changed) {
      this.contentGeneration++;
      this.dirty = true;
    }
  }

  private flush(): void {
    const controller = this.controller;
    if (!controller || !this.viewport) return;
    if (!this.dirty && controller.scheduler.pending() === 0) return;
    controller.renderFrame({
      viewport: this.viewport,
      contentGeneration: this.contentGeneration,
      navigationGeneration: this.navigationGeneration,
      navigationActive: false,
    });
    this.dirty = false;
  }

  /** 把 http 图片异步注册为 image id（缓存）。未就绪返回 null；就绪后触发一帧重绘。 */
  ensureImage(url: string): number | null {
    if (!url) return null;
    const cached = this.imageIds.get(url);
    if (cached !== undefined) return cached;
    if (this.imagePending.has(url)) return null;
    if (this.rasterizerName !== "vello") return null;
    this.imagePending.add(url);
    const id = this.nextImageId++;
    void (async () => {
      try {
        // 用 Image + canvas 加载（与 pixi 路径一致，避免 fetch/CORS 差异），再取 RGBA 注册为 image
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.decoding = "async";
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("image decode failed"));
          image.src = url;
        });
        const maxSide = 512;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
        const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
        const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.drawImage(image, 0, 0, width, height);
        const rgba = new Uint8Array(ctx.getImageData(0, 0, width, height).data);
        (this.rasterizer as unknown as VelloGpuRasterizer).registerImage(id, width, height, rgba);
        this.imageIds.set(url, id);
      } finally {
        this.imagePending.delete(url);
        // 图就绪后重跑所有 VelloBlock.render()（ensureImage 现在能返回 id），
        // 再 syncChunks 把 drawVersion 变化同步成 chunk（否则瓦片不会重编码，图不显示）
        for (const block of this.renderedBlockMap.values()) {
          if (block instanceof VelloBlock) block.render();
        }
        this.syncChunks();
        this.dirty = true;
      }
    })();
    return null;
  }

  /** 调试：立即渲染一帧（跳过 ticker 合帧）。 */
  renderNow(): void {
    this.dirty = true;
    this.flush();
  }

  /** 调试/测试钩子。 */
  debugState() {
    return {
      rasterizer: this.rasterizerName,
      viewport: this.viewport,
      contentGeneration: this.contentGeneration,
      chunks: this.controller?.index.size() ?? 0,
      images: this.imageIds.size,
      imagePending: this.imagePending.size,
      tiles: this.controller?.debugState().tiles ?? 0,
      telemetry: this.controller?.telemetry.snapshot() ?? null,
    };
  }

  destroy(): void {
    this.disposeTicker?.dispose();
    this.disposeTicker = null;
    this.rasterizer?.destroy();
    this.rasterizer = null;
    this.controller = null;
  }
}

export type { RenderChunk };
