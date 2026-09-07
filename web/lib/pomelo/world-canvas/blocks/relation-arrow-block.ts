/*
 * [INPUT]: 依赖 pixi.js 与 pomelo-core（PixiBlock / PomeloEditorState）
 * [OUTPUT]: 对外提供 RelationArrowBlock（type: relation-arrow）：绑定两端的实体卡 Block，
 * blockStateSelector 读取两端卡片的实时几何派生起终点（等价 tldraw 的 terminal 绑定解析），
 * 卡片移动时随文档更新自动重算并重绘；渲染直线 + 箭头 + 关系标签
 * [POS]: lib/pomelo/world-canvas 的关系连线 Block（学习 tldraw ArrowBindingUtil 的绑定式连线思路，
 * 简化为「绑定期派生几何」：绑定关系存于 demo-store.relations，几何在每次渲染时解析）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";
import { PixiBlock } from "../../pomelo-core/pomelo-pixi/pomelo-pixi-block";
import type { PomeloEditorState } from "../../pomelo-core/pomelo-state";
import { truncateText } from "../truncate-text";

const FONT = 'system-ui, -apple-system, "PingFang SC", sans-serif';

type Point = { x: number; y: number };

export function centerOf(block: ReturnType<PomeloEditorState["getBlockById"]>): Point | null {
  if (!block) return null;
  const x = Number(block.attrs.x) || 0;
  const y = Number(block.attrs.y) || 0;
  const width = Number(block.attrs.width) || 200;
  const height = Number(block.attrs.height) || 110;
  return { x: x + width / 2, y: y + height / 2 };
}

// 从中心射线与卡片矩形边界求交，得到边框锚点（替代 tldraw 的 normalizedAnchor 大纲吸附）
export function edgeAnchor(center: Point, target: Point, width: number, height: number): Point {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const halfW = width / 2;
  const halfH = height / 2;
  const scaleX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const t = Math.min(scaleX, scaleY);
  return { x: center.x + dx * t, y: center.y + dy * t };
}

export class RelationArrowBlock extends PixiBlock {
  static type = "relation-arrow";

  // 绑定期几何解析：每次文档更新都会对所有 block 重算 blockState，卡片移动即触发箭头重绘
  blockStateSelector = (state: PomeloEditorState) => {
    const fromId = String(this.record.attrs.fromId ?? "");
    const toId = String(this.record.attrs.toId ?? "");
    const from = state.getBlockById(fromId);
    const to = state.getBlockById(toId);
    return {
      fromId,
      toId,
      start: centerOf(from) ?? null,
      end: centerOf(to) ?? null,
      fromSize: { width: Number(from?.attrs.width) || 200, height: Number(from?.attrs.height) || 110 },
      toSize: { width: Number(to?.attrs.width) || 200, height: Number(to?.attrs.height) || 110 },
      label: String(this.record.attrs.label ?? ""),
    };
  };

  renderBlock() {
    const state = this.blockState as {
      start: Point | null;
      end: Point | null;
      fromSize: { width: number; height: number };
      toSize: { width: number; height: number };
      label: string;
    } | null;
    const { start, end, fromSize, toSize, label } = state ?? { start: null, end: null, fromSize: { width: 200, height: 110 }, toSize: { width: 200, height: 110 }, label: "" };
    if (!start || !end) return new PIXI.Container();

    const container = new PIXI.Container();
    const g = new PIXI.Graphics();

    const a = edgeAnchor(start, end, fromSize.width, fromSize.height);
    const b = edgeAnchor(end, start, toSize.width, toSize.height);

    g.lineStyle(2, 0x93a2c4, 0.9);
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);

    // 箭头（tldraw 的 arrowhead 简化为固定三角：tip + 垂直底边）
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const headLength = 11;
    const headWidth = 9;
    const perpX = -Math.sin(angle);
    const perpY = Math.cos(angle);
    const baseX = b.x - headLength * Math.cos(angle);
    const baseY = b.y - headLength * Math.sin(angle);
    g.lineStyle(0);
    g.beginFill(0x93a2c4);
    g.moveTo(b.x, b.y);
    g.lineTo(baseX + (headWidth / 2) * perpX, baseY + (headWidth / 2) * perpY);
    g.lineTo(baseX - (headWidth / 2) * perpX, baseY - (headWidth / 2) * perpY);
    g.closePath();
    g.endFill();

    container.addChild(g);

    if (label) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const text = new PIXI.Text(truncateText(label, 120, 10), {
        fontFamily: FONT,
        fontSize: 10,
        fill: 0x9aa6c0,
        align: "center",
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(mid.x, mid.y - 8);
      const bg = new PIXI.Graphics();
      bg.beginFill(0x0d1322, 0.85);
      bg.drawRoundedRect(mid.x - text.width / 2 - 6, mid.y - 16, text.width + 12, 16, 6);
      bg.endFill();
      container.addChild(bg);
      container.addChild(text);
    }

    container.eventMode = "none";
    return container;
  }
}
