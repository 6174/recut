/*
 * [INPUT]: 依赖 pomelo-tiles/types、op-bridge
 * [OUTPUT]: 对外提供 VelloGpuRasterizer：TileRasterizer 的 vello(WASM/WebGPU) 实现。
 *           运行时经 /vello-wasm/*（wasm-pack 产物）动态加载；`isAvailable()` 检测 navigator.gpu + adapter。
 *           不可用时由宿主抛出 RendererUnsupportedError（不降级）。
 * [POS]: pomelo-vello 的 GPU 光栅器实现（M1）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { encodeOps } from "./op-bridge";
import type { RenderChunk, RenderedTile, TileKey, TileRasterizer, TileWorldBounds, Viewport } from "../pomelo-core/pomelo-tiles/types";

const WASM_JS_URL = "/vello-wasm/pomelo_vello_wasm.js";
const WASM_BIN_URL = "/vello-wasm/pomelo_vello_wasm_bg.wasm";
const TILE_DEVICE_SIZE = 256;

function hashChunk(id: string, ops: Uint8Array): number {
  let hash = 2166136261 ^ id.length;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  // 必须哈希全部字节：此前按 i += 7 抽样，坐标浮点的字节常落在采样点之外，
  // 平移/缩放后 key 不变 → WASM chunk_scenes 复用旧位置的 Scene，画面「抖到别处」。
  for (let i = 0; i < ops.length; i++) hash = Math.imul(hash ^ ops[i], 16777619);
  return hash >>> 0;
}

/** 由 chunk id 生成稳定且不与字体/图像 id 冲突的 u32。 */
function atomicImageId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1_000_000) + 100_000;
}

interface WasmRuntime {
  render_tile(ops: Uint8Array, level: number, minX: number, minY: number): number;
  dispose_tile(handle: number): void;
  present(handles: number[], panX: number, panY: number, zoom: number): void;
  resize(width: number, height: number): void;
  set_clear_color(r: number, g: number, b: number, a: number): void;
  width(): number;
  height(): number;
  register_font(id: number, bytes: Uint8Array): void;
  register_image(id: number, width: number, height: number, rgba: Uint8Array): void;
  set_font_fallback(id: number, fallbackId: number): void;
  render_atomic_chunk(imageId: number, ops: Uint8Array, level: number, minX: number, minY: number, width: number, height: number): void;
  render_direct(ops: Uint8Array, panX: number, panY: number, zoom: number, width: number, height: number): void;
  render_frame(chunks: Uint8Array, panX: number, panY: number, zoom: number, width: number, height: number): void;
  debug_image_test(): void;
  debug_tile_test(): number;
  debug_ops_test(ops: Uint8Array, level: number, minX: number, minY: number): number;
  debug_pair_test(): void;
  debug_registered_image_test(): number;
  debug_image_scene_at(level: number, minX: number, minY: number): number;
}

interface WasmModule {
  default(options: { module_or_path: string }): Promise<unknown>;
  create_runtime(canvas: HTMLCanvasElement): Promise<WasmRuntime>;
}

let modulePromise: Promise<WasmModule> | null = null;

async function loadModule(): Promise<WasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      // 运行时动态 import，绕过打包器对 wasm 产物的静态解析
      const dynamicImport = new Function("url", "return import(url)") as (url: string) => Promise<WasmModule>;
      const mod = await dynamicImport(WASM_JS_URL);
      await mod.default({ module_or_path: WASM_BIN_URL });
      return mod;
    })();
  }
  return modulePromise;
}

type VelloTarget = { key: TileKey; bounds: TileWorldBounds; level: number; buffers: Uint8Array[] };

export class VelloGpuRasterizer implements TileRasterizer<VelloTarget, number> {
  readonly name = "vello";
  private readonly runtime: WasmRuntime;
  private readonly canvas: HTMLCanvasElement;
  private dpr: number;
  private readonly atomicCache = new Map<string, number>();
  private lastOpsLength = 0;
  private lastChunkCount = 0;
  private maxOpsLength = 0;
  private nonEmptyTiles = 0;
  private totalTiles = 0;

  private constructor(runtime: WasmRuntime, canvas: HTMLCanvasElement, dpr: number) {
    this.runtime = runtime;
    this.canvas = canvas;
    this.dpr = dpr;
  }

  static async isAvailable(): Promise<boolean> {
    if (typeof navigator === "undefined" || !("gpu" in navigator)) return false;
    try {
      const adapter = await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter();
      return Boolean(adapter);
    } catch {
      return false;
    }
  }

  static async create(canvas: HTMLCanvasElement, dpr = 1, background: [number, number, number, number] = [11, 15, 25, 255]): Promise<VelloGpuRasterizer> {
    const mod = await loadModule();
    const runtime = await mod.create_runtime(canvas);
    runtime.set_clear_color(background[0], background[1], background[2], background[3]);
    return new VelloGpuRasterizer(runtime, canvas, dpr);
  }

  registerFont(id: number, bytes: Uint8Array): void {
    this.runtime.register_font(id, bytes);
  }

  registerImage(id: number, width: number, height: number, rgba: Uint8Array): void {
    this.runtime.register_image(id, width, height, rgba);
  }

  setFontFallback(id: number, fallbackId: number): void {
    this.runtime.set_font_fallback(id, fallbackId);
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    const deviceWidth = Math.max(1, Math.round(width * dpr));
    const deviceHeight = Math.max(1, Math.round(height * dpr));
    this.canvas.width = deviceWidth;
    this.canvas.height = deviceHeight;
    this.runtime.resize(deviceWidth, deviceHeight);
  }

  beginFrame(): void {
    // 背景 clear 在 runtime.present 内完成
  }

  endFrame(): void {
    // no-op
  }

  beginTile(key: TileKey, bounds: TileWorldBounds, level: number): VelloTarget {
    return { key, bounds, level, buffers: [] };
  }

  drawChunk(target: VelloTarget, chunk: RenderChunk): void {
    const payload = chunk.payload as { velloOps?: Uint8Array } | undefined;
    if (!payload?.velloOps || payload.velloOps.length === 0) return;
    if (chunk.atomic) {
      const padding = chunk.atomicPadding ?? 0;
      const key = `${chunk.id}@${target.level}`;
      let imageId = this.atomicCache.get(key);
      const boundWidth = chunk.bounds.maxX - chunk.bounds.minX + padding * 2;
      const boundHeight = chunk.bounds.maxY - chunk.bounds.minY + padding * 2;
      const minX = chunk.bounds.minX - padding;
      const minY = chunk.bounds.minY - padding;
      if (imageId === undefined) {
        imageId = atomicImageId(chunk.id);
        this.runtime.render_atomic_chunk(
          imageId,
          payload.velloOps,
          target.level,
          minX,
          minY,
          Math.max(1, Math.round(boundWidth * target.level)),
          Math.max(1, Math.round(boundHeight * target.level)),
        );
        this.atomicCache.set(key, imageId);
      }
      target.buffers.push(
        encodeOps([{ kind: "image", imageId, x: minX, y: minY, width: boundWidth, height: boundHeight }]),
      );
      return;
    }
    target.buffers.push(payload.velloOps);
  }

  invalidateChunk(id: string): void {
    for (const key of Array.from(this.atomicCache.keys())) {
      if (key.startsWith(`${id}@`)) this.atomicCache.delete(key);
    }
  }

  endTile(target: VelloTarget): RenderedTile<number> {
    let length = 0;
    for (const buffer of target.buffers) length += buffer.length;
    const ops = new Uint8Array(length);
    let offset = 0;
    for (const buffer of target.buffers) {
      ops.set(buffer, offset);
      offset += buffer.length;
    }
    const startedAt = performance.now();
    this.lastOpsLength = ops.length;
    this.lastChunkCount = target.buffers.length;
    this.totalTiles++;
    if (ops.length > this.maxOpsLength) this.maxOpsLength = ops.length;
    if (ops.length > 0) this.nonEmptyTiles++;
    const handle = this.runtime.render_tile(ops, target.level, target.bounds.minX, target.bounds.minY);
    return {
      key: target.key,
      handle,
      chunkCount: target.buffers.length,
      estimatedCost: target.buffers.length,
      renderMs: performance.now() - startedAt,
      bytes: TILE_DEVICE_SIZE * TILE_DEVICE_SIZE * 4,
    };
  }

  disposeTile(handle: number): void {
    this.runtime.dispose_tile(handle);
  }

  renderDirect(chunks: RenderChunk[], viewport: Viewport): boolean {
    let length = 0;
    const buffers: Uint8Array[] = [];
    for (const chunk of chunks) {
      const payload = chunk.payload as { velloOps?: Uint8Array } | undefined;
      if (payload?.velloOps && payload.velloOps.length > 0) {
        buffers.push(payload.velloOps);
        length += payload.velloOps.length;
      }
    }
    if (length === 0) return true;
    const ops = new Uint8Array(length);
    let offset = 0;
    for (const buffer of buffers) {
      ops.set(buffer, offset);
      offset += buffer.length;
    }
    const dpr = this.dpr;
    this.runtime.render_direct(
      ops,
      viewport.panX * dpr,
      viewport.panY * dpr,
      viewport.zoom * dpr,
      Math.max(1, Math.round(viewport.width * dpr)),
      Math.max(1, Math.round(viewport.height * dpr)),
    );
    return true;
  }

  renderFrame(chunks: RenderChunk[], viewport: Viewport): boolean {
    // 每 chunk 记录 [u64 key][u32 len][bytes]；key 含内容哈希，内容变则缓存失效
    let total = 0;
    const parts: Array<{ key: number; ops: Uint8Array }> = [];
    for (const chunk of chunks) {
      const payload = chunk.payload as { velloOps?: Uint8Array } | undefined;
      const ops = payload?.velloOps;
      if (!ops || ops.length === 0) continue;
      parts.push({ key: hashChunk(chunk.id, ops), ops });
      total += 12 + ops.length;
    }
    if (parts.length === 0) return true;
    const stream = new Uint8Array(total);
    const view = new DataView(stream.buffer);
    let offset = 0;
    for (const part of parts) {
      view.setBigUint64(offset, BigInt(part.key), true);
      view.setUint32(offset + 8, part.ops.length, true);
      stream.set(part.ops, offset + 12);
      offset += 12 + part.ops.length;
    }
    const dpr = this.dpr;
    this.runtime.render_frame(stream, viewport.panX * dpr, viewport.panY * dpr, viewport.zoom * dpr, Math.max(1, Math.round(viewport.width * dpr)), Math.max(1, Math.round(viewport.height * dpr)));
    return true;
  }

  present(tiles: Array<{ handle: number }>, viewport: Viewport): void {
    this.presentHandles(tiles.map((tile) => tile.handle), viewport);
  }

  presentHandles(handles: number[], viewport: Viewport): void {
    const dpr = this.dpr;
    this.runtime.present(handles, viewport.panX * dpr, viewport.panY * dpr, viewport.zoom * dpr);
  }

  /** 调试：渲染一张已知红色纹理，隔离图像合成链路。 */
  debugImageTest(): void {
    this.runtime.debug_image_test();
  }

  debugTileTest(): number {
    return this.runtime.debug_tile_test();
  }

  debugRenderOps(ops: Uint8Array, level: number, minX: number, minY: number): number {
    return this.runtime.debug_ops_test(ops, level, minX, minY);
  }

  debugPairTest(): void {
    this.runtime.debug_pair_test();
  }

  debugRegisteredImageTest(): number {
    return this.runtime.debug_registered_image_test();
  }

  debugImageSceneAt(level: number, minX: number, minY: number): number {
    return this.runtime.debug_image_scene_at(level, minX, minY);
  }

  stats(): { name: string; lastOpsLength: number; lastChunkCount: number; maxOpsLength: number; nonEmptyTiles: number; totalTiles: number } {
    return {
      name: this.name,
      lastOpsLength: this.lastOpsLength,
      lastChunkCount: this.lastChunkCount,
      maxOpsLength: this.maxOpsLength,
      nonEmptyTiles: this.nonEmptyTiles,
      totalTiles: this.totalTiles,
    };
  }

  destroy(): void {
    // runtime 生命周期由页面持有；canvas 由宿主管理
  }
}
