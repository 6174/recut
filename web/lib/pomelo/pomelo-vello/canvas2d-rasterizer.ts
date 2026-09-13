/*
 * [INPUT]: 依赖 pomelo-tiles（types/geometry）
 * [OUTPUT]: 对外提供 Canvas2DRasterizer：TileRasterizer 的 Canvas2D 实现（dev/e2e + 无 WebGPU 降级）。
 *           每瓦片一个离屏 canvas（size + 2*bleed），世界坐标绘制，合成时裁掉 bleed 贴到主画布。
 * [POS]: pomelo-vello 的软件光栅器；与 VelloGpuRasterizer 同接口，可互换。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { TILE_BLEED_PX, TILE_DEVICE_SIZE, tileWorldBounds, tileWorldSize } from "../pomelo-core/pomelo-tiles/geometry";
import type {
  CachedTile,
  RenderChunk,
  RenderedTile,
  TileKey,
  TileRasterizer,
  TileWorldBounds,
  Viewport,
} from "../pomelo-core/pomelo-tiles/types";

interface CanvasTileTarget {
  key: TileKey;
  bounds: TileWorldBounds;
  level: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  size: number;
  chunkCount: number;
  estimatedCost: number;
  startedAt: number;
}

export interface CanvasTileHandle {
  canvas: HTMLCanvasElement;
  inner: { x: number; y: number; width: number; height: number };
  size: number;
}

export class Canvas2DRasterizer implements TileRasterizer<CanvasTileTarget, CanvasTileHandle> {
  readonly name = "canvas2d";
  private readonly display: CanvasRenderingContext2D;
  private dpr: number;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private renderedTiles = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly background = "#0b0f19",
    dpr = 1,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas2DRasterizer: 2d context unavailable");
    this.display = ctx;
    this.dpr = dpr;
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
  }

  beginFrame(_viewport: Viewport): void {
    this.display.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.display.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.display.fillStyle = this.background;
    this.display.fillRect(0, 0, this.viewportWidth, this.viewportHeight);
  }

  endFrame(_viewport: Viewport): void {
    // no-op
  }

  beginTile(key: TileKey, bounds: TileWorldBounds, level: number, _dpr: number): CanvasTileTarget {
    const size = TILE_DEVICE_SIZE + TILE_BLEED_PX * 2;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas2DRasterizer: tile context unavailable");
    // 世界 → 瓦片设备像素：scale(level)，再平移使 bounds.min 落在 (bleed, bleed)
    ctx.setTransform(level, 0, 0, level, -bounds.minX * level + TILE_BLEED_PX, -bounds.minY * level + TILE_BLEED_PX);
    ctx.clearRect(0, 0, size, size);
    return { key, bounds, level, canvas, ctx, size, chunkCount: 0, estimatedCost: 0, startedAt: performance.now() };
  }

  drawChunk(target: CanvasTileTarget, chunk: RenderChunk): void {
    const payload = chunk.payload as { canvas?: (ctx: CanvasRenderingContext2D) => void } | ((ctx: CanvasRenderingContext2D) => void) | undefined;
    const paint = typeof payload === "function" ? payload : payload?.canvas;
    if (typeof paint !== "function") return;
    target.ctx.save();
    try {
      paint(target.ctx);
    } finally {
      target.ctx.restore();
    }
    target.chunkCount++;
    target.estimatedCost += chunk.estimatedCost;
  }

  endTile(target: CanvasTileTarget): RenderedTile<CanvasTileHandle> {
    const size = target.size;
    return {
      key: target.key,
      handle: {
        canvas: target.canvas,
        inner: { x: TILE_BLEED_PX, y: TILE_BLEED_PX, width: TILE_DEVICE_SIZE, height: TILE_DEVICE_SIZE },
        size,
      },
      chunkCount: target.chunkCount,
      estimatedCost: target.estimatedCost,
      renderMs: performance.now() - target.startedAt,
      bytes: size * size * 4,
    };
  }

  disposeTile(handle: CanvasTileHandle): void {
    // 释放 GPU/内存：把离屏画布缩到 1px
    handle.canvas.width = 1;
    handle.canvas.height = 1;
  }

  renderDirect(chunks: RenderChunk[], viewport: Viewport): boolean {
    const ctx = this.display;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, this.viewportWidth, this.viewportHeight);
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(viewport.panX, viewport.panY);
    ctx.scale(viewport.zoom, viewport.zoom);
    for (const chunk of chunks) {
      const payload = chunk.payload as { canvas?: (c: CanvasRenderingContext2D) => void } | undefined;
      if (typeof payload?.canvas === "function") payload.canvas(ctx);
    }
    ctx.restore();
    return true;
  }

  renderFrame(chunks: RenderChunk[], viewport: Viewport): boolean {
    return this.renderDirect(chunks, viewport);
  }

  present(tiles: CachedTile<CanvasTileHandle>[], viewport: Viewport): void {
    const ctx = this.display;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    let drawn = 0;
    for (const tile of tiles) {
      const bounds = tileWorldBounds(tile.key);
      const worldSize = tileWorldSize(tile.key.level);
      const sx = bounds.minX * viewport.zoom + viewport.panX;
      const sy = bounds.minY * viewport.zoom + viewport.panY;
      const sw = worldSize * viewport.zoom;
      const sh = worldSize * viewport.zoom;
      if (sx + sw < -2 || sy + sh < -2 || sx > viewport.width + 2 || sy > viewport.height + 2) continue;
      const inner = tile.handle.inner;
      ctx.drawImage(tile.handle.canvas, inner.x, inner.y, inner.width, inner.height, sx, sy, sw, sh);
      drawn++;
    }
    this.renderedTiles = drawn;
  }

  destroy(): void {
    // no-op
  }

  stats() {
    return { presentedTiles: this.renderedTiles, dpr: this.dpr };
  }
}
