/*
 * [INPUT]: 依赖 types、geometry、planner、scheduler、tile-cache、chunk-index、telemetry
 * [OUTPUT]: 对外提供 TileController：每帧编排（双代推进/失效应用/plan/enqueue/按预算执行/合成），
 *           以及 chunk 增删改与 position/content 失效；direct 模式下支持：
 *           - 保留场景底图（buildSceneBacking/presentSceneBacking/beginSceneBacking/stepSceneBacking：
 *             内容不变时平移/缩放只贴一张自适应底图纹理；覆盖不足时贴旧底图占位并**分帧增量**重建，
 *             内容变化时**一次性**重建以避免闪现旧画面；对齐 open-pencil sceneBacking）；
 *           - 拖拽内容会话（beginContentSession/endContentSession：静态内容只渲一次，会话帧只重渲 live chunks）。
 *           open-pencil tiles/controller.ts 直译，光栅器经 TileRasterizer seam 注入（vello）。
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
  /** 拖拽内容会话：静态内容渲染一次后复用；会话帧只重渲被拖块（含随动箭头）。 */
  private contentSession: { excluded: Set<string>; started: boolean } | null = null;
  /** 保留场景底图对应的 contentGeneration；用于判断底图是否可复用。 */
  private backingGeneration = -1;
  /** 分帧底图构建状态（构建期间旧底图继续用于呈现）。 */
  private backingBuildActive = false;
  private backingBuildGeneration = -1;
  /** 底图设备像素预算（对齐 open-pencil 16M）与最大超采样倍率、每帧构建预算。 */
  private static readonly BACKING_MAX_DEVICE_PIXELS = 16_000_000;
  private static readonly BACKING_MAX_SCALE = 3;
  private static readonly BACKING_BUILD_BUDGET_MS = 2;

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
  invalidateChunk(id: string, patch: Partial<Pick<RenderChunk, "bounds" | "nodeIds" | "atomic" | "estimatedCost" | "payload" | "zIndex">>): void {
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
    this.endContentSession();
    this.rasterizer.endSceneBacking?.();
    this.backingGeneration = -1;
    this.backingBuildActive = false;
    this.backingBuildGeneration = -1;
    this.cancelledJobs += this.scheduler.clear();
    this.measuredCosts.clear();
    this.cache.clear();
    this.pendingInvalidations.length = 0;
    this.contentGeneration = -1;
  }

  /**
   * 底图视口：以当前视口为中心，按像素预算放大（scale = clamp(sqrt(16M/视口设备像素), 1, 3)），
   * 多出的一圈作为平移 margin。对齐 open-pencil `sceneBackingGeometry`。
   */
  private backingViewport(viewport: Viewport): Viewport {
    const viewportPixels = Math.max(1, viewport.width * viewport.height * viewport.dpr * viewport.dpr);
    const scale = Math.min(
      TileController.BACKING_MAX_SCALE,
      Math.max(1, Math.sqrt(TileController.BACKING_MAX_DEVICE_PIXELS / viewportPixels)),
    );
    const marginX = (viewport.width * scale - viewport.width) / 2;
    const marginY = (viewport.height * scale - viewport.height) / 2;
    // backing 是「以当前视口为中心、向四周扩 margin」的更大窗口：局部 x=0 对应 live 的 -margin，
    // 故 pan 要 +margin（世界可见范围随之向两侧扩张），present 时再按 backing.pan 反算贴回。
    return {
      panX: viewport.panX + marginX,
      panY: viewport.panY + marginY,
      zoom: viewport.zoom,
      width: viewport.width * scale,
      height: viewport.height * scale,
      dpr: viewport.dpr,
    };
  }

  // ---- 拖拽内容会话 ----

  /**
   * 开启内容会话：excludedIds 为「被拖块 + 随动箭头」，它们每帧重渲；其余静态内容只在会话开始时
   * 渲染一次并复用。仅在 direct + 光栅器支持时生效。
   */
  beginContentSession(excludedIds: string[]): void {
    if (!this.direct) return;
    if (!this.rasterizer.beginContentSession || !this.rasterizer.renderContentSession) return;
    const ids = excludedIds.filter(Boolean);
    if (ids.length === 0) return;
    this.contentSession = { excluded: new Set(ids), started: false };
  }

  /** 结束内容会话并释放静态快照。 */
  endContentSession(): void {
    if (!this.contentSession) return;
    this.contentSession = null;
    this.rasterizer.endContentSession?.();
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

    // 拖拽内容会话：静态内容仅在会话开始时渲染一次；会话帧只重渲 live chunks 并合成静态快照。
    // 避免 direct 模式逐帧把整场 chunk 重新 append/编码（vello resolve_patches 按整场内容每帧重复解析）。
    if (this.direct && this.contentSession) {
      const begin = this.rasterizer.beginContentSession?.bind(this.rasterizer);
      const render = this.rasterizer.renderContentSession?.bind(this.rasterizer);
      if (begin && render) {
        const session = this.contentSession;
        const chunks = this.index.search(worldBounds);
        const isLive = (chunk: RenderChunk): boolean =>
          session.excluded.has(chunk.id) || chunk.nodeIds.some((id) => session.excluded.has(id));
        const live: RenderChunk[] = [];
        if (!session.started) {
          const statics: RenderChunk[] = [];
          for (const chunk of chunks) (isLive(chunk) ? live : statics).push(chunk);
          begin(statics, viewport);
          session.started = true;
        } else {
          for (const chunk of chunks) if (isLive(chunk)) live.push(chunk);
        }
        render(live, viewport);
        this.scheduler.clear();
        const metrics = emptyTileSchedulerMetrics();
        this.telemetry.record(
          { contentGeneration: input.contentGeneration, navigationGeneration: input.navigationGeneration, navigationActive: input.navigationActive, metrics, tileCacheBytes: 0, tileCacheEntries: 0, visibleTileCount: chunks.length, presentedTileCount: live.length, covered: true, frameMs: performance.now() - frameStart },
          live.length,
        );
        return { covered: true, pending: false, presented: live.length, rendered: live.length, metrics };
      }
    }

    // 直绘模式：优先用「保留场景底图」——内容不变时平移/缩放只贴一张底图纹理（单 quad，
    // 不再逐帧重编码整场）；覆盖不足或内容变化才重建底图。对齐 open-pencil `sceneBacking`。
    if (this.direct && this.rasterizer.renderFrame) {
      const oneShotBacking = this.rasterizer.buildSceneBacking?.bind(this.rasterizer);
      const presentBacking = this.rasterizer.presentSceneBacking?.bind(this.rasterizer);
      const beginBacking = this.rasterizer.beginSceneBacking?.bind(this.rasterizer);
      const stepBacking = this.rasterizer.stepSceneBacking?.bind(this.rasterizer);
      if (oneShotBacking && presentBacking && beginBacking && stepBacking) {
        const gen = input.contentGeneration;
        const finish = (visible: number, pending: boolean): TileFrameResult => {
          this.scheduler.clear();
          const metrics = emptyTileSchedulerMetrics();
          this.telemetry.record(
            { contentGeneration: gen, navigationGeneration: input.navigationGeneration, navigationActive: input.navigationActive, metrics, tileCacheBytes: 0, tileCacheEntries: 0, visibleTileCount: visible, presentedTileCount: 1, covered: true, frameMs: performance.now() - frameStart },
            0,
          );
          return { covered: true, pending, presented: 1, rendered: 0, metrics };
        };
        const searchBackingChunks = (): { bv: Viewport; chunks: RenderChunk[] } => {
          const bv = this.backingViewport(viewport);
          return { bv, chunks: this.index.search(viewportWorldBounds(bv.panX, bv.panY, bv.zoom, bv.width, bv.height)) };
        };
        const buildOneShot = (): TileFrameResult => {
          const { bv, chunks } = searchBackingChunks();
          oneShotBacking(chunks, bv);
          this.backingGeneration = gen;
          presentBacking(viewport, false);
          return finish(chunks.length, false);
        };

        // 1) 命中底图且覆盖 → 单 quad 贴（导航期允许 stale-zoom）
        if (this.backingGeneration === gen && presentBacking(viewport, input.navigationActive)) {
          return finish(1, false);
        }
        // 2) 构建中：仅当内容未再变、且旧底图仍覆盖时才贴旧底图续建；
        //    否则回到一次性构建（立即呈新内容，避免闪现旧内容）
        if (this.backingBuildActive) {
          if (this.backingBuildGeneration !== gen || !presentBacking(viewport, true)) {
            this.backingBuildActive = false;
            return buildOneShot();
          }
          if (stepBacking(TileController.BACKING_BUILD_BUDGET_MS)) {
            this.backingBuildActive = false;
            this.backingGeneration = this.backingBuildGeneration;
            presentBacking(viewport, false);
            return finish(1, false);
          }
          return finish(1, true);
        }
        // 3) 内容变化（generation 不符）→ 一次性重建：贴旧底图会闪现改动前的内容，
        //    这里直接重渲新内容（一次性 spike 换来正确画面）。
        if (this.backingGeneration !== gen) return buildOneShot();
        // 4) 覆盖不足但内容不变（平移/缩放出余量）→ 旧底图内容仍正确，贴它占位 + 分帧增量重建
        if (presentBacking(viewport, true)) {
          const { bv, chunks } = searchBackingChunks();
          beginBacking(chunks, bv);
          this.backingBuildActive = true;
          this.backingBuildGeneration = gen;
          if (stepBacking(TileController.BACKING_BUILD_BUDGET_MS)) {
            this.backingBuildActive = false;
            this.backingGeneration = gen;
            presentBacking(viewport, false);
            return finish(1, false);
          }
          return finish(1, true);
        }
        return buildOneShot();
      }

      // 兜底：光栅器无底图能力时每帧整场渲染
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

    // 导航期（平移/缩放）：不跑 tile job，优先贴「任意 level 的旧瓦片」做 stale-zoom 预览合成
    // （热缓存 <1ms/帧）；仅当视口完全无缓存覆盖（冷）时才整场直绘兜底，避免空白。
    // 清晰瓦片留到落定（navigationActive=false）后按预算逐帧补齐。
    if (input.navigationActive) {
      const presentPlan = planTiles(this.cache, {
        pageId: this.pageId,
        level,
        viewport: worldBounds,
        overscanTiles: 0,
        navigationGeneration: input.navigationGeneration,
        contentGeneration: input.contentGeneration,
        estimateCost: () => 0,
      }, true);
      const { fallback, fresh } = this.collectPresentTiles(presentPlan.visible);
      const presented = fallback.length + fresh.length;
      if (presented === 0 && this.rasterizer.renderDirect) {
        // 冷缓存：无任何旧瓦片可贴，整场直绘兜底一次
        const chunks = this.index.search(worldBounds);
        this.rasterizer.beginFrame(viewport);
        const handled = this.rasterizer.renderDirect(chunks, viewport);
        this.rasterizer.endFrame(viewport);
        if (handled) {
          this.scheduler.clear();
          const metrics = emptyTileSchedulerMetrics();
          this.telemetry.record(
            { contentGeneration: input.contentGeneration, navigationGeneration: input.navigationGeneration, navigationActive: true, metrics, tileCacheBytes: this.cache.byteSize(), tileCacheEntries: this.cache.size(), visibleTileCount: presentPlan.visible.length, presentedTileCount: 0, covered: false, frameMs: performance.now() - frameStart },
            0,
          );
          return { covered: false, pending: true, presented: 0, rendered: 0, metrics };
        }
      } else {
        // 热缓存：贴旧瓦片（可能跨 level 缩放），不重栅
        this.rasterizer.beginFrame(viewport);
        this.rasterizer.present([...fallback, ...fresh], viewport);
        this.rasterizer.endFrame(viewport);
        const metrics = emptyTileSchedulerMetrics();
        this.telemetry.record(
          { contentGeneration: input.contentGeneration, navigationGeneration: input.navigationGeneration, navigationActive: true, metrics, tileCacheBytes: this.cache.byteSize(), tileCacheEntries: this.cache.size(), visibleTileCount: presentPlan.visible.length, presentedTileCount: presented, covered: false, frameMs: performance.now() - frameStart },
          0,
        );
        return { covered: false, pending: true, presented, rendered: 0, metrics };
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
