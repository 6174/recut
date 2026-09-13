/*
 * [INPUT]: 依赖 pomelo-vello（VelloBlock/VelloOp/vello-text）、world-canvas/blocks/vello-shared
 * [OUTPUT]: 对外提供 MediaNodeBlockV（type: media-node）：瓦片底色图占位 + 边框 + "media" 标签
 *           （vello op + Canvas2D 双实现）。
 * [POS]: lib/pomelo/world-canvas/blocks 的基础素材节点 vello block。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { VelloBlock, type VelloBlockDraw } from "../../pomelo-vello/vello-block";
import type { VelloOp } from "../../pomelo-vello/op-bridge";
import { textOp } from "../../pomelo-vello/vello-text";
import { TILE_FILL, TEXT_SECONDARY, roundRect } from "./vello-shared";

/** 媒体节点：图占位 + 边框。 */
export class MediaNodeBlockV extends VelloBlock {
  static type = "media-node";

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 200;
    const h = Number(attrs.height) || 160;
    const ops: VelloOp[] = [
      { kind: "roundRect", x, y, width: w, height: h, radius: 10, fill: TILE_FILL, stroke: [75, 85, 99, 255], strokeWidth: 1 },
      textOp({ text: "media", x: x + 12, y: y + h - 26, size: 12, maxWidth: w - 24, fill: TEXT_SECONDARY }),
    ];
    const canvas = (ctx: CanvasRenderingContext2D) => {
      roundRect(ctx, x, y, w, h, 10);
      ctx.fillStyle = "#1d231e";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#4b5563";
      ctx.stroke();
    };
    return { ops, bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h }, canvas };
  }
}
