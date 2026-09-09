/*
 * [INPUT]: 依赖 pixi.js、pomelo-core（PixiBlock / PomeloEditorState）与 arrow-geometry（共享几何）
 * [OUTPUT]: 对外提供 RelationArrowBlock（type: relation-arrow）：绑定两端的实体卡 Block，
 * 几何由 anchor（默认节点中心，可被控制点调整）+ bend（中间控制点，控制曲线）经 relationGeometry
 * 解析为二次贝塞尔曲线；渲染曲线 + 沿切线箭头 + 曲线中点关系标签；颜色按 attrs.relationType
 * 的分组色着色（relationGroupColor：people/world/story/video，B.10）；挂接线/属性边画虚线、
 * 同对多边标签沿法向错开（labelOffsetIndex）；线宽/箭头/标签为 zoom 常量（1/scale 反向
 * 补偿，缩放不改变屏幕像素尺寸，缩放重绘由 PixiBlock.renderOnZoom 驱动）
 * [POS]: lib/pomelo/world-canvas 的关系连线 Block（学习 tldraw ArrowBindingUtil 的绑定式连线思路：
 * 绑定关系存于 demo-store.relations，几何在每次渲染时解析）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";
import { PixiBlock } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-block";
import type { PomeloEditorState } from "../../pomelo-core/pomelo-state";
import { truncateText } from "../truncate-text";
import { bezierTangent, curveSegment, relationGeometry, type RelationGeometry } from "../arrow-geometry";
import { relationGroupColor } from "../entity-color";

const FONT = 'system-ui, -apple-system, "PingFang SC", sans-serif';
// 无分组信息时的兜底色（草稿箭头/历史数据）
const FALLBACK_COLOR = 0x8b93a7;

export class RelationArrowBlock extends PixiBlock {
  static type = "relation-arrow";
  // zoom 常量：线宽/箭头/标签按屏幕像素渲染（1/scale 反向补偿），缩放时重绘
  override renderOnZoom = true;

  // 绑定期几何解析：每次文档更新都会对所有 block 重算 blockState，卡片/锚点/弯曲变化即触发重绘
  blockStateSelector = (state: PomeloEditorState) => {
    const fromId = String(this.record.attrs.fromId ?? "");
    const toId = String(this.record.attrs.toId ?? "");
    const from = state.getBlockById(fromId);
    const to = state.getBlockById(toId);
    const geo = relationGeometry(from, to, this.record.attrs as { fromAnchor?: { x: number; y: number }; toAnchor?: { x: number; y: number }; bend?: { dx: number; dy: number } });
    return {
      fromId,
      toId,
      geo,
      label: String(this.record.attrs.label ?? ""),
    };
  };

  renderBlock() {
    const state = this.blockState as { geo: RelationGeometry | null; label: string } | null;
    const geo = state?.geo;
    if (!geo) return new PIXI.Container();
    // 分组色（T5/B.10）：people/world/story/video 四组；无分组回退中性灰蓝
    const color = relationGroupColor(String(this.record.attrs.group ?? "")) || FALLBACK_COLOR;

    // zoom 常量补偿：世界坐标几何随视口缩放，尺寸再乘 1/scale 保持屏幕像素恒定
    const s = this.screenScale;
    const inv = 1 / s;

    const container = new PIXI.Container();
    const g = new PIXI.Graphics();

    // 曲线主体：只画节点外段（[ta, tb]）；统一实线（挂接线/属性边与语义关系仅靠颜色/标签区分，虚线辨识度差）
    const segment = curveSegment(geo, geo.ta, geo.tb);
    g.lineStyle(2 * inv, color, 0.95);
    g.moveTo(segment.p0.x, segment.p0.y);
    g.quadraticCurveTo(segment.cp.x, segment.cp.y, segment.p2.x, segment.p2.y);
    container.addChild(g);

    // 箭头：沿曲线在边界 b 处的切线方向（三角形在锚点局部坐标内画，容器整体反向缩放）
    const tangent = bezierTangent(geo.curve.p0, geo.curve.cp, geo.curve.p2, geo.tb);
    const angle = Math.atan2(tangent.y, tangent.x);
    const headLength = 11;
    const headWidth = 9;
    const head = new PIXI.Container();
    head.position.set(geo.b.x, geo.b.y);
    head.rotation = angle;
    head.scale.set(inv);
    const headG = new PIXI.Graphics();
    headG.lineStyle(0);
    headG.beginFill(color);
    headG.moveTo(0, 0);
    headG.lineTo(-headLength, headWidth / 2);
    headG.lineTo(-headLength, -headWidth / 2);
    headG.closePath();
    headG.endFill();
    head.addChild(headG);
    container.addChild(head);

    if (state?.label) {
      // 标签层：以曲线中点为锚点整体反向缩放，字号/圆角/偏移保持屏幕像素恒定；
      // 同对多边标签沿曲线法向错开（T5：±14px/条，屏幕像素）
      const mid = geo.mid;
      const labelLayer = new PIXI.Container();
      const offsetIndex = Number(this.record.attrs.labelOffsetIndex ?? 0);
      if (offsetIndex > 0) {
        const midTangent = bezierTangent(geo.curve.p0, geo.curve.cp, geo.curve.p2, 0.5);
        const len = Math.hypot(midTangent.x, midTangent.y) || 1;
        const side = offsetIndex % 2 === 1 ? 1 : -1;
        const level = Math.ceil(offsetIndex / 2);
        const px = ((level * 14 * side) / len) * inv;
        labelLayer.position.set(mid.x - midTangent.y * px, mid.y + midTangent.x * px);
      } else {
        labelLayer.position.set(mid.x, mid.y);
      }
      labelLayer.scale.set(inv);
      const text = new PIXI.Text(truncateText(state.label, 120, 10), {
        fontFamily: FONT,
        fontSize: 10,
        fill: 0xa1a1aa,
        align: "center",
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(0, -8);
      const bg = new PIXI.Graphics();
      bg.beginFill(0x0f1410, 0.92);
      bg.lineStyle(1, 0xffffff, 0.1, 1);
      bg.drawRoundedRect(-text.width / 2 - 7, -17, text.width + 14, 18, 9);
      bg.endFill();
      labelLayer.addChild(bg);
      labelLayer.addChild(text);
      container.addChild(labelLayer);
    }

    container.eventMode = "none";
    return container;
  }
}

