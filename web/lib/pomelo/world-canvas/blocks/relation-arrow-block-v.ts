/*
 * [INPUT]: 依赖 pomelo-core（PomeloEditorState）、pomelo-vello（VelloBlock/VelloOp/Rgba/vello-text）、
 *          world-canvas/arrow-geometry（共享几何）、world-canvas/text-metrics（truncateText/measureTextWidth）、
 *          world-canvas/blocks/vello-shared
 * [OUTPUT]: 对外提供 RelationArrowBlockV（type: relation-arrow）：复用 arrow-geometry 的二次贝塞尔，
 *           曲线 + 箭头 + 标签；线宽/箭头/标签/边框均按屏幕像素恒定。
 * [POS]: lib/pomelo/world-canvas/blocks 的关系连线 vello block。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloEditorState } from "../../pomelo-core/pomelo-state";
import { VelloBlock, type VelloBlockDraw } from "../../pomelo-vello/vello-block";
import type { Rgba, VelloOp } from "../../pomelo-vello/op-bridge";
import { screenTextOp } from "../../pomelo-vello/vello-text";
import { bezierTangent, curveSegment, relationGeometry, type RelationGeometry } from "../arrow-geometry";
import { measureTextWidth, truncateText } from "../text-metrics";
import { LABEL_FILL, screenScaleOf } from "./vello-shared";

function hexToRgba(hex: string, alpha = 255): Rgba {
  const value = hex.replace("#", "");
  if (value.length < 6) return [59, 130, 246, alpha];
  return [Number.parseInt(value.slice(0, 2), 16) || 0, Number.parseInt(value.slice(2, 4), 16) || 0, Number.parseInt(value.slice(4, 6), 16) || 0, alpha];
}

/** 关系连线：复用 arrow-geometry 的二次贝塞尔，曲线 + 箭头 + 标签（线宽/箭头/标签按屏幕像素恒定）。 */
export class RelationArrowBlockV extends VelloBlock {
  static type = "relation-arrow";
  override renderOnZoom = true;

  override blockStateSelector = (state: PomeloEditorState) => {
    const fromId = String(this.record.attrs.fromId ?? "");
    const toId = String(this.record.attrs.toId ?? "");
    const from = state.getBlockById(fromId);
    const to = state.getBlockById(toId);
    const geo = relationGeometry(from, to, this.record.attrs as { fromAnchor?: { x: number; y: number }; toAnchor?: { x: number; y: number }; bend?: { dx: number; dy: number } });
    return { fromId, toId, geo, label: String(this.record.attrs.label ?? "") };
  };

  renderBlock(): VelloBlockDraw {
    const state = this.blockState as { geo: RelationGeometry | null; label: string } | null;
    const geo = state?.geo;
    if (!geo) return { ops: [], bounds: this.blockBounds() };
    const color = hexToRgba(String(this.record.attrs.color ?? "#8b93a7"));
    // zoom 常量补偿：线条/箭头/标签尺寸乘 1/scale，屏幕上保持恒定像素（否则低缩放下细线发虚/锯齿明显）
    const scale = screenScaleOf(this.adapter);
    const inv = 1 / scale;
    const segment = curveSegment(geo, geo.ta, geo.tb);
    const tangent = bezierTangent(geo.curve.p0, geo.curve.cp, geo.curve.p2, geo.tb);
    const angle = Math.atan2(tangent.y, tangent.x);
    const headLength = 11 * inv;
    const headWidth = 9 * inv;
    const strokeWidth = 2 * inv;

    const ops: VelloOp[] = [
      {
        kind: "quadStroke",
        p0: [segment.p0.x, segment.p0.y],
        cp: [segment.cp.x, segment.cp.y],
        p1: [segment.p2.x, segment.p2.y],
        stroke: color,
        strokeWidth,
      },
      {
        kind: "triangleFill",
        points: [
          [geo.b.x, geo.b.y],
          [geo.b.x - headLength * Math.cos(angle) + (headWidth / 2) * Math.sin(angle), geo.b.y - headLength * Math.sin(angle) - (headWidth / 2) * Math.cos(angle)],
          [geo.b.x - headLength * Math.cos(angle) - (headWidth / 2) * Math.sin(angle), geo.b.y - headLength * Math.sin(angle) + (headWidth / 2) * Math.cos(angle)],
        ],
        fill: color,
      },
    ];

    // 标签：曲线中点（多条边沿法向 ±14 屏幕像素错开）；字号/药丸/偏移均按屏幕像素恒定。
    // 文本 op 用屏幕 ppem（10）+ glyphScale=1/scale 保证轮廓清晰（同 caption）。
    let label = "";
    let labelTextW = 0;
    let labelX = geo.mid.x;
    let labelY = geo.mid.y;
    let pillW = 0;
    let pillH = 0;
    if (state?.label) {
      label = truncateText(state.label, 120, 10);
      labelTextW = measureTextWidth(label, 10);
      const offsetIndex = Number(this.record.attrs.labelOffsetIndex ?? 0);
      if (offsetIndex > 0) {
        const midTangent = bezierTangent(geo.curve.p0, geo.curve.cp, geo.curve.p2, 0.5);
        const length = Math.hypot(midTangent.x, midTangent.y) || 1;
        const side = offsetIndex % 2 === 1 ? 1 : -1;
        const level = Math.ceil(offsetIndex / 2);
        const px = ((level * 14 * side) / length) * inv;
        labelX = geo.mid.x - midTangent.y * px;
        labelY = geo.mid.y + midTangent.x * px;
      }
      pillW = (labelTextW + 14) * inv;
      pillH = 18 * inv;
      // 边框也按屏幕恒定（strokeWidth 乘 1/scale）：否则缩小时 <1px，描边发虚/断续
      ops.push({ kind: "roundRect", x: labelX - pillW / 2, y: labelY - pillH / 2, width: pillW, height: pillH, radius: 9 * inv, fill: [15, 20, 16, 235], stroke: [255, 255, 255, 40], strokeWidth: inv });
      ops.push(screenTextOp(this.adapter, { text: label, x: labelX - labelTextW / 2 / scale, y: labelY - 7 / scale, screenSize: 10, maxScreenWidth: labelTextW, align: "left", fill: LABEL_FILL }));
    }

    const pad = 24 * inv + (state?.label ? 60 * inv : 0);
    const minX = Math.min(segment.p0.x, segment.cp.x, segment.p2.x, labelX) - pad;
    const minY = Math.min(segment.p0.y, segment.cp.y, segment.p2.y, labelY) - pad;
    const maxX = Math.max(segment.p0.x, segment.cp.x, segment.p2.x, labelX) + pad;
    const maxY = Math.max(segment.p0.y, segment.cp.y, segment.p2.y, labelY) + pad;

    return { ops, bounds: { minX, minY, maxX, maxY } };
  }
}
