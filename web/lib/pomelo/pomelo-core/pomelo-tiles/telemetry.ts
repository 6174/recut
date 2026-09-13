/*
 * [INPUT]: 依赖 types、geometry
 * [OUTPUT]: 对外提供 TileTelemetry：帧指标 + 全局计数（供 pomeloPerf / e2e 读取）。
 * [POS]: pomelo-tiles 的遥测层，对应 open-pencil tiles/telemetry.ts。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { TileSchedulerMetrics } from "./types";

export interface TileFrameTrace {
  contentGeneration: number;
  navigationGeneration: number;
  navigationActive: boolean;
  metrics: TileSchedulerMetrics;
  tileCacheBytes: number;
  tileCacheEntries: number;
  visibleTileCount: number;
  presentedTileCount: number;
  covered: boolean;
  frameMs: number;
}

export interface TileTelemetrySnapshot {
  frames: number;
  tilesRenderedTotal: number;
  tilesRenderedLastFrame: number;
  coveredFrames: number;
  lastTrace: TileFrameTrace | null;
}

export class TileTelemetry {
  private frames = 0;
  private tilesRenderedTotal = 0;
  private tilesRenderedLastFrame = 0;
  private coveredFrames = 0;
  private lastTrace: TileFrameTrace | null = null;
  private listeners: Array<(trace: TileFrameTrace) => void> = [];

  onFrame(listener: (trace: TileFrameTrace) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  record(trace: TileFrameTrace, renderedThisFrame: number): void {
    this.frames++;
    this.tilesRenderedLastFrame = renderedThisFrame;
    this.tilesRenderedTotal += renderedThisFrame;
    if (trace.covered) this.coveredFrames++;
    this.lastTrace = trace;
    for (const listener of this.listeners) listener(trace);
  }

  reset(): void {
    this.frames = 0;
    this.tilesRenderedTotal = 0;
    this.tilesRenderedLastFrame = 0;
    this.coveredFrames = 0;
    this.lastTrace = null;
  }

  snapshot(): TileTelemetrySnapshot {
    return {
      frames: this.frames,
      tilesRenderedTotal: this.tilesRenderedTotal,
      tilesRenderedLastFrame: this.tilesRenderedLastFrame,
      coveredFrames: this.coveredFrames,
      lastTrace: this.lastTrace,
    };
  }
}
