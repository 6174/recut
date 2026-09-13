/*
 * [INPUT]: 依赖 vello-block（VelloBlock）、op-bridge（VelloOp）
 * [OUTPUT]: 对外提供 DemoCardBlock：一个最小可用的 VelloBlock 示例（圆角卡 + 标题），
 *           绘制经 vello op 上屏。
 * [POS]: pomelo-vello 的示例 block（M2 验证用）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloBlockRecord } from "../pomelo-core/pomelo-renderer/pomelo-block";
import { VelloBlock, type VelloBlockDraw } from "./vello-block";
import type { Rgba } from "./op-bridge";

function hexToRgba(hex: string, alpha = 255): Rgba {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16) || 0;
  const g = Number.parseInt(value.slice(2, 4), 16) || 0;
  const b = Number.parseInt(value.slice(4, 6), 16) || 0;
  return [r, g, b, alpha];
}

export class DemoCardBlock extends VelloBlock {
  static type = "demo-card";

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const width = Number(attrs.width) || 200;
    const height = Number(attrs.height) || 120;
    const title = String(attrs.title ?? "Card");
    const accent = String(attrs.accent ?? "#3b82f6");
    const accentColor = hexToRgba(accent);

    const ops = [
      { kind: "roundRect" as const, x, y, width, height, radius: 14, fill: [20, 21, 26, 255] as Rgba, stroke: accentColor, strokeWidth: 2 },
      { kind: "rectFill" as const, x, y, width, height: 40, fill: [accentColor[0], accentColor[1], accentColor[2], 60] as Rgba },
      { kind: "text" as const, fontId: 1, x: x + 16, y: y + 12, size: 18, maxWidth: width - 32, align: "left" as const, fill: [229, 231, 235, 255] as Rgba, text: title },
    ];

    return { ops, bounds: { minX: x, minY: y, maxX: x + width, maxY: y + height } };
  }
}

export function demoCardRecord(id: string, x: number, y: number, title: string, accent: string): PomeloBlockRecord {
  return { id, type: DemoCardBlock.type, attrs: { x, y, width: 260, height: 140, title, accent } };
}
