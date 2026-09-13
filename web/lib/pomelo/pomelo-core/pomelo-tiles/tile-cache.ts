/*
 * [INPUT]: 依赖 types、geometry
 * [OUTPUT]: 对外提供 TileImageCache：字节 LRU + generation 失效（advanceGeneration / invalidateBounds）。
 * [POS]: pomelo-tiles 的瓦片缓存，open-pencil tiles/cache.ts 直译，句柄类型由光栅器决定。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { tileKeyString, tileWorldSize } from "./geometry";
import type { CachedTile, RenderedTile, TileKey, TileWorldBounds } from "./types";

/** 默认 128MB（open-pencil 原值）。 */
export const DEFAULT_MAX_TILE_BYTES = 128 * 1024 * 1024;

export class TileImageCache<THandle> {
  private readonly entries = new Map<string, CachedTile<THandle>>();
  private bytes = 0;
  private clock = 0;

  constructor(
    private readonly maxBytes = DEFAULT_MAX_TILE_BYTES,
    private readonly dispose: (handle: THandle) => void = () => undefined,
  ) {}

  get(key: TileKey): CachedTile<THandle> | null {
    const id = tileKeyString(key);
    const entry = this.entries.get(id);
    if (!entry) return null;
    entry.lastUsed = ++this.clock;
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry;
  }

  getIfPresent(key: TileKey): CachedTile<THandle> | null {
    return this.entries.get(tileKeyString(key)) ?? null;
  }

  install(tile: RenderedTile<THandle>, contentGeneration: number): CachedTile<THandle> {
    const id = tileKeyString(tile.key);
    this.delete(id);
    const entry: CachedTile<THandle> = {
      key: tile.key,
      handle: tile.handle,
      contentGeneration,
      lastUsed: ++this.clock,
      bytes: tile.bytes,
    };
    this.entries.set(id, entry);
    this.bytes += entry.bytes;
    this.evict();
    return entry;
  }

  /** 把所有未达代的瓦片标记为陈旧（保留用于 stale-zoom 预览）。 */
  markStale(contentGeneration: number): void {
    for (const entry of this.entries.values()) {
      if (entry.contentGeneration >= contentGeneration) entry.contentGeneration = contentGeneration - 1;
    }
  }

  /** 删除与世界矩形相交的瓦片，返回删除数。 */
  invalidateBounds(pageId: string, bounds: TileWorldBounds, contentGeneration: number): number {
    let invalidated = 0;
    for (const [id, entry] of this.entries) {
      if (entry.key.pageId !== pageId) continue;
      const size = tileWorldSize(entry.key.level);
      const minX = entry.key.x * size;
      const minY = entry.key.y * size;
      const intersects = !(minX >= bounds.maxX || minY >= bounds.maxY || minX + size <= bounds.minX || minY + size <= bounds.minY);
      if (!intersects) {
        entry.contentGeneration = contentGeneration;
        continue;
      }
      this.delete(id);
      invalidated++;
    }
    return invalidated;
  }

  advanceGeneration(contentGeneration: number): void {
    for (const entry of this.entries.values()) entry.contentGeneration = contentGeneration;
  }

  clear(): void {
    for (const id of Array.from(this.entries.keys())) this.delete(id);
    this.bytes = 0;
  }

  size(): number {
    return this.entries.size;
  }

  byteSize(): number {
    return this.bytes;
  }

  /** 命中瓦片键集合（用于合成）。 */
  values(): CachedTile<THandle>[] {
    return Array.from(this.entries.values());
  }

  private delete(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.dispose(entry.handle);
    this.bytes -= entry.bytes;
    this.entries.delete(id);
  }

  private evict(): void {
    while (this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest !== "string") break;
      this.delete(oldest);
    }
  }
}
