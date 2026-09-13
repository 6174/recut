/*
 * [INPUT]: 依赖 types
 * [OUTPUT]: 对外提供瓦片几何：常量、LOD 量化、世界尺寸/边界、可见瓦片枚举、相交判定。
 * [POS]: pomelo-tiles 的几何层，open-pencil tiles/geometry.ts 直译。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { TileKey, TileWorldBounds } from "./types";

/** 瓦片设备像素尺寸（open-pencil 原值 256，不得改动）。 */
export const TILE_DEVICE_SIZE = 256;
/** LOD 量化步长（open-pencil 原值 0.25）。 */
export const TILE_LEVEL_STEP = 0.25;
export const MIN_TILE_LEVEL = TILE_LEVEL_STEP / 16;
/** 瓦片渲染外扩像素，消除解析 AA 在裁剪边界的覆盖率缝。 */
export const TILE_BLEED_PX = 2;

/** 把 zoom*devicePixelRatio 量化到离散 LOD 层级。 */
export function tileLevel(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  if (scale < TILE_LEVEL_STEP) {
    const exponent = Math.ceil(Math.log2(TILE_LEVEL_STEP / scale));
    return Math.max(MIN_TILE_LEVEL, TILE_LEVEL_STEP / 2 ** exponent);
  }
  return Math.ceil(scale / TILE_LEVEL_STEP) * TILE_LEVEL_STEP;
}

/** 一个瓦片在世界坐标下的边长。 */
export function tileWorldSize(level: number): number {
  return TILE_DEVICE_SIZE / level;
}

export function tileWorldBounds(key: TileKey): TileWorldBounds {
  const size = tileWorldSize(key.level);
  const minX = key.x * size;
  const minY = key.y * size;
  return { minX, minY, maxX: minX + size, maxY: minY + size };
}

export function tileKeysForWorldBounds(pageId: string, level: number, bounds: TileWorldBounds): TileKey[] {
  const size = tileWorldSize(level);
  const minX = Math.floor(bounds.minX / size);
  const minY = Math.floor(bounds.minY / size);
  const maxX = Math.ceil(bounds.maxX / size) - 1;
  const maxY = Math.ceil(bounds.maxY / size) - 1;
  const keys: TileKey[] = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) keys.push({ pageId, level, x, y });
  }
  return keys;
}

export function tileKeyString(key: TileKey): string {
  return `${key.pageId}:${key.level}:${key.x}:${key.y}`;
}

export function boundsIntersect(a: TileWorldBounds, b: TileWorldBounds): boolean {
  return !(a.minX >= b.maxX || a.minY >= b.maxY || a.maxX <= b.minX || a.maxY <= b.minY);
}

export function boundsUnion(a: TileWorldBounds, b: TileWorldBounds): TileWorldBounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** 视口在世界坐标下的可见矩形（与 open-pencil controller 同口径）。 */
export function viewportWorldBounds(panX: number, panY: number, zoom: number, width: number, height: number): TileWorldBounds {
  return {
    minX: -panX / zoom,
    minY: -panY / zoom,
    maxX: (-panX + width) / zoom,
    maxY: (-panY + height) / zoom,
  };
}

export function expandBounds(bounds: TileWorldBounds, amount: number): TileWorldBounds {
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
  };
}
