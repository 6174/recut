/*
 * [INPUT]: 依赖 pomelo-vello（VelloBlock/VelloOp/vello-text）、world-canvas/entity-color（attrMediaLabel）、
 *          world-canvas/blocks/vello-shared
 * [OUTPUT]: 对外提供 FreeElementBlockV（type: free-element）：文本 / 形状 / 属性预览卡；
 * 属性文本卡用 pushClipRoundRect 裁剪到几何 box（文本服从 box，溢出截断）。
 * [POS]: lib/pomelo/world-canvas/blocks 的自由元素 vello block。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { VelloBlock, type VelloBlockDraw } from "../../pomelo-vello/vello-block";
import type { VelloOp } from "../../pomelo-vello/op-bridge";
import { textOp } from "../../pomelo-vello/vello-text";
import { attrMediaLabel } from "../entity-color";
import {
  CAPTION_TOP_OFFSET,
  CARD_FILL,
  CARD_STROKE,
  TEXT_PRIMARY,
  TEXT_TERTIARY,
  captionOpsV,
  coverImageOpsV,
  screenScaleOf,
} from "./vello-shared";

/** 自由元素（type: free-element）：文本 / 形状 / 属性预览卡（v1 简化视觉）。 */
export class FreeElementBlockV extends VelloBlock {
  static type = "free-element";
  override renderOnZoom = true;

  protected blockBounds() {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 120;
    const h = Number(attrs.height) || 60;
    if (String(attrs.elementKind ?? "") === "attr") {
      const scale = screenScaleOf(this.adapter);
      return { minX: x, minY: y - (CAPTION_TOP_OFFSET + 2) / scale, maxX: x + w, maxY: y + h };
    }
    return { minX: x, minY: y, maxX: x + w, maxY: y + h };
  }

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 120;
    const h = Number(attrs.height) || 60;
    const elementKind = String(attrs.elementKind ?? "shape");
    const shapeType = String(attrs.shapeType ?? "rectangle");
    const text = String(attrs.text ?? "");
    const media = String(attrs.attrMedia ?? "text");
    const mediaSrc = String(attrs.mediaSrc ?? "");

    const ops: VelloOp[] = [];
    if (elementKind === "text") {
      ops.push(textOp({ text: text || "（空文本）", x, y, size: 13, maxWidth: Math.max(40, w), lineHeight: 20, fill: [212, 212, 216, 255] }));
    } else if (elementKind === "attr") {
      const label = `${attrMediaLabel(media)}${text ? ` · ${text.slice(0, 12)}` : ""}`;
      const caption = captionOpsV(this.adapter, x, y, w, label);
      ops.push({ kind: "roundRect", x, y, width: w, height: h, radius: 12, fill: CARD_FILL, stroke: CARD_STROKE, strokeWidth: 1 });
      ops.push(...caption.ops);
      if (media === "image" && mediaSrc) {
        ops.push(...coverImageOpsV(this.adapter, mediaSrc, { x, y, width: w, height: h }, { x, y, width: w, height: h, radius: 12 }));
      } else if (text) {
        // 文本服从 box：裁剪到卡片圆角内，溢出直接截断（双击就地编辑改为内滚动 + 全屏放大）
        ops.push({ kind: "pushClipRoundRect", x, y, width: w, height: h, radius: 12 });
        ops.push(textOp({ text, x: x + 10, y: y + 10, size: 11, maxWidth: w - 20, lineHeight: 17, fill: TEXT_PRIMARY }));
        ops.push({ kind: "popClip" });
      }
    } else {
      const radius = shapeType === "ellipse" || shapeType === "diamond" ? Math.min(w, h) / 2 : 8;
      ops.push({ kind: "roundRect", x, y, width: w, height: h, radius, fill: [255, 255, 255, 8], stroke: [82, 82, 91, 255], strokeWidth: 1.5 });
      if (text) ops.push(textOp({ text, x: x + 10, y: y + 10, size: 11, maxWidth: w - 16, fill: TEXT_TERTIARY }));
    }

    return { ops, bounds: this.blockBounds() };
  }
}
