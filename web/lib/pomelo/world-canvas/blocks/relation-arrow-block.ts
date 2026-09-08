/*
 * [INPUT]: 依赖 pixi.js、pomelo-core（PixiBlock / PomeloEditorState）与 arrow-geometry（共享几何）
 * [OUTPUT]: 对外提供 RelationArrowBlock（type: relation-arrow）：绑定两端的实体卡 Block，
 * 几何由 anchor（默认节点中心，可被控制点调整）+ bend（中间控制点，控制曲线）经 relationGeometry
 * 解析为二次贝塞尔曲线；渲染曲线 + 沿切线箭头 + 曲线中点关系标签；颜色按 attrs.relationType
 * 的关系语义色着色（relationColors，真实案例设计）
 * [POS]: lib/pomelo/world-canvas 的关系连线 Block（学习 tldraw ArrowBindingUtil 的绑定式连线思路：
 * 绑定关系存于 demo-store.relations，几何在每次渲染时解析）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";
import { PixiBlock } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-block";
import type { PomeloEditorState } from "../../pomelo-core/pomelo-state";
import { truncateText } from "../truncate-text";
import { bezierTangent, curveSegment, relationGeometry, type RelationGeometry } from "../arrow-geometry";

const FONT = 'system-ui, -apple-system, "PingFang SC", sans-serif';
// 统一关系线：中性灰蓝，不按 relationType 着色（统一视觉）
const LINE_COLOR = 0x8b93a7;

export class RelationArrowBlock extends PixiBlock {
  static type = "relation-arrow";

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
    // 统一中性色：连线/箭头/标签不再按 relationType 着色
    const color = LINE_COLOR;

    const container = new PIXI.Container();
    const g = new PIXI.Graphics();

    // 曲线主体：只画节点外段（[ta, tb]），节点内不画（未选中时 tldraw 同款）
    const segment = curveSegment(geo, geo.ta, geo.tb);
    g.lineStyle(2, color, 0.95);
    g.moveTo(segment.p0.x, segment.p0.y);
    g.quadraticCurveTo(segment.cp.x, segment.cp.y, segment.p2.x, segment.p2.y);

    // 箭头：沿曲线在边界 b 处的切线方向
    const tangent = bezierTangent(geo.curve.p0, geo.curve.cp, geo.curve.p2, geo.tb);
    const angle = Math.atan2(tangent.y, tangent.x);
    const headLength = 11;
    const headWidth = 9;
    const perpX = -Math.sin(angle);
    const perpY = Math.cos(angle);
    const baseX = geo.b.x - headLength * Math.cos(angle);
    const baseY = geo.b.y - headLength * Math.sin(angle);
    g.lineStyle(0);
    g.beginFill(color);
    g.moveTo(geo.b.x, geo.b.y);
    g.lineTo(baseX + (headWidth / 2) * perpX, baseY + (headWidth / 2) * perpY);
    g.lineTo(baseX - (headWidth / 2) * perpX, baseY - (headWidth / 2) * perpY);
    g.closePath();
    g.endFill();

    container.addChild(g);

    if (state?.label) {
      const mid = geo.mid;
      const text = new PIXI.Text(truncateText(state.label, 120, 10), {
        fontFamily: FONT,
        fontSize: 10,
        fill: 0xa1a1aa,
        align: "center",
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(mid.x, mid.y - 8);
      const bg = new PIXI.Graphics();
      bg.beginFill(0x0f1410, 0.92);
      bg.lineStyle(1, 0xffffff, 0.1, 1);
      bg.drawRoundedRect(mid.x - text.width / 2 - 7, mid.y - 17, text.width + 14, 18, 9);
      bg.endFill();
      container.addChild(bg);
      container.addChild(text);
    }

    container.eventMode = "none";
    return container;
  }
}

