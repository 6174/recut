/*
 * [INPUT]: 无外部依赖
 * [OUTPUT]: 对外提供 PomeloTiles 的共享类型：瓦片标识/世界矩形/任务/度量/视口/渲染块/光栅器契约。
 * [POS]: pomelo-tiles 的类型地基；所有模块只依赖它，避免循环引用。renderer 无关（不 import vello/pixi）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export interface TileKey {
  pageId: string;
  level: number;
  x: number;
  y: number;
}

export interface TileWorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type TileJobPriority = "mandatory" | "visible" | "overscan";

export interface TileJob {
  key: TileKey;
  navigationGeneration: number;
  contentGeneration: number;
  priority: TileJobPriority;
  fallbackAvailable: boolean;
  estimatedCost: number;
}

export interface TileJobResult {
  renderMs: number;
  overBudget: boolean;
  allocationMs?: number;
  drawMs?: number;
  flushMs?: number;
  chunkCount?: number;
}

export interface TileSchedulerMetrics {
  mandatoryCompleted: number;
  interruptibleCompleted: number;
  remaining: number;
  skippedWithFallback: number;
  deadlineOverrunMs: number;
  overBudgetJobs: number;
  maximumJobRenderMs: number;
  staleJobsDiscarded: number;
  cancelledJobs: number;
  totalAllocationMs: number;
  totalDrawMs: number;
  totalFlushMs: number;
  totalChunks: number;
}

export interface Viewport {
  panX: number;
  panY: number;
  zoom: number;
  /** 逻辑（CSS）像素尺寸 */
  width: number;
  height: number;
  /** 设备像素比 */
  dpr: number;
}

/**
 * 一个渲染块：世界坐标 bounds + 光栅器私有 payload。
 * - payload 对 Canvas2D 光栅器是 (ctx) => void；对 vello 光栅器是绘制 op 列表。
 * - nodeIds 用于「block/节点 → chunk」反查失效。
 * - atomic=true 的块不能跨瓦片切分（含跨瓦片效果），整块渲到独立纹理再作为瓦片内容。
 */
export interface RenderChunk {
  id: string;
  nodeIds: string[];
  bounds: TileWorldBounds;
  atomic?: boolean;
  /** atomic chunk 的世界单位外扩（如 blur 溢出），渲染整块纹理时用。 */
  atomicPadding?: number;
  estimatedCost: number;
  payload: unknown;
}

/** 光栅化产物：句柄由光栅器定义（Canvas2D 为离屏画布；vello 为纹理句柄）。 */
export interface RenderedTile<THandle> {
  key: TileKey;
  handle: THandle;
  chunkCount: number;
  estimatedCost: number;
  renderMs: number;
  allocationMs?: number;
  drawMs?: number;
  flushMs?: number;
  bytes: number;
}

export interface CachedTile<THandle> {
  key: TileKey;
  handle: THandle;
  contentGeneration: number;
  lastUsed: number;
  bytes: number;
}

/**
 * 光栅器 seam：把瓦片算法与具体渲染后端解耦。
 * v1 实现 Canvas2D（dev/e2e + 无 WebGPU 降级）；vello 实现走同一接口。
 */
export interface TileRasterizer<TTarget, THandle> {
  readonly name: string;
  /** 开始一个瓦片：返回带世界→瓦片变换的绘制目标。 */
  beginTile(key: TileKey, bounds: TileWorldBounds, level: number, dpr: number): TTarget;
  /** 把一个渲染块画进当前瓦片（世界坐标）。 */
  drawChunk(target: TTarget, chunk: RenderChunk): void;
  /** 结束瓦片并产生产物。 */
  endTile(target: TTarget): RenderedTile<THandle>;
  /** 释放产物（缓存淘汰时调用）。 */
  disposeTile(handle: THandle): void;
  /** 可选：chunk 内容变化时的缓存失效（atomic chunk 纹理缓存等）。 */
  invalidateChunk?(id: string): void;
  /** 合成：把命中的瓦片（含 stale-zoom 缩放）贴到显示目标。 */
  present(tiles: CachedTile<THandle>[], viewport: Viewport): void;
  /** resize 显示目标。 */
  resize(width: number, height: number, dpr: number): void;
  /** 每帧合成前清背景。 */
  beginFrame(viewport: Viewport): void;
  /** 每帧合成结束。 */
  endFrame(viewport: Viewport): void;
  destroy(): void;
}
