/*
 * [INPUT]: 依赖 pomelo-vello（VelloBlock/VelloOp/vello-text）、world-canvas/graph-theme（配色单一真源）、
 *          world-canvas/blocks/vello-shared（isLowDetail）、world-canvas/text-metrics（truncateText）
 * [OUTPUT]: 对外提供 WorldNodeBlockV（type: world-node）：中性卡面 + 强边 + 主题绿光环 + 名称；
 *           视口 <= LOW_DETAIL_SCALE 时只画卡面/光环、隐藏名称。
 * [POS]: lib/pomelo/world-canvas/blocks 的 World 根节点 vello block。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { VelloBlock, type VelloBlockDraw } from "../../pomelo-vello/vello-block";
import type { VelloOp } from "../../pomelo-vello/op-bridge";
import { textOp } from "../../pomelo-vello/vello-text";
import { truncateText } from "../text-metrics";
import { CARD_FILL, CARD_STROKE_STRONG, GRAPH_COLORS, TEXT_PRIMARY, rgba } from "../graph-theme";
import { isLowDetail } from "./vello-shared";

/** World 根节点：中性卡面 + 强边 + 主题绿光环 + 名称。 */
export class WorldNodeBlockV extends VelloBlock {
  static type = "world-node";
  override renderOnZoom = true;

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 200;
    const h = Number(attrs.height) || 80;
    const title = String(attrs.title ?? "World");
    const ops: VelloOp[] = [
      { kind: "roundRect", x: x - 3, y: y - 3, width: w + 6, height: h + 6, radius: (h + 6) / 2, fill: [0, 0, 0, 0], stroke: rgba(GRAPH_COLORS.worldAccent, 102), strokeWidth: 1.5 },
      { kind: "roundRect", x, y, width: w, height: h, radius: h / 2, fill: CARD_FILL, stroke: CARD_STROKE_STRONG, strokeWidth: 1 },
    ];
    if (!isLowDetail(this.adapter)) {
      ops.push(textOp({ text: truncateText(title, w - 40, 15), x: x + w / 2, y: y + h / 2 - 11, size: 15, maxWidth: w - 40, align: "center", embolden: 0.03, fill: TEXT_PRIMARY }));
    }
    return { ops, bounds: { minX: x - 3, minY: y - 3, maxX: x + w + 3, maxY: y + h + 3 } };
  }
}
