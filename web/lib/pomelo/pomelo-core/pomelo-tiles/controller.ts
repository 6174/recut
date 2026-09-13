/*
 * [INPUT]: 依赖 types、geometry、planner、scheduler、tile-cache、chunk-index、telemetry
 * [OUTPUT]: 对外提供 TileController：每帧编排（双代推进/失效应用/plan/enqueue/按预算执行/合成），
 *           以及 chunk 增删改与 position/content 失效。open-pencil tiles/controller.ts 直译，
 *           光栅器经 TileRasterizer seam 注入（Canvas2D 或 vello）。
 * [POS]: pomelo-tiles 的编排核心；对上只暴露 renderFrame 与 chunk 操作，renderer 无关。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { SpatialChunkIndex } from "./chunk-index";
import {
  boundsIntersect,
  tileKeyString,
  tileLevel,
  tileWorldBounds,
  viewportWorldBounds,
} from "./geometry";
import { planTiles } from "./planner";
import { TileScheduler } from "./scheduler";
import { TileImageCache, DEFAULT_MAX_TILE_BYTES } from "./tile-cache";
import { TileTelemetry } from "./telemetry";
import type {
  CachedTile,
  RenderChunk,
  RenderedTile,
  TileJob,
  TileJobResult,
  TileKey,
  TileRasterizer,
  TileSchedulerMetrics,
  Viewport,
} from "./types";
import { emptyTileSchedulerMetrics } from "./scheduler";

export interface TileControllerOptions<TTarget, THandle> {
  pageId: string;
  rasterizer: TileRasterizer<TTarget, THandle>;
  maxCacheBytes?: number;
  budgetMs?: number;
  maxJobsPerFrame?: number;
  overscanTiles?: number;
  direct?: boolean;
}

export interface RenderFrameInput {
  viewport: Viewport;
  contentGeneration: number;
  navigationGeneration: number;
  navigationActive: boolean;
}

export interface TileFrameResult {
  covered: boolean;
  pending: boolean;
  presented: number;
  rendered: number;
  metrics: TileSchedulerMetrics;
}

interface PendingInvalidation {
  nodeId: string;
  previousBounds: ReturnType<typeof tileWorldBounds>[];
}

export class TileController<TTarget, THandle> {
  readonly index = new SpatialChunkIndex();
  readonly cache: TileImageCache<THandle>;
  readonly scheduler: TileScheduler;
  readonly telemetry = new TileTelemetry();

  private readonly pageId: string;
  private readonly rasterizer: TileRasterizer<TTarget, THandle>;
  private readonly overscanTiles: number;
  private readonly direct: boolean;
  private readonly budgetMs: number;
  private readonly measuredCosts = new Map<string, number>();
  private readonly pendingInvalidations: PendingInvalidation[] = [];
  private contentGeneration = -1;
  private navigationGeneration = -1;
  private cancelledJobs = 0;
  private renderedThisFrame = 0;

  constructor(options: TileControllerOptions<TTarget, THandle>) {
    this.pageId = options.pageId;
    this.rasterizer = options.rasterizer;
    this.overscanTiles = options.overscanTiles ?? 1;
    this.direct = options.direct ?? false;
    this.budgetMs = options.budgetMs ?? 5;
    this.cache = new TileImageCache<THandle>(
      options.maxCacheBytes ?? DEFAULT_MAX_TILE_BYTES,
      (handle) => this.rasterizer.disposeTile(handle),
    );
    this.scheduler = new TileScheduler({
      budgetMs: this.budgetMs,
      maximumJobsPerFrame: options.maxJobsPerFrame ?? 32,
    });
  }

  // ---- chunk 管理 ----

  addChunk(chunk: RenderChunk): void {
    this.index.addChunk(chunk);
    this.pendingInvalidations.push({ nodeId: chunk.nodeIds[0] ?? chunk.id, previousBounds: [chunk.bounds] });
  }

  removeChunk(id: string): void {
    const chunk = this.index.getChunk(id);
    if (!chunk) return;
    this.rasterizer.invalidateChunk?.(id);
    this.pendingInvalidations.push({ nodeId: chunk.nodeIds[0] ?? id, previousBounds: [chunk.bounds] });
    this.index.removeChunk(id);
  }

  /** 内容变更：重编码 chunk payload 后调用，失效其 bounds 相交的瓦片。 */
  invalidateChunk(id: string, patch: Partial<Pick<RenderChunk, "bounds" | "nodeIds" | "atomic" | "estimatedCost" | "payload">>): void {
    const chunk = this.index.getChunk(id);
    if (!chunk) return;
    this.rasterizer.invalidateChunk?.(id);
    this.pendingInvalidations.push({ nodeId: chunk.nodeIds[0] ?? id, previousBounds: [{ ...chunk.bounds }] });
    this.index.updateChunk(id, patch);
  }

  /** 位置变更：只改 bounds（O(1)、不重编码 payload），失效新旧 bounds 相交瓦片。 */
  moveChunk(id: string, dx: number, dy: number): boolean {
    const chunk = this.index.getChunk(id);
    if (!chunk) return false;
    const previous = { ...chunk.bounds };
    const next = {
      minX: previous.minX + dx,
      minY: previous.minY + dy,
      maxX: previous.maxX + dx,
      maxY: previous.maxY + dy,
    };
    this.index.updateChunk(id, { bounds: next });
    this.pendingInvalidations.push({ nodeId: chunk.nodeIds[0] ?? id, previousBounds: [previous] });
    return true;
  }

  invalidateStructure(): void {
    this.cancelledJobs += this.scheduler.clear();
    this.measuredCosts.clear();
    this.cache.clear();
    this.pendingInvalidations.length = 0;
    this.contentGeneration = -1;
  }

  // ---- 每帧 ----

  renderFrame(input: RenderFrameInput): TileFrameResult {
    const frameStart = performance.now();
    this.renderedThisFrame = 0;
    this.navigationGeneration = input.navigationGeneration;
    this.prepareGeneration(input.contentGeneration, input.navigationGeneration);

    const { viewport } = input;
    const level = tileLevel(viewport.zoom * viewport.dpr);
    const worldBounds = viewportWorldBounds(viewport.panX, viewport.panY, viewport.zoom, viewport.width, viewport.height);

    // 直绘模式：每帧整场渲染（chunk Scene 缓存 + 单次 render pass）；无瓦片边界/丢图问题
    if (this.direct && this.rasterizer.renderFrame) {
      const chunks = this.index.search(worldBounds);
      this.rasterizer.beginFrame(viewport);
      const handled = this.rasterizer.renderFrame(chunks, viewport);
      this.rasterizer.endFrame(viewport);
      if (handled) {
        this.scheduler.clear();
        const metrics = emptyTileSchedulerMetrics();
        this.telemetry.record(
          { contentGeneration: input.contentGeneration, navigationGeneration: input.navigationGeneration, navigationActive: input.navigationActive, metrics, tileCacheBytes: 0, tileCacheEntries: 0, visibleTileCount: chunks.length, presentedTileCount: chunks.length, covered: true, frameMs: performance.now() - frameStart },
          chunks.length,
        );
        return { covered: true, pending: false, presented: chunks.length, rendered: 0, metrics };
      }
    }

    // 导航期优先整场直绘兜底（无空洞）；瓦片在落定后（navigationActive=false）再补齐
    if (input.navigationActive && this.rasterizer.renderDirect) {
      const chunks = this.index.search(worldBounds);
      this.rasterizer.beginFrame(viewport);
      const handled = this.rasterizer.renderDirect(chunks, viewport);
      this.rasterizer.endFrame(viewport);
      if (handled) {
        this.scheduler.clear();
        const metrics = emptyTileSchedulerMetrics();
        this.telemetry.record(
          { contentGeneration: input.contentGeneration, navigationGeneration: input.navigationGeneration, navigationActive: true, metrics, tileCacheBytes: this.cache.byteSize(), tileCacheEntries: this.cache.size(), visibleTileCount: 0, presentedTileCount: 0, covered: false, frameMs: performance.now() - frameStart },
          0,
        );
        return { covered: false, pending: true, presented: 0, rendered: 0, metrics };
      }
    }

    const plan = planTiles(this.cache, {
      pageId: this.pageId,
      level,
      viewport: worldBounds,
      overscanTiles: this.overscanTiles,
      navigationGeneration: input.navigationGeneration,
      contentGeneration: input.contentGeneration,
      estimateCost: (key) => this.estimateCost(key),
      // 导航期没有全局底图可用 → 缺失瓦片标为 mandatory 立即补，避免整块空洞
      globalFallbackAvailable: !input.navigationActive,
    }, false);

    let metrics: TileSchedulerMetrics;
    if (input.navigationActive) {
      // 只立即执行「无 fallback 的缺失瓦片」（mandatory，通常少数）；有旧瓦片可贴的继续 defer
      const mandatory = plan.jobs.filter((job) => job.priority === "mandatory");
      this.scheduler.enqueue(mandatory);
      metrics = this.runScheduledFrame(level, input);
      metrics.skippedWithFallback += plan.jobs.length - mandatory.length;
    } else {
      this.scheduler.enqueue(plan.jobs);
      metrics = this.runScheduledFrame(level, input);
    }
    metrics.cancelledJobs += this.cancelledJobs;
    this.cancelledJobs = 0;

    // 关键：任务执行后重新查询缓存得到「当前可见瓦片」的真实状态；
    // 若沿用执行前的 plan.visible（那时 tile 多为 null），会把刚渲染好的瓦片当成缺失 → 空洞/残缺。
    const presentPlan = planTiles(this.cache, {
      pageId: this.pageId,
      level,
      viewport: worldBounds,
      overscanTiles: 0,
      navigationGeneration: input.navigationGeneration,
      contentGeneration: input.contentGeneration,
      estimateCost: () => 0,
    }, input.navigationActive);

    this.rasterizer.beginFrame(viewport);
    const { fallback, fresh } = this.collectPresentTiles(presentPlan.visible);
    const presented = fallback.length + fresh.length;
    this.rasterizer.present([...fallback, ...fresh], viewport);
    this.rasterizer.endFrame(viewport);

    const covered = presentPlan.visible.every(({ tile }) => tile?.contentGeneration === input.contentGeneration);
    const pending = this.scheduler.pending() > 0 || (!covered && !input.navigationActive);

    const frameMs = performance.now() - frameStart;
    this.telemetry.record(
      {
        contentGeneration: input.contentGeneration,
        navigationGeneration: input.navigationGeneration,
        navigationActive: input.navigationActive,
        metrics,
        tileCacheBytes: this.cache.byteSize(),
        tileCacheEntries: this.cache.size(),
        visibleTileCount: presentPlan.visible.length,
        presentedTileCount: presented,
        covered,
        frameMs,
      },
      this.renderedThisFrame,
    );

    return { covered, pending, presented, rendered: this.renderedThisFrame, metrics };
  }

  private prepareGeneration(contentGeneration: number, navigationGeneration: number): void {
    this.cancelledJobs += this.scheduler.setGeneration(navigationGeneration, contentGeneration);
    if (this.contentGeneration === contentGeneration) return;
    if (this.pendingInvalidations.length > 0) this.applyPendingInvalidations(contentGeneration);
    this.contentGeneration = contentGeneration;
  }

  private applyPendingInvalidations(contentGeneration: number): void {
    this.cache.advanceGeneration(contentGeneration);
    for (const invalidation of this.pendingInvalidations) {
      const chunks = this.index.getChunksDependingOnNode(invalidation.nodeId);
      const after = chunks.map((chunk) => chunk.bounds);
      for (const bounds of [...invalidation.previousBounds, ...after]) {
        this.cache.invalidateBounds(this.pageId, bounds, contentGeneration);
      }
    }
    this.pendingInvalidations.length = 0;
  }

  private runScheduledFrame(level: number, input: RenderFrameInput): TileSchedulerMetrics {
    return this.scheduler.runFrame((job) => this.executeJob(level, input, job));
  }

  private deferActiveJobs(jobs: TileJob[]): TileSchedulerMetrics {
    const metrics = emptyTileSchedulerMetrics();
    metrics.remaining = jobs.length;
    metrics.skippedWithFallback = jobs.filter((job) => job.fallbackAvailable).length;
    return metrics;
  }

  private executeJob(level: number, input: RenderFrameInput, job: TileJob): TileJobResult {
    const bounds = tileWorldBounds(job.key);
    const chunks = this.index.search(bounds);
    const target = this.rasterizer.beginTile(job.key, bounds, level, input.viewport.dpr);
    let rendered: RenderedTile<THandle>;
    try {
      for (const chunk of chunks) this.rasterizer.drawChunk(target, chunk);
      rendered = this.rasterizer.endTile(target);
      this.renderedThisFrame++;
    } catch (error) {
      // 失败兜底：不缓存，下一帧重试
      // eslint-disable-next-line no-console
      console.warn("[pomelo-tiles] tile render failed", error);
      return { renderMs: 0, overBudget: true, chunkCount: chunks.length };
    }

    const key = this.costKey(job.key);
    const previous = this.measuredCosts.get(key) ?? rendered.renderMs;
    this.measuredCosts.set(key, previous * 0.7 + rendered.renderMs * 0.3);

    if (job.navigationGeneration !== this.navigationGeneration || job.contentGeneration !== this.contentGeneration) {
      this.rasterizer.disposeTile(rendered.handle);
      return this.jobResult(rendered);
    }
    this.cache.install(rendered, job.contentGeneration);
    return this.jobResult(rendered);
  }

  private jobResult(tile: RenderedTile<THandle>): TileJobResult {
    return {
      renderMs: tile.renderMs,
      overBudget: tile.renderMs > this.budgetMs,
      allocationMs: tile.allocationMs,
      drawMs: tile.drawMs,
      flushMs: tile.flushMs,
      chunkCount: tile.chunkCount,
    };
  }

  private collectPresentTiles(visible: Array<{ key: TileKey; tile: CachedTile<THandle> | null }>): {
    fallback: CachedTile<THandle>[];
    fresh: CachedTile<THandle>[];
  } {
    const fresh: CachedTile<THandle>[] = [];
    const fallback: CachedTile<THandle>[] = [];
    const seen = new Set<string>();
    const gen = this.contentGeneration;
    const all = this.cache.values();

    for (const { key, tile } of visible) {
      if (tile && tile.contentGeneration === gen) {
        const id = tileKeyString(tile.key);
        if (!seen.has(id)) {
          seen.add(id);
          fresh.push(tile);
        }
        continue;
      }
      // 缺当前层：用任意层级中相交的瓦片缩放兜底（stale-zoom 预览）
      const bounds = tileWorldBounds(key);
      let best: CachedTile<THandle> | null = null;
      for (const candidate of all) {
        const id = tileKeyString(candidate.key);
        if (seen.has(id)) continue;
        if (!boundsIntersect(tileWorldBounds(candidate.key), bounds)) continue;
        if (!best || Math.abs(candidate.key.level - key.level) < Math.abs(best.key.level - key.level)) best = candidate;
      }
      if (best) {
        const id = tileKeyString(best.key);
        if (!seen.has(id)) {
          seen.add(id);
          fallback.push(best);
        }
      }
    }
    return { fallback, fresh };
  }

  private estimateCost(key: TileKey): number {
    const measured = this.measuredCosts.get(this.costKey(key));
    if (measured !== undefined) return measured;
    const chunks = this.index.search(tileWorldBounds(key));
    let cost = 0;
    for (const chunk of chunks) cost += chunk.estimatedCost;
    return cost;
  }

  private costKey(key: { level: number; x: number; y: number }): string {
    return `${key.level}:${key.x}:${key.y}`;
  }

  // ---- 调试 ----

  debugState() {
    return {
      contentGeneration: this.contentGeneration,
      navigationGeneration: this.navigationGeneration,
      chunks: this.index.size(),
      tiles: this.cache.size(),
      tileBytes: this.cache.byteSize(),
      pendingJobs: this.scheduler.pending(),
      pendingInvalidations: this.pendingInvalidations.length,
      metrics: this.telemetry.snapshot(),
    };
  }
}
