/*
 * [INPUT]: 依赖 types、geometry、tile-cache（类型）
 * [OUTPUT]: 对外提供 planTiles：可见瓦片规划 + mandatory/visible/overscan 优先级 + cachedOnly（导航期）。
 * [POS]: pomelo-tiles 的规划层，open-pencil tiles/planner.ts 直译。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { expandBounds, tileKeysForWorldBounds, tileKeyString, tileWorldSize } from "./geometry";
import type { TileImageCache } from "./tile-cache";
import type { CachedTile, TileJob, TileKey, TileWorldBounds } from "./types";

export interface TilePlanOptions {
  pageId: string;
  level: number;
  viewport: TileWorldBounds;
  overscanTiles: number;
  navigationGeneration: number;
  contentGeneration: number;
  estimateCost: (key: TileKey) => number;
  globalFallbackAvailable?: boolean;
}

export interface TilePlan<THandle> {
  jobs: TileJob[];
  visible: Array<{ key: TileKey; tile: CachedTile<THandle> | null }>;
}

export function planTiles<THandle>(
  cache: TileImageCache<THandle>,
  options: TilePlanOptions,
  cachedOnly = false,
): TilePlan<THandle> {
  const visibleKeys = tileKeysForWorldBounds(options.pageId, options.level, options.viewport);
  if (cachedOnly) {
    return {
      jobs: [],
      visible: visibleKeys.map((key) => ({ key, tile: cache.getIfPresent(key) })),
    };
  }

  const worldTileSize = tileWorldSize(options.level);
  const visibleIds = new Set(visibleKeys.map(tileKeyString));
  const overscanKeys = tileKeysForWorldBounds(options.pageId, options.level, expandBounds(options.viewport, worldTileSize * options.overscanTiles));

  const visible = visibleKeys.map((key) => ({ key, tile: cache.get(key) }));
  const jobs: TileJob[] = [];
  for (const { key, tile } of visible) {
    const fresh = tile?.contentGeneration === options.contentGeneration;
    if (fresh) continue;
    jobs.push({
      key,
      navigationGeneration: options.navigationGeneration,
      contentGeneration: options.contentGeneration,
      priority: tile || options.globalFallbackAvailable ? "visible" : "mandatory",
      fallbackAvailable: tile !== null || options.globalFallbackAvailable === true,
      estimatedCost: options.estimateCost(key),
    });
  }
  if (jobs.length > 0) return { jobs, visible };

  for (const key of overscanKeys) {
    if (visibleIds.has(tileKeyString(key))) continue;
    const tile = cache.get(key);
    if (tile?.contentGeneration === options.contentGeneration) continue;
    jobs.push({
      key,
      navigationGeneration: options.navigationGeneration,
      contentGeneration: options.contentGeneration,
      priority: "overscan",
      fallbackAvailable: tile !== null,
      estimatedCost: options.estimateCost(key),
    });
  }
  return { jobs, visible };
}
