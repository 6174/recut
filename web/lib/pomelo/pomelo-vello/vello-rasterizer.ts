/*
 * [INPUT]: 依赖 pomelo-tiles/types、op-bridge
 * [OUTPUT]: 对外提供 VelloGpuRasterizer：TileRasterizer 的 vello(WASM/WebGPU) 实现。
 *           运行时经 /vello-wasm/*（wasm-pack 产物）动态加载；`isAvailable()` 检测 navigator.gpu + adapter。
 *           未就绪或加载失败时由宿主回退 Canvas2DRasterizer。
 * [POS]: pomelo-vello 的 GPU 光栅器实现（M1）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { RenderChunk, RenderedTile, TileKey, TileRasterizer, TileWorldBounds, Viewport } from "../pomelo-core/pomelo-tiles/types";

const WASM_JS_URL = "/vello-wasm/pomelo_vello_wasm.js";
const WASM_BIN_URL = "/vello-wasm/pomelo_vello_wasm_bg.wasm";
const TILE_DEVICE_SIZE = 256;

interface WasmRuntime {
  render_tile(ops: Uint8Array, level: number, minX: number, minY: number): number;
  dispose_tile(handle: number): void;
  present(handles: number[], panX: number, panY: number, zoom: number): void;
  resize(width: number, height: number): void;
  set_clear_color(r: number, g: number, b: number, a: number): void;
  width(): number;
  height(): number;
  debug_image_test(): void;
  debug_tile_test(): number;
  debug_ops_test(ops: Uint8Array, level: number, minX: number, minY: number): number;
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
    if (payload?.velloOps && payload.velloOps.length > 0) target.buffers.push(payload.velloOps);
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
