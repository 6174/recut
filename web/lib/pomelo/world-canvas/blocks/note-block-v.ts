/*
 * [INPUT]: 依赖 pomelo-vello（VelloBlock/VelloOp/vello-text）、world-canvas/graph-theme（配色单一真源）、
 *          world-canvas/blocks/vello-shared（isLowDetail）
 * [OUTPUT]: 对外提供 NoteBlockV（type: note）：中性卡面 + 细边 + 次级文字，圆角 12；
 *           视口 <= LOW_DETAIL_SCALE 时只画卡面、隐藏文字。
 * [POS]: lib/pomelo/world-canvas/blocks 的便签/文本 vello block。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { VelloBlock, type VelloBlockDraw } from "../../pomelo-vello/vello-block";
import type { VelloOp } from "../../pomelo-vello/op-bridge";
import { textOp } from "../../pomelo-vello/vello-text";
import { CARD_FILL, CARD_STROKE, TEXT_SECONDARY } from "../graph-theme";
import { isLowDetail } from "./vello-shared";
import { displayRefText } from "./ref-text";

/** 便签/文本：中性卡面 + 细边 + 次级文字，圆角 12。 */
export class NoteBlockV extends VelloBlock {
  static type = "note";
  override renderOnZoom = true;

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 200;
    const h = Number(attrs.height) || 120;
    const text = displayRefText(String(attrs.text ?? "便签"));
    const ops: VelloOp[] = [
      { kind: "roundRect", x, y, width: w, height: h, radius: 12, fill: CARD_FILL, stroke: CARD_STROKE, strokeWidth: 1 },
    ];
    if (!isLowDetail(this.adapter)) {
      ops.push(textOp({ text, x: x + 10, y: y + 10, size: 11, maxWidth: Math.max(20, w - 20), lineHeight: 16, fill: TEXT_SECONDARY }));
    }
    return { ops, bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h } };
  }
}
