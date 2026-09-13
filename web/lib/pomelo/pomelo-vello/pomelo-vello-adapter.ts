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
  private readonly options: VelloRendererAdapterOptions;
  private disposeTicker: { dispose(): void } | null = null;
  private contentGeneration = 0;
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
      const cjkResponse = await fetch("/vello-wasm/noto-cjk-subset.otf");
      if (cjkResponse.ok) {
        gpu.registerFont(CJK_FONT_ID, new Uint8Array(await cjkResponse.arrayBuffer()));
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
  }

  setTransform(x: number, y: number, scale: number): void {
    if (!this.viewport) return;
    this.viewport = { ...this.viewport, panX: x, panY: y, zoom: scale };
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
    const active = new Set<string>();
    let changed = false;

    for (const block of this.renderedBlockMap.values()) {
      if (!(block instanceof VelloBlock)) continue;
      const id = block.record.id;
      active.add(id);
      const entry = this.synced.get(id);
      const payload = { velloOps: encodeOps(block.ops), canvas: block.canvasPainter } as { velloOps: Uint8Array; canvas?: (ctx: CanvasRenderingContext2D) => void };
      if (!entry) {
        controller.addChunk({
          id,
          nodeIds: [id],
          bounds: block.bounds,
          estimatedCost: block.bounds.maxX - block.bounds.minX + (block.bounds.maxY - block.bounds.minY),
          payload,
        });
        this.synced.set(id, { draw: block.drawVersion, position: block.boundsVersion });
        changed = true;
      } else if (entry.draw !== block.drawVersion) {
        controller.invalidateChunk(id, {
          bounds: block.bounds,
          estimatedCost: block.bounds.maxX - block.bounds.minX + (block.bounds.maxY - block.bounds.minY),
          payload,
        });
        entry.draw = block.drawVersion;
        entry.position = block.boundsVersion;
        changed = true;
      } else if (entry.position !== block.boundsVersion) {
        controller.invalidateChunk(id, { bounds: block.bounds });
        entry.position = block.boundsVersion;
        changed = true;
      }
    }

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
