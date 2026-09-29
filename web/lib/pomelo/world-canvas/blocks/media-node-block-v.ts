/*
 * [INPUT]: 依赖 pomelo-vello（VelloBlock/VelloOp/vello-text）、world-canvas/graph-theme（配色单一真源）、
 *          world-canvas/blocks/vello-shared（isLowDetail）
 * [OUTPUT]: 对外提供 MediaNodeBlockV（type: media-node）：瓦片底色图占位 + 边框 + "media" 标签；
 *           视口 <= LOW_DETAIL_SCALE 时只画占位框、隐藏标签。
 * [POS]: lib/pomelo/world-canvas/blocks 的基础素材节点 vello block。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { VelloBlock, type VelloBlockDraw } from "../../pomelo-vello/vello-block";
import type { VelloOp } from "../../pomelo-vello/op-bridge";
import { textOp } from "../../pomelo-vello/vello-text";
import { TEXT_SECONDARY, TILE_FILL, TILE_STROKE } from "../graph-theme";
import { isLowDetail } from "./vello-shared";

/** 媒体节点：图占位 + 边框。 */
export class MediaNodeBlockV extends VelloBlock {
  static type = "media-node";
  override renderOnZoom = true;

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 200;
    const h = Number(attrs.height) || 160;
    const ops: VelloOp[] = [
      { kind: "roundRect", x, y, width: w, height: h, radius: 10, fill: TILE_FILL, stroke: TILE_STROKE, strokeWidth: 1 },
    ];
    if (!isLowDetail(this.adapter)) {
      ops.push(textOp({ text: "media", x: x + 12, y: y + h - 26, size: 12, maxWidth: w - 24, fill: TEXT_SECONDARY }));
    }
    return { ops, bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h } };
  }
}
