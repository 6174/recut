/*
 * [INPUT]: 依赖 pomelo-core（PomeloRendererAdapter / PomeloBlock）、pomelo-tiles（TileController）、
 *          vello-rasterizer、op-bridge
 * [OUTPUT]: 对外提供 VelloRendererAdapter：pomelo 的渲染器适配层——接管 vdom diff/patch 后的 block 树，
 *           把 VelloBlock 的绘制 op 汇总成 chunk 交给 TileController 瓦片渲染（仅 vello/WebGPU）。
 *           WebGPU 不可用时不降级，抛 RendererUnsupportedError，由宿主提示用户升级浏览器。
 * [POS]: pomelo-vello 的适配器实现（M2 接入层）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { PomeloRendererAdapter } from "../pomelo-core/pomelo-renderer/pomelo-renderer-adapter";
import type { IElement } from "../pomelo-core/pomelo-types/render.types";
import { TileController } from "../pomelo-core/pomelo-tiles/controller";
import type { RenderChunk, TileRasterizer, Viewport } from "../pomelo-core/pomelo-tiles/types";
import { VelloGpuRasterizer } from "./vello-rasterizer";
import { encodeOps } from "./op-bridge";
import { VelloElement } from "./vello-element";
import { VelloBlock } from "./vello-block";

const FONT_ID = 1;
const CJK_FONT_ID = 3;

/** WebGPU/vello 运行环境不可用：不再降级 Canvas2D，宿主据此提示用户升级浏览器。 */
export class RendererUnsupportedError extends Error {
  readonly code = "RENDERER_UNSUPPORTED";
  constructor(message = "当前浏览器不支持 WebGPU，无法运行世界画布渲染器") {
    super(message);
    this.name = "RendererUnsupportedError";
  }
}

/** 把任意 CSS 颜色（含 oklch）解析为 RGBA 字节；无效时回退深色。 */
function cssColorToRgba(color: string, fallback: [number, number, number, number] = [11, 15, 25, 255]): [number, number, number, number] {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return fallback;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return [data[0], data[1], data[2], data[3]];
  } catch {
    return fallback;
  }
}

/** 解析容器祖先链上第一个非透明背景色（对齐 pixi 透明画布透出的主题背景）。 */
function resolveBackgroundColor(container: HTMLElement): string {
  let node: HTMLElement | null = container;
  while (node) {
    const color = getComputedStyle(node).backgroundColor;
    const rgba = cssColorToRgba(color, [0, 0, 0, 0]);
    if (rgba[3] > 0) return color;
    node = node.parentElement;
  }
  return "#0b0f19";
}

/** http(s) URL 追加一次性 cache-bust 查询参数；data:/blob: 等保持原样。 */
function withCacheBust(url: string): string {
  if (!/^https?:/i.test(url)) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}pomeloImageBust=${Date.now().toString(36)}`;
}

interface SyncedBlock {
  draw: number;
  position: number;
}

export interface VelloRendererAdapterOptions {
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
  private nextImageId = 10_000;
  private readonly options: VelloRendererAdapterOptions;
  private disposeTicker: { dispose(): void } | null = null;
  private contentGeneration = 0;
  private initialSettled = false;
  private navigationActive = false;
  private navTimer: ReturnType<typeof setTimeout> | null = null;
  private navigationGeneration = 0;
  /** 最近一次实际渲染所在 ticker 帧（同帧去重）。 */
  private lastFlushFrame = -1;
  /** 实际 renderFrame 次数（调试/验证用）。 */
  private renderCount = 0;
  private dirty = true;
  /** 缩放变化待重绘 zoom 常量 block（合并到帧内一次，见 setTransform）。 */
  private zoomBlocksDirty = false;

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

    // 超采样：vello 的 Area AA 在低 DPI 下对细线/小字边缘偏硬，直接放大画布背板
    // （渲染分辨率 = CSS × dpr，浏览器按 CSS 尺寸显示时做线性降采样）以获得平滑边缘。
    // ?ss=1 可关闭（省 GPU），?ss=3 可更强。
    const superSample = (() => {
      try {
        const value = Number(new URLSearchParams(window.location.search).get("ss"));
        if (Number.isFinite(value) && value >= 1 && value <= 4) return value;
      } catch {
        // ignore
      }
      return 2;
    })();
    const dpr = Math.min((window.devicePixelRatio || 1) * superSample, 3);
    // 背景色对齐 pixi（透明画布透出主题背景）：解析容器祖先链的有效背景色
    const background = this.options.background ?? resolveBackgroundColor(container);
    if (!(await VelloGpuRasterizer.isAvailable())) {
      throw new RendererUnsupportedError();
    }
    let rasterizer: TileRasterizer<unknown, unknown>;
    try {
      const gpu = await VelloGpuRasterizer.create(canvas, dpr, cssColorToRgba(background));
      await this.registerFonts(gpu);
      rasterizer = gpu as unknown as TileRasterizer<unknown, unknown>;
    } catch (error) {
      throw new RendererUnsupportedError(`WebGPU 初始化失败：${error instanceof Error ? error.message : String(error)}`);
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
    // zoom 常量 block（元素徽标等）需按新缩放重绘；此处只打标，合并到 ticker 帧内执行一次，
    // 避免每个 wheel/pointermove 事件都同步重编码全部 renderOnZoom block（主线程被占满 → 丢事件）。
    if (scaleChanged) this.zoomBlocksDirty = true;
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
    // 同步补一帧：resize 会清空画布背板，若等下一个 rAF 才绘制，窗口缩放时会闪一帧空白
    this.renderNow();
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
        const payload = { velloOps: encodeOps(block.ops) } as { velloOps: Uint8Array };
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

  private flush(force = false): void {
    const controller = this.controller;
    if (!controller || !this.viewport) return;
    // 帧节流：同一 ticker 帧内无论被触发多少次（doc 变更 / transform / 图片就绪 / invalidate），
    // 只渲染最新一次。force=true 用于初始化/导航落定/resize 等确定性路径。
    const frame = this.editor.ticker.frameId;
    if (!force && this.lastFlushFrame === frame) return;
    // 未 covered 也继续渲染（补偿确定性），直到瓦片补齐
    if (!this.dirty && controller.scheduler.pending() === 0 && this.isCovered()) return;
    this.lastFlushFrame = frame;
    // 缩放变化：帧内一次重绘 zoom 常量 block 并把 drawVersion 变化同步成 chunk（此前分散在事件回调里逐次执行）
    if (this.zoomBlocksDirty) {
      this.zoomBlocksDirty = false;
      this.rerenderZoomBlocks();
      this.syncChunks();
    }
    this.renderCount++;
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
        // vello(GPU) 需要 RGBA 上传纹理
        const loaded = await this.loadImage(url);
        if (loaded) {
          this.imageSizes.set(id, { width: loaded.width, height: loaded.height });
          (this.rasterizer as unknown as VelloGpuRasterizer).registerImage(id, loaded.width, loaded.height, loaded.data);
          this.imageIds.set(url, id);
        } else {
          console.warn("[pomelo-vello-adapter] image load failed", url);
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

  /**
   * 用 Image + canvas 取 RGBA。按序尝试：① 正常 CORS 加载；② CORS + cache-bust；
   * ③ 普通加载 + cache-bust。
   * ② 用于绕过被「无 ACAO 响应」污染的 HTTP 长缓存（面板 <img> 无 crossOrigin 会先写入
   * 不带 Access-Control-Allow-Origin 的缓存，随后画布 crossOrigin 请求命中即 CORS 失败；
   * service 已用 Vary: Origin 根治，这里对旧缓存做兼容恢复）。
   * ③ 覆盖本就不返回 CORS 头的来源；若画布被污染 getImageData 抛错，返回 null 降级为占位。
   */
  private async loadImage(url: string): Promise<{ width: number; height: number; data: Uint8Array } | null> {
    const load = (crossOrigin: boolean, target: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        if (crossOrigin) image.crossOrigin = "anonymous";
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`image load failed: ${target}`));
        image.src = target;
      });
    const read = (image: HTMLImageElement): { width: number; height: number; data: Uint8Array } | null => {
      const maxSide = 512;
      const naturalW = image.naturalWidth || image.width || 1;
      const naturalH = image.naturalHeight || image.height || 1;
      const scale = Math.min(1, maxSide / Math.max(naturalW, naturalH));
      const width = Math.max(1, Math.round(naturalW * scale));
      const height = Math.max(1, Math.round(naturalH * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0, width, height);
      return { width, height, data: new Uint8Array(ctx.getImageData(0, 0, width, height).data) };
    };
    const attempts: Array<{ crossOrigin: boolean; target: string }> = [
      { crossOrigin: true, target: url },
      { crossOrigin: true, target: withCacheBust(url) },
      { crossOrigin: false, target: withCacheBust(url) },
    ];
    for (const attempt of attempts) {
      try {
        const image = await load(attempt.crossOrigin, attempt.target);
        const data = read(image);
        if (data) return data;
      } catch {
        // 尝试下一种加载方式
      }
    }
    return null;
  }

  /** 循环渲染直到可见瓦片全覆盖（或上限）。用于首屏/导航结束/图片就绪后的确定性补偿。 */
  private settle(maxFrames = 120): void {
    if (!this.controller || !this.viewport) return;
    for (let i = 0; i < maxFrames; i++) {
      this.flush(true);
      if (this.isCovered() && this.controller.scheduler.pending() === 0) return;
    }
  }

  /** 调试/测试：立即强制渲染一帧（跳过同帧节流）。 */
  renderNow(): void {
    this.dirty = true;
    this.flush(true);
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
      frameId: this.editor.ticker.frameId,
      renderCount: this.renderCount,
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
