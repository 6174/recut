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
  private readonly imageSizes = new Map<number, { width: number; height: number }>();
  private readonly imageElements = new Map<number, HTMLImageElement>();
  private nextImageId = 10_000;
  private readonly options: VelloRendererAdapterOptions;
  private disposeTicker: { dispose(): void } | null = null;
  private contentGeneration = 0;
  private initialSettled = false;
  private navigationActive = false;
  private navTimer: ReturnType<typeof setTimeout> | null = null;
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
      direct: true,
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
      this.settle();
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
    const scaleChanged = this.transform.scale !== scale;
    this.viewport = { ...this.viewport, panX: x, panY: y, zoom: scale };
    this.transform = { x, y, scale };
    // 渲染器无关：overlay/宿主依赖此事件同步屏幕空间（选区框在缩放时必须立即跟随）
    this.onTransformEvent.emit({ x, y, scale });
    // zoom 常量 block（元素徽标等）在缩放变化时重绘，保持屏幕像素尺寸
    if (scaleChanged && this.rerenderZoomBlocks()) this.syncChunks();
    this.navigationGeneration++;
    // 导航期（平移/缩放）defer 瓦片重栅格：先贴旧瓦片缩放过渡，落定后再补高清，避免每次 wheel 重渲全部瓦片
    this.navigationActive = true;
    if (this.navTimer) clearTimeout(this.navTimer);
    this.navTimer = setTimeout(() => {
      this.navigationActive = false;
      this.navTimer = null;
      this.dirty = true;
      // 导航结束：确定性补齐所有瓦片（不依赖 ticker 时机）
      this.settle();
    }, 180);
    this.dirty = true;
  }

  /** 缩放变化时重绘声明了 renderOnZoom 的 block（供 zoom 常量视觉）。 */
  private rerenderZoomBlocks(): boolean {
    let rerendered = false;
    for (const block of this.renderedBlockMap.values()) {
      if (block instanceof VelloBlock && block.renderOnZoom) {
        block.render();
        rerendered = true;
      }
    }
    return rerendered;
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

  private isCovered(): boolean {
    return this.controller?.telemetry.snapshot().lastTrace?.covered ?? false;
  }

  private flush(): void {
    const controller = this.controller;
    if (!controller || !this.viewport) return;
    // 未 covered 也继续渲染（补偿确定性），直到瓦片补齐
    if (!this.dirty && controller.scheduler.pending() === 0 && this.isCovered()) return;
    controller.renderFrame({
      viewport: this.viewport,
      contentGeneration: this.contentGeneration,
      navigationGeneration: this.navigationGeneration,
      navigationActive: this.navigationActive,
    });
    this.dirty = false;
  }

  /** 把 http 图片异步注册为 image id（缓存）。未就绪返回 null；就绪后触发一帧重绘。 */
  ensureImage(url: string): number | null {
    if (!url) return null;
    const cached = this.imageIds.get(url);
    if (cached !== undefined) return cached;
    if (this.imagePending.has(url)) return null;
    this.imagePending.add(url);
    const id = this.nextImageId++;
    void (async () => {
      try {
        // vello(GPU) 需要 RGBA 上传纹理；Canvas2D 回退只需图片元素即可 drawImage
        const loaded = await this.loadImage(url, this.rasterizerName === "vello");
        if (loaded) {
          this.imageSizes.set(id, { width: loaded.width, height: loaded.height });
          this.imageElements.set(id, loaded.element);
          if (loaded.data) {
            (this.rasterizer as unknown as VelloGpuRasterizer).registerImage(id, loaded.width, loaded.height, loaded.data);
          }
          this.imageIds.set(url, id);
        }
      } catch (error) {
        // 单张图失败不应影响渲染（可能 404 / CORS / 非图片），静默降级为占位
        console.warn("[pomelo-vello-adapter] image load failed", url, error);
      } finally {
        this.imagePending.delete(url);
        try {
          // 图就绪后重跑所有 VelloBlock.render()（ensureImage 现在能返回 id），
          // 再 syncChunks 把 drawVersion 变化同步成 chunk（否则瓦片不会重编码，图不显示）。
          // 不在此显式 settle：ticker 每帧会 flush，多个图片同帧就绪只渲染一次，避免单帧多次整场渲染。
          for (const block of this.renderedBlockMap.values()) {
            if (block instanceof VelloBlock) block.render();
          }
          this.syncChunks();
        } catch (error) {
          console.warn("[pomelo-vello-adapter] image re-render failed", error);
        }
        this.dirty = true;
      }
    })().catch(() => undefined);
    return null;
  }

  /** cover-fit 布局用的已注册图片尺寸。 */
  getImageSize(imageId: number): { width: number; height: number } | null {
    return this.imageSizes.get(imageId) ?? null;
  }

  /** Canvas2D 回退绘制用的已加载图片元素。 */
  getImageElement(imageId: number): CanvasImageSource | null {
    return this.imageElements.get(imageId) ?? null;
  }

  /** 用 Image + canvas 取 RGBA（同源/跨域均先按 anonymous 尝试，失败再退化为普通加载）。 */
  private async loadImage(url: string, needRgba: boolean): Promise<{ element: HTMLImageElement; width: number; height: number; data: Uint8Array | null } | null> {
    const load = (crossOrigin: boolean) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        if (crossOrigin) image.crossOrigin = "anonymous";
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`image load failed: ${url}`));
        image.src = url;
      });

    let image: HTMLImageElement;
    try {
      image = await load(true);
    } catch {
      // 某些 URL 不接受 CORS 头时退化为普通加载（若画布因此被污染则下方 getImageData 会抛错并被吞掉）
      image = await load(false);
    }
    const maxSide = 512;
    const naturalW = image.naturalWidth || image.width || 1;
    const naturalH = image.naturalHeight || image.height || 1;
    const scale = Math.min(1, maxSide / Math.max(naturalW, naturalH));
    const width = Math.max(1, Math.round(naturalW * scale));
    const height = Math.max(1, Math.round(naturalH * scale));
    if (!needRgba) return { element: image, width, height, data: null };
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { element: image, width, height, data: null };
    ctx.drawImage(image, 0, 0, width, height);
    return { element: image, width, height, data: new Uint8Array(ctx.getImageData(0, 0, width, height).data) };
  }

  /** 循环渲染直到可见瓦片全覆盖（或上限）。用于首屏/导航结束/图片就绪后的确定性补偿。 */
  private settle(maxFrames = 120): void {
    if (!this.controller || !this.viewport) return;
    for (let i = 0; i < maxFrames; i++) {
      this.flush();
      if (this.isCovered() && this.controller.scheduler.pending() === 0) return;
    }
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
    if (this.navTimer) clearTimeout(this.navTimer);
    this.navTimer = null;
    this.disposeTicker?.dispose();
    this.disposeTicker = null;
    this.rasterizer?.destroy();
    this.rasterizer = null;
    this.controller = null;
  }
}

export type { RenderChunk };
