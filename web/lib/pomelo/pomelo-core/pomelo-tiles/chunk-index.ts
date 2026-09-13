/*
 * [INPUT]: 依赖 types、geometry
 * [OUTPUT]: 对外提供 SpatialChunkIndex：chunk 注册/查询（按世界矩形求相交 chunk）与
 *           节点→chunk 反查（失效用）。v1 采用线性扫描（数百 chunk 量级足够），后续可换网格索引。
 * [POS]: pomelo-tiles 的空间索引，对应 open-pencil chunks/RenderChunkIndex。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { boundsIntersect } from "./geometry";
import type { RenderChunk, TileWorldBounds } from "./types";

export class SpatialChunkIndex {
  private readonly chunks = new Map<string, RenderChunk>();

  addChunk(chunk: RenderChunk): void {
    this.chunks.set(chunk.id, chunk);
  }

  removeChunk(id: string): void {
    this.chunks.delete(id);
  }

  updateChunk(id: string, patch: Partial<Pick<RenderChunk, "bounds" | "nodeIds" | "atomic" | "estimatedCost" | "payload">>): RenderChunk | null {
    const chunk = this.chunks.get(id);
    if (!chunk) return null;
    const next: RenderChunk = { ...chunk, ...patch };
    this.chunks.set(id, next);
    return next;
  }

  getChunk(id: string): RenderChunk | null {
    return this.chunks.get(id) ?? null;
  }

  /** 与给定世界矩形相交的 chunks（保持注册顺序）。 */
  search(bounds: TileWorldBounds): RenderChunk[] {
    const hits: RenderChunk[] = [];
    for (const chunk of this.chunks.values()) {
      if (boundsIntersect(chunk.bounds, bounds)) hits.push(chunk);
    }
    return hits;
  }

  /** 依赖某节点的 chunks（内容变更时失效用）。 */
  getChunksDependingOnNode(nodeId: string): RenderChunk[] {
    const hits: RenderChunk[] = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.nodeIds.includes(nodeId)) hits.push(chunk);
    }
    return hits;
  }

  size(): number {
    return this.chunks.size;
  }

  clear(): void {
    this.chunks.clear();
  }
}
