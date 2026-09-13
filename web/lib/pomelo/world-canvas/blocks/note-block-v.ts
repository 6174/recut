/*
 * [INPUT]: 依赖 pomelo-vello（VelloBlock/VelloOp/Rgba/vello-text）、world-canvas/blocks/vello-shared
 * [OUTPUT]: 对外提供 NoteBlockV（type: note）：深色卡面 + 白 8% 细边 + 次级文字，圆角 12（vello op + Canvas2D 双实现）。
 * [POS]: lib/pomelo/world-canvas/blocks 的便签/文本 vello block。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { VelloBlock, type VelloBlockDraw } from "../../pomelo-vello/vello-block";
import type { Rgba, VelloOp } from "../../pomelo-vello/op-bridge";
import { drawTextCanvas, textOp } from "../../pomelo-vello/vello-text";
import { CARD_FILL, CARD_STROKE, roundRect } from "./vello-shared";

/** 便签/文本：深色卡面 + 白 8% 细边 + 次级文字，圆角 12。 */
export class NoteBlockV extends VelloBlock {
  static type = "note";

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 200;
    const h = Number(attrs.height) || 120;
    const text = String(attrs.text ?? "便签");
    const noteText: Rgba = [156, 163, 175, 255];
    const ops: VelloOp[] = [
      { kind: "roundRect", x, y, width: w, height: h, radius: 12, fill: CARD_FILL, stroke: CARD_STROKE, strokeWidth: 1 },
      textOp({ text, x: x + 10, y: y + 10, size: 11, maxWidth: Math.max(20, w - 20), lineHeight: 16, fill: noteText }),
    ];
    const canvas = (ctx: CanvasRenderingContext2D) => {
      roundRect(ctx, x, y, w, h, 12);
      ctx.fillStyle = "#0f1410";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.stroke();
      drawTextCanvas(ctx, { text, x: x + 10, y: y + 10, size: 11, maxWidth: Math.max(20, w - 20), lineHeight: 16, fill: noteText });
    };
    return { ops, bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h }, canvas };
  }
}
