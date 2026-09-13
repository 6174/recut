/*
 * [INPUT]: 依赖 pomelo-tiles/types
 * [OUTPUT]: 对外提供 VelloGpuRasterizer：TileRasterizer 的 vello(WASM/WebGPU) 实现 seam。
 *           当前为占位：真实实现需 pomelo-vello-wasm 构建产物（create_runtime）。未就绪时 isAvailable()=false，
 *           由 dev 页/宿主回退到 Canvas2DRasterizer。接口与 Canvas2DRasterizer 完全一致。
 * [POS]: pomelo-vello 的 GPU 光栅器（M1 目标），当前仅保留契约与加载路径。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { RenderChunk, RenderedTile, TileKey, TileRasterizer, TileWorldBounds, Viewport } from "../pomelo-core/pomelo-tiles/types";

export interface VelloRuntime {
  renderTile(key: TileKey, bounds: TileWorldBounds, level: number, dpr: number, chunks: RenderChunk[]): {
    handle: number;
    bytes: number;
    renderMs: number;
  };
  disposeTile(handle: number): void;
  present(tileHandles: number[], viewport: Viewport): void;
  beginFrame(viewport: Viewport): void;
  endFrame(viewport: Viewport): void;
  resize(width: number, height: number, dpr: number): void;
}

type VelloTarget = { key: TileKey; bounds: TileWorldBounds; level: number; chunks: RenderChunk[] };

/**
 * 真实 vello 光栅器。构造时需注入由 `pomelo-vello-wasm` 导出的 runtime。
 * 本仓库当前尚未构建该 crate，故 `isAvailable()` 返回 false。
 */
export class VelloGpuRasterizer implements TileRasterizer<VelloTarget, number> {
  readonly name = "vello";
  private runtime: VelloRuntime;

  constructor(runtime: VelloRuntime) {
    this.runtime = runtime;
  }

  static async isAvailable(): Promise<boolean> {
    return false;
  }

  resize(width: number, height: number, dpr: number): void {
    this.runtime.resize(width, height, dpr);
  }

  beginFrame(viewport: Viewport): void {
    this.runtime.beginFrame(viewport);
  }

  endFrame(viewport: Viewport): void {
    this.runtime.endFrame(viewport);
  }

  beginTile(key: TileKey, bounds: TileWorldBounds, level: number): VelloTarget {
    return { key, bounds, level, chunks: [] };
  }

  drawChunk(target: VelloTarget, chunk: RenderChunk): void {
    target.chunks.push(chunk);
  }

  endTile(target: VelloTarget): RenderedTile<number> {
    const result = this.runtime.renderTile(target.key, target.bounds, target.level, 1, target.chunks);
    return {
      key: target.key,
      handle: result.handle,
      chunkCount: target.chunks.length,
      estimatedCost: target.chunks.reduce((total, chunk) => total + chunk.estimatedCost, 0),
      renderMs: result.renderMs,
      bytes: result.bytes,
    };
  }

  disposeTile(handle: number): void {
    this.runtime.disposeTile(handle);
  }

  present(tiles: Array<{ key: TileKey; handle: number }>, viewport: Viewport): void {
    this.runtime.present(
      tiles.map((tile) => tile.handle),
      viewport,
    );
  }

  destroy(): void {
    // runtime 生命周期由宿主管理
  }
}
