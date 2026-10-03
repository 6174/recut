/*
 * [INPUT]: 依赖 pomelo-vello（VelloBlock/VelloOp/vello-text）、world-canvas/graph-theme（配色单一真源）、
 *          world-canvas/blocks/vello-shared（isLowDetail/moreHintOpsV）、world-canvas/text-metrics（wrapTextLines）
 * [OUTPUT]: 对外提供 NoteBlockV（type: note）：中性卡面 + 细边 + 次级文字，圆角 12；
 *           文字裁剪到卡面圆角内，内容超出卡面（换行行数超过可用行数）时右下角画「＋更多」提示，
 *           完整内容走文本卡右上角全屏入口；视口 <= LOW_DETAIL_SCALE 时只画卡面、隐藏文字。
 * [POS]: lib/pomelo/world-canvas/blocks 的便签/文本 vello block。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { VelloBlock, type VelloBlockDraw } from "../../pomelo-vello/vello-block";
import type { VelloOp } from "../../pomelo-vello/op-bridge";
import { textOp } from "../../pomelo-vello/vello-text";
import { CARD_FILL, CARD_STROKE, TEXT_SECONDARY } from "../graph-theme";
import { isLowDetail, moreHintOpsV } from "./vello-shared";
import { wrapTextLines } from "../text-metrics";
import { displayRefText } from "./ref-text";

const NOTE_PAD = 10;
const NOTE_SIZE = 11;
const NOTE_LINE_HEIGHT = 16;

/** 便签/文本：中性卡面 + 细边 + 次级文字，圆角 12；文字溢出裁剪 + 「＋更多」提示。 */
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
      ops.push({ kind: "pushClipRoundRect", x, y, width: w, height: h, radius: 12 });
      ops.push(textOp({ text, x: x + NOTE_PAD, y: y + NOTE_PAD, size: NOTE_SIZE, maxWidth: Math.max(20, w - NOTE_PAD * 2), lineHeight: NOTE_LINE_HEIGHT, fill: TEXT_SECONDARY }));
      ops.push({ kind: "popClip" });
      // 溢出提示：换行行数超过卡内可用行数时，右下角画「＋更多」
      const usableLines = Math.floor((h - NOTE_PAD * 2) / NOTE_LINE_HEIGHT);
      const lines = wrapTextLines(text, Math.max(20, w - NOTE_PAD * 2), NOTE_SIZE).length;
      if (usableLines > 0 && lines > usableLines) ops.push(...moreHintOpsV(x, y, w, h));
    }
    return { ops, bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h } };
  }
}
