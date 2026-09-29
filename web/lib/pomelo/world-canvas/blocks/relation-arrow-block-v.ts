/*
 * [INPUT]: 依赖 pomelo-core（PomeloEditorState）、pomelo-vello（VelloBlock/VelloOp/Rgba/vello-text）、
 *          world-canvas/arrow-geometry（共享几何）、world-canvas/text-metrics（truncateText/measureTextWidth）、
 *          world-canvas/blocks/vello-shared
 * [OUTPUT]: 对外提供 RelationArrowBlockV（type: relation-arrow）：复用 arrow-geometry 的二次贝塞尔，
 *           曲线 + 箭头 + 标签；线宽/箭头/标签/边框均按屏幕像素恒定；zIndex=-1 永远画在内容节点下层。
 *           toRole 非空（hasReverse）时画双箭头、两端各一个标签；否则单箭头 + 中点 fromRole 标签。
 *           标签落在可视段中点（geo.mid/midT），不压在两端元素卡片上。
 * [POS]: lib/pomelo/world-canvas/blocks 的关系连线 vello block。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloEditorState } from "../../pomelo-core/pomelo-state";
import { VelloBlock, type VelloBlockDraw } from "../../pomelo-vello/vello-block";
import type { VelloOp } from "../../pomelo-vello/op-bridge";
import { screenTextOp } from "../../pomelo-vello/vello-text";
import { LABEL_FILL, LINK_DEFAULT, rgba } from "../graph-theme";
import { bezierTangent, curveSegment, relationGeometry, type RelationGeometry } from "../arrow-geometry";
import { measureTextWidth, truncateText } from "../text-metrics";
import { isLowDetail, screenScaleOf } from "./vello-shared";

/** 关系连线：复用 arrow-geometry 的二次贝塞尔，曲线 + 箭头 + 标签（线宽/箭头/标签按屏幕像素恒定）。 */
export class RelationArrowBlockV extends VelloBlock {
  static type = "relation-arrow";
  override renderOnZoom = true;
  /** 连线永远在最底层：低于所有内容节点（entity/note/media/free-element）。 */
  override zIndex = -1;

  override blockStateSelector = (state: PomeloEditorState) => {
    const fromId = String(this.record.attrs.fromId ?? "");
    const toId = String(this.record.attrs.toId ?? "");
    const from = state.getBlockById(fromId);
    const to = state.getBlockById(toId);
    const geo = relationGeometry(from, to, this.record.attrs as { fromAnchor?: { x: number; y: number }; toAnchor?: { x: number; y: number }; bend?: { dx: number; dy: number } });
    const toRole = String(this.record.attrs.toRole ?? "");
    const reverseLabel = String(this.record.attrs.reverseLabel ?? "");
    return {
      fromId,
      toId,
      geo,
      label: String(this.record.attrs.label ?? ""),
      hasReverse: Boolean(this.record.attrs.hasReverse) || toRole !== "" || reverseLabel !== "",
      reverseLabel,
    };
  };

  renderBlock(): VelloBlockDraw {
    const state = this.blockState as { geo: RelationGeometry | null; label: string; hasReverse: boolean; reverseLabel: string } | null;
    const geo = state?.geo;
    if (!geo) return { ops: [], bounds: this.blockBounds() };
    const color = rgba(String(this.record.attrs.color || LINK_DEFAULT));
    // zoom 常量补偿：线条/箭头/标签尺寸乘 1/scale，屏幕上保持恒定像素（否则低缩放下细线发虚/锯齿明显）
    const scale = screenScaleOf(this.adapter);
    const inv = 1 / scale;
    // 低细节缩放：只保留曲线 + 箭头（shape），标签直接消失
    const lowDetail = isLowDetail(this.adapter);
    const segment = curveSegment(geo, geo.ta, geo.tb);
    const tangent = bezierTangent(geo.curve.p0, geo.curve.cp, geo.curve.p2, geo.tb);
    const angle = Math.atan2(tangent.y, tangent.x);
    const headLength = 11 * inv;
    const headWidth = 9 * inv;
    const strokeWidth = 1 * inv;

    // 箭头三角：tip 在给定点、沿 angle 方向指出的等边三角
    const head = (tipX: number, tipY: number, dir: number): VelloOp => ({
      kind: "triangleFill",
      points: [
        [tipX, tipY],
        [tipX - headLength * Math.cos(dir) + (headWidth / 2) * Math.sin(dir), tipY - headLength * Math.sin(dir) - (headWidth / 2) * Math.cos(dir)],
        [tipX - headLength * Math.cos(dir) - (headWidth / 2) * Math.sin(dir), tipY - headLength * Math.sin(dir) + (headWidth / 2) * Math.cos(dir)],
      ],
      fill: color,
    });

    const ops: VelloOp[] = [
      {
        kind: "quadStroke",
        p0: [segment.p0.x, segment.p0.y],
        cp: [segment.cp.x, segment.cp.y],
        p1: [segment.p2.x, segment.p2.y],
        stroke: color,
        strokeWidth,
      },
      head(geo.b.x, geo.b.y, angle),
    ];
    // 反向箭头（toRole 已标记）：tip 在 a 端、方向为起点切线的反向
    if (state?.hasReverse) {
      const tangentA = bezierTangent(geo.curve.p0, geo.curve.cp, geo.curve.p2, geo.ta);
      const angleA = Math.atan2(tangentA.y, tangentA.x);
      ops.push(head(geo.a.x, geo.a.y, angleA + Math.PI));
    }

    // 标签：单箭头 = 可视段中点一个 fromRole；双箭头 = 两端语义都收在中点处、上下堆叠。
    // 仅画文本、不画药丸底（保持克制）；文本 op 用屏幕 ppem（10）+ glyphScale=1/scale 保证轮廓清晰。
    // 法向取可视段中点切线——与 geo.mid 同一处，错开标签才对得上曲线。
    const midTangent = bezierTangent(geo.curve.p0, geo.curve.cp, geo.curve.p2, geo.midT);
    const midLen = Math.hypot(midTangent.x, midTangent.y) || 1;
    const offsetIndex = Number(this.record.attrs.labelOffsetIndex ?? 0);
    let labelX = geo.mid.x;
    let labelY = geo.mid.y;

    const drawLabel = (text: string, x: number, y: number) => {
      if (!text) return;
      const label = truncateText(text, 120, 10);
      const labelTextW = measureTextWidth(label, 10);
      ops.push(screenTextOp(this.adapter, { text: label, x: x - labelTextW / 2 / scale, y: y - 7 / scale, screenSize: 10, maxScreenWidth: labelTextW, align: "left", fill: LABEL_FILL }));
    };

    if (lowDetail) {
      labelX = geo.mid.x;
      labelY = geo.mid.y;
    } else if (state?.hasReverse) {
      // 双箭头：两端语义都收在中点控制点处，上下堆叠（from 在上、to 在下），不占两端。
      const stackGap = 11 * inv;
      drawLabel(state.label, geo.mid.x, geo.mid.y - stackGap);
      drawLabel(state.reverseLabel || state.label, geo.mid.x, geo.mid.y + stackGap);
      labelX = geo.mid.x;
      labelY = geo.mid.y;
    } else if (state?.label) {
      if (offsetIndex > 0) {
        const side = offsetIndex % 2 === 1 ? 1 : -1;
        const level = Math.ceil(offsetIndex / 2);
        const px = ((level * 14 * side) / midLen) * inv;
        labelX = geo.mid.x - midTangent.y * px;
        labelY = geo.mid.y + midTangent.x * px;
      }
      drawLabel(state.label, labelX, labelY);
    }

    const pad = 24 * inv + (state?.label ? 60 * inv : 0);
    const minX = Math.min(segment.p0.x, segment.cp.x, segment.p2.x, labelX) - pad;
    const minY = Math.min(segment.p0.y, segment.cp.y, segment.p2.y, labelY) - pad;
    const maxX = Math.max(segment.p0.x, segment.cp.x, segment.p2.x, labelX) + pad;
    const maxY = Math.max(segment.p0.y, segment.cp.y, segment.p2.y, labelY) + pad;

    return { ops, bounds: { minX, minY, maxX, maxY } };
  }
}
