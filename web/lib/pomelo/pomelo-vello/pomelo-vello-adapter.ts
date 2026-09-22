/*
 * [INPUT]: 依赖 pomelo-core（PomeloRendererAdapter / PomeloBlock）、pomelo-tiles（TileController）、
 *          vello-rasterizer、op-bridge
 * [OUTPUT]: 对外提供 VelloRendererAdapter：pomelo 的渲染器适配层——接管 vdom diff/patch 后的 block 树，
 *           把 VelloBlock 的绘制 op 汇总成 chunk 交给 TileController 渲染（仅 vello/WebGPU）。
 *           拖拽内容会话（beginContentSession/endContentSession）：被拖块+随动箭头走 live 层，
 *           静态内容只在会话开始时渲染一次；视口/尺寸/结构变化自动结束会话回退整场渲染。
 *           direct 模式另有保留场景底图（controller.buildSceneBacking）：内容不变时平移/缩放贴底图。
 *           图片纹理按视口缩放/元素尺寸自适应分辨率：首次基准档 512，放大时 512→1024→2048→4096
 *           升档（复用缓存的源 Image 重栅格并原位替换纹理），避免放大发糊；
 *           加载失败（404/CORS/非图片）做负缓存，杜绝「渲染→失败→重渲染→再请求」请求风暴。
 *           WebGPU 不可用时不降级，抛 RendererUnsupportedError（带 reason）；wasm 产物缺失/设备初始化失败抛
 *           RendererInitError（reason=resource/device），由宿主区分提示「构建产物」还是「升级浏览器/开硬件加速」。
 * [POS]: pomelo-vello 的适配器实现（M2 接入层）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { PomeloRendererAdapter } from "../pomelo-core/pomelo-renderer/pomelo-renderer-adapter";
import type { IElement } from "../pomelo-core/pomelo-types/render.types";
import { TileController } from "../pomelo-core/pomelo-tiles/controller";
import type { RenderChunk, TileRasterizer, Viewport } from "../pomelo-core/pomelo-tiles/types";
import { VelloGpuRasterizer, VelloWasmLoadError, type VelloUnavailableReason } from "./vello-rasterizer";
import { encodeOps } from "./op-bridge";
import { VelloElement } from "./vello-element";
import { VelloBlock } from "./vello-block";

const FONT_ID = 1;
const CJK_FONT_ID = 3;

/** WebGPU/vello 运行环境不可用：不再降级 Canvas2D，宿主据此提示用户升级浏览器/开启硬件加速。 */
export class RendererUnsupportedError extends Error {
  readonly code = "RENDERER_UNSUPPORTED";
  constructor(message = "当前浏览器不支持 WebGPU，无法运行世界画布渲染器", readonly reason: VelloUnavailableReason = "no-webgpu") {
    super(message);
    this.name = "RendererUnsupportedError";
  }
}

/**
 * 运行环境本身可用，但渲染器初始化失败（产物缺失 / 设备初始化）：与「浏览器不支持 WebGPU」严格区分，
 * 宿主据此提示「构建 wasm 产物 / 重试」而非误导用户升级浏览器。
 */
export class RendererInitError extends Error {
  readonly code = "RENDERER_INIT_FAILED";
  constructor(message: string, readonly reason: "resource" | "device" = "device", readonly detail?: string) {
    super(message);
    this.name = "RendererInitError";
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

// 图片纹理分辨率档位（长边设备像素）：首次按基准档快速上屏，放大时逐档升级。
// 上限 4096 是 WebGPU 保证的最小 maxTextureDimension2D（8192）以内的安全值。
const IMAGE_TIERS = [512, 1024, 2048, 4096] as const;
const IMAGE_BASE_TIER = IMAGE_TIERS[0];

/** 源图长边自然像素。 */
function naturalLongSide(image: HTMLImageElement): number {
  return Math.max(image.naturalWidth || 0, image.naturalHeight || 0);
}

/** 按期望设备像素选择纹理档位；可选 naturalSide 避免升到超过源图本身的档位。 */
function imageTierFor(requiredPixels?: number, naturalSide?: number): number {
  const wanted = requiredPixels && requiredPixels > 0 ? requiredPixels : IMAGE_BASE_TIER;
  const cap = naturalSide && naturalSide > 0 ? Math.min(wanted, naturalSide) : wanted;
  for (const tier of IMAGE_TIERS) {
    if (cap <= tier) return tier;
  }
  return IMAGE_TIERS[IMAGE_TIERS.length - 1];
}

/** 把源图按目标长边档位画进 canvas 取 RGBA（不放大超过源图自身分辨率）。 */
function rasterizeImage(image: HTMLImageElement, tier: number): { width: number; height: number; data: Uint8Array } | null {
  const naturalW = image.naturalWidth || image.width || 1;
  const naturalH = image.naturalHeight || image.height || 1;
  const scale = Math.min(1, tier / Math.max(naturalW, naturalH));
  const width = Math.max(1, Math.round(naturalW * scale));
  const height = Math.max(1, Math.round(naturalH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, width, height);
  return { width, height, data: new Uint8Array(ctx.getImageData(0, 0, width, height).data) };
}


interface SyncedBlock {
  draw: number;
  position: number;
}

export interface VelloRendererAdapterOptions {
  background?: string;
  /**
   * 直绘模式：true = 每帧整场单 pass（无瓦片缝，但每帧整场重编码）；
   * false（缺省）= 瓦片管线：平移/缩放贴缓存旧瓦片（stale-zoom，<1ms）、落定后按预算补清晰层。
   */
  direct?: boolean;
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
  /** url → 已确认加载失败（非图片/404/CORS）；负缓存，避免反复请求。结构重建时清空以便重试。 */
  private readonly imageFailed = new Set<string>();
  private readonly imageSizes = new Map<number, { width: number; height: number }>();
  /** url → 已注册纹理的当前档位（长边设备像素）；用于按视口放大升档。 */
  private readonly imageTier = new Map<string, number>();
  /** url → 已解码的源 Image；升档时复用，避免重复下载。 */
  private readonly imageSources = new Map<string, HTMLImageElement>();
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
    const availability = await VelloGpuRasterizer.availability();
    if (!availability.ok) {
      throw new RendererUnsupportedError(undefined, availability.reason);
    }
    let rasterizer: TileRasterizer<unknown, unknown>;
    try {
      const gpu = await VelloGpuRasterizer.create(canvas, dpr, cssColorToRgba(background));
      await this.registerFonts(gpu);
      rasterizer = gpu as unknown as TileRasterizer<unknown, unknown>;
    } catch (error) {
      if (error instanceof VelloWasmLoadError) {
        throw new RendererInitError("世界画布渲染器资源未就绪", "resource", error.message);
      }
      throw new RendererInitError(`世界画布渲染器初始化失败：${error instanceof Error ? error.message : String(error)}`, "device");
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
      direct: this.options.direct ?? true,
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
      // 优先完整 CJK 字体（真实世界内容为中文）；缺失时回退到内置子集（仅 demo 字符），此时中文会大量丢字
      let cjk = await fetch("/vello-wasm/noto-sans-sc.otf");
      if (!cjk.ok) {
        console.warn(
          "[pomelo-vello-adapter] 缺少完整中文字体 public/vello-wasm/noto-sans-sc.otf，回退到内置子集（仅 demo 字符），真实中文内容会大量缺字。请运行 pnpm vello:setup 补齐。",
        );
        cjk = await fetch("/vello-wasm/noto-cjk-subset.otf");
      }
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

  /**
   * 拖拽内容会话：excludedBlockIds（被拖块 + 随动箭头）每帧走 live 层，
   * 其余静态内容只在会话开始时渲染一次。视口/尺寸/结构变化会自动结束会话。
   */
  beginContentSession(excludedBlockIds: string[]): void {
    this.controller?.beginContentSession(excludedBlockIds);
    this.dirty = true;
  }

  endContentSession(): void {
    if (!this.controller) return;
    this.controller.endContentSession();
    this.dirty = true;
  }

  setTransform(x: number, y: number, scale: number): void {
    if (!this.viewport) return;
    // 视口一动，静态快照失效：先结束内容会话，本帧回退整场渲染
    this.endContentSession();
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
    // 尺寸变化会让静态快照的整屏 quad 不再匹配，先结束会话
    this.endContentSession();
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
    // 结构变化（增/删 chunk）会让会话静态快照失效：结束后本帧回退整场渲染
    let structural = false;

    for (const id of this.removedBlocks) {
      if (this.synced.has(id)) {
        controller.removeChunk(id);
        this.synced.delete(id);
        changed = true;
        structural = true;
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
      const zIndex = block.zIndex;

      if (contentDirty) {
        const payload = { velloOps: encodeOps(block.ops) } as { velloOps: Uint8Array };
        if (!entry) {
          controller.addChunk({ id, nodeIds: [id], bounds, zIndex, estimatedCost, payload });
          this.synced.set(id, { draw: block.drawVersion, position: block.boundsVersion });
          structural = true;
        } else {
          controller.invalidateChunk(id, { bounds, zIndex, estimatedCost, payload });
          entry.draw = block.drawVersion;
          entry.position = block.boundsVersion;
        }
        changed = true;
      } else if (posDirty && entry) {
        controller.invalidateChunk(id, { bounds, zIndex });
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
        structural = true;
      }
    }

    if (structural) {
      this.controller?.endContentSession();
      // 文档结构重建（block 增删）→ 素材引用可能已变化：清空失败缓存，允许新 URL 重试。
      if (this.imageFailed.size > 0) this.imageFailed.clear();
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
    const result = controller.renderFrame({
      viewport: this.viewport,
      contentGeneration: this.contentGeneration,
      navigationGeneration: this.navigationGeneration,
      navigationActive: this.navigationActive,
    });
    // 底图分帧构建未完成时保持置脏，下一帧继续推进（避免一次性长任务）
    this.dirty = result.pending === true;
  }

  /** 把 http 图片异步注册为 image id（缓存）。未就绪返回 null；就绪后触发一帧重绘。
   *  requiredPixels：期望纹理长边设备像素。首次按基准档 512 快速上屏，随视口放大按档位
   *  （512→1024→2048→4096）用缓存的源 Image 重新栅格并替换纹理，保证放大不糊。 */
  ensureImage(url: string, requiredPixels?: number): number | null {
    if (!url) return null;
    const cached = this.imageIds.get(url);
    if (cached !== undefined) {
      const source = this.imageSources.get(url);
      const desired = imageTierFor(requiredPixels, source ? naturalLongSide(source) : undefined);
      const current = this.imageTier.get(url) ?? 0;
      // 只升不降：更高档位且当前空闲时，用已缓存的源图重栅格并替换纹理。
      if (desired > current && !this.imagePending.has(url) && source) {
        this.upgradeImage(url, source, desired);
      }
      return cached;
    }
    if (this.imageFailed.has(url)) return null;
    if (this.imagePending.has(url)) return null;
    this.imagePending.add(url);
    const id = this.nextImageId++;
    void (async () => {
      let ok = false;
      try {
        // vello(GPU) 需要 RGBA 上传纹理
        const source = await this.loadSource(url);
        if (source) {
          const tier = imageTierFor(requiredPixels, naturalLongSide(source));
          const loaded = rasterizeImage(source, tier);
          if (loaded) {
            this.imageSources.set(url, source);
            this.imageSizes.set(id, { width: loaded.width, height: loaded.height });
            this.imageTier.set(url, tier);
            (this.rasterizer as unknown as VelloGpuRasterizer).registerImage(id, loaded.width, loaded.height, loaded.data);
            this.imageIds.set(url, id);
            ok = true;
          }
        } else {
          console.warn("[pomelo-vello-adapter] image load failed", url);
        }
      } catch (error) {
        // 单张图失败不应影响渲染（可能 404 / CORS / 非图片），静默降级为占位
        console.warn("[pomelo-vello-adapter] image load failed", url, error);
      } finally {
        this.imagePending.delete(url);
        // 只有成功才触发重绘：失败重绘会让所有 block 再调 ensureImage 形成请求死循环。
        if (ok) this.refreshImageBlocks();
        else this.imageFailed.add(url);
      }
    })().catch(() => undefined);
    return null;
  }

  /** 已注册纹理随视口放大升档：重栅格后用**新 id** 注册（不注销旧纹理）。 */
  private upgradeImage(url: string, source: HTMLImageElement, tier: number): void {
    this.imagePending.add(url);
    void (async () => {
      // 让出当前调用栈：升档由 render 内同步触发，先挂起避免重入 refreshImageBlocks
      await Promise.resolve();
      let ok = false;
      try {
        const loaded = rasterizeImage(source, tier);
        if (loaded) {
          // 关键：不要复用同一个 image id。runtime.register_image 对同 id 会
          // renderer.unregister_texture(old)，而 WASM 运行时按 chunk 缓存了 Scene
          // （其中持有旧 ImageData 引用）；旧纹理一注销，下一次 backing 渲染就会
          // panic「invalid empty image (id: N)」。换新 id 让旧场景保持有效，旧纹理
          // 由运行时缓存继续持有（升档档位有限，泄漏可忽略）。
          const nextId = this.nextImageId++;
          this.imageSizes.set(nextId, { width: loaded.width, height: loaded.height });
          this.imageTier.set(url, tier);
          (this.rasterizer as unknown as VelloGpuRasterizer).registerImage(nextId, loaded.width, loaded.height, loaded.data);
          this.imageIds.set(url, nextId);
          ok = true;
        }
      } catch (error) {
        console.warn("[pomelo-vello-adapter] image upgrade failed", url, error);
      } finally {
        this.imagePending.delete(url);
        if (ok) {
          this.refreshImageBlocks();
        } else {
          // 升档失败也要落档位：否则 desired 恒大于 current，每次重绘都会再试 → 死循环。
          this.imageTier.set(url, tier);
        }
      }
    })().catch(() => undefined);
  }

  /** 图片就绪/升档后重跑所有 VelloBlock.render() 并同步 chunk（drawVersion 变化 → 瓦片重编码）。 */
  private refreshImageBlocks(): void {
    try {
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


  /** cover-fit 布局用的已注册图片尺寸。 */
  getImageSize(imageId: number): { width: number; height: number } | null {
    return this.imageSizes.get(imageId) ?? null;
  }

  /** 世界单位 → 图片纹理设备像素倍率（缩放 × 已含超采样的 dpr），供按视口自适应分辨率。 */
  getImagePixelRatio(): number {
    const dpr = this.viewport?.dpr ?? 1;
    const scale = this.transform?.scale || 1;
    return dpr * scale;
  }

  /**
   * 用 Image + canvas 取 RGBA。按序尝试：① 正常 CORS 加载；② CORS + cache-bust；
   * ③ 普通加载 + cache-bust。
   * ② 用于绕过被「无 ACAO 响应」污染的 HTTP 长缓存（面板 <img> 无 crossOrigin 会先写入
   * 不带 Access-Control-Allow-Origin 的缓存，随后画布 crossOrigin 请求命中即 CORS 失败；
   * service 已用 Vary: Origin 根治，这里对旧缓存做兼容恢复）。
   * ③ 覆盖本就不返回 CORS 头的来源；若画布被污染 getImageData 抛错，返回 null 降级为占位。
   */
  private async loadSource(url: string): Promise<HTMLImageElement | null> {
    const load = (crossOrigin: boolean, target: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        if (crossOrigin) image.crossOrigin = "anonymous";
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`image load failed: ${target}`));
        image.src = target;
      });
    const attempts: Array<{ crossOrigin: boolean; target: string }> = [
      { crossOrigin: true, target: url },
      { crossOrigin: true, target: withCacheBust(url) },
      { crossOrigin: false, target: withCacheBust(url) },
    ];
    for (const attempt of attempts) {
      try {
        const image = await load(attempt.crossOrigin, attempt.target);
        if (image.naturalWidth > 0 && image.naturalHeight > 0) return image;
      } catch {
        // 尝试下一种加载方式
      }
    }
    return null;
  }

  /** 循环渲染直到可见瓦片全覆盖（或上限）。用于首屏/导航结束/图片就绪后的确定性补偿。 */
  private settle(maxFrames = 120): void {
    if (!this.controller || !this.viewport) return;
    const direct = this.options.direct ?? false;
    const start = performance.now();
    for (let i = 0; i < maxFrames; i++) {
      this.flush(true);
      if (this.isCovered() && this.controller.scheduler.pending() === 0) return;
      // 瓦片模式：同步 settle 以约一帧预算为界，其余交给 ticker 逐帧补，避免首屏/导航落定长时间占满主线程
      if (!direct && performance.now() - start > 16) return;
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
    // 释放保留场景底图（纹理与合成绑定）
    (this.rasterizer as { endSceneBacking?: () => void } | null)?.endSceneBacking?.();
    this.rasterizer?.destroy();
    this.rasterizer = null;
    this.controller = null;
  }
}

export type { RenderChunk };
