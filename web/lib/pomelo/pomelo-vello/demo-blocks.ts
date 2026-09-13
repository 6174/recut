/*
 * [INPUT]: 依赖 vello-block（VelloBlock）、op-bridge（VelloOp）
 * [OUTPUT]: 对外提供 DemoCardBlock：一个最小可用的 VelloBlock 示例（圆角卡 + 标题），
 *           同一份绘制同时给 vello op 与 Canvas2D painter。
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class DemoCardBlock extends VelloBlock {
  static type = "demo-card";

  protected renderBlock(): VelloBlockDraw {
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

    const canvas = (ctx: CanvasRenderingContext2D) => {
      roundRect(ctx, x, y, width, height, 14);
      ctx.fillStyle = "#14151a";
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = accent;
      ctx.fillRect(x, y, width, 40);
      ctx.restore();
      ctx.lineWidth = 2;
      ctx.strokeStyle = accent;
      roundRect(ctx, x + 1, y + 1, width - 2, height - 2, 14);
      ctx.stroke();
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "600 18px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(title, x + 16, y + 12);
    };

    return { ops, bounds: { minX: x, minY: y, maxX: x + width, maxY: y + height }, canvas };
  }
}

export function demoCardRecord(id: string, x: number, y: number, title: string, accent: string): PomeloBlockRecord {
  return { id, type: DemoCardBlock.type, attrs: { x, y, width: 260, height: 140, title, accent } };
}
