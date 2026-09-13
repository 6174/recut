/*
 * [INPUT]: 依赖 pomelo-core（PomeloBlock）、pomelo-tiles（TileWorldBounds）、op-bridge（VelloOp/Vec2）
 * [OUTPUT]: 对外提供 VelloBlock：pomelo 的 block 基类，renderBlock() 产出 vello op（+ 可选 Canvas2D painter，
 *           供软件光栅器回退）；render()/reposition() 分别标记内容/位置版本，供适配器做增量失效。
 *           reposition() 对 op 做平移（vello op 内嵌世界坐标，不能只挪 bounds），并同步包裹 Canvas2D painter，
 *           避免拖拽高频路径下画面滞后/闪动；纯 x/y 变化不触发全量 renderBlock（blockStateSelector 忽略 x/y）。
 * [POS]: pomelo-vello 的 block 基类（替代 PixiBlock），world-canvas 各 block 迁移目标。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { PomeloBlock } from "../pomelo-core/pomelo-renderer";
import type { PomeloStateSelector } from "../pomelo-core/pomelo-state";
import type { TileWorldBounds } from "../pomelo-core/pomelo-tiles/types";
import type { Vec2, VelloOp } from "./op-bridge";

export interface VelloBlockDraw {
  ops: VelloOp[];
  bounds: TileWorldBounds;
  /** 可选：Canvas2D 回退绘制（同一个 block 同时支持 vello 与软件光栅器）。 */
  canvas?: (ctx: CanvasRenderingContext2D) => void;
}

/** 位置平移：vello op 内嵌世界坐标，拖拽时按 delta 平移全部坐标字段（O(n) 且不重跑文本/图片）。 */
export function translateVelloOps(ops: VelloOp[], dx: number, dy: number): VelloOp[] {
  if (dx === 0 && dy === 0) return ops;
  return ops.map((op) => {
    switch (op.kind) {
      case "roundRect":
      case "rectFill":
      case "text":
      case "image":
      case "blurRect":
      case "pushClipRoundRect":
        return { ...op, x: op.x + dx, y: op.y + dy };
      case "quadStroke":
        return {
          ...op,
          p0: [op.p0[0] + dx, op.p0[1] + dy] as Vec2,
          cp: [op.cp[0] + dx, op.cp[1] + dy] as Vec2,
          p1: [op.p1[0] + dx, op.p1[1] + dy] as Vec2,
        };
      case "triangleFill":
        return {
          ...op,
          points: op.points.map((p) => [p[0] + dx, p[1] + dy] as Vec2) as [Vec2, Vec2, Vec2],
        };
      case "popClip":
      default:
        return op;
    }
  });
}

export abstract class VelloBlock extends PomeloBlock {
  /** 每次 renderBlock 递增；适配器据此重编码 chunk。 */
  drawVersion = 0;
  /** 每次 reposition 递增；适配器据此只挪 bounds、不重编码。 */
  boundsVersion = 0;
  /** true 时视口缩放变化触发重绘（用于屏幕像素恒定的徽标/文字）。 */
  renderOnZoom = false;
  ops: VelloOp[] = [];
  bounds: TileWorldBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  canvasPainter?: (ctx: CanvasRenderingContext2D) => void;
  /** render() 产出的原始 painter（未叠加位置偏移），reposition 时基于它重建包裹层。 */
  private basePainter?: (ctx: CanvasRenderingContext2D) => void;
  private offsetX = 0;
  private offsetY = 0;

  /** 子类实现：由 attrs 产出绘制 op 与世界矩形。 */
  abstract renderBlock(): VelloBlockDraw;

  /** 由 attrs 推导世界矩形（默认读 x/y/width/height）。 */
  protected blockBounds(): TileWorldBounds {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const width = Number(attrs.width) || 0;
    const height = Number(attrs.height) || 0;
    return { minX: x, minY: y, maxX: x + width, maxY: y + height };
  }

  render(): void {
    const draw = this.renderBlock();
    this.ops = draw.ops;
    this.bounds = draw.bounds;
    this.basePainter = draw.canvas;
    this.offsetX = 0;
    this.offsetY = 0;
    this.canvasPainter = draw.canvas;
    this.drawVersion++;
  }

  /**
   * 仅位置变化（x/y）：attrs 已由 patch 更新，按 delta 平移已有 op 与 painter。
   * vello op 内嵌世界坐标，若只挪 bounds 会让画面停在旧位置（拖拽滞后/闪动）；
   * 平移 op 后必须递增 drawVersion，适配器才会重编码 chunk payload。
   */
  reposition(): void {
    const previous = this.bounds;
    const next = this.blockBounds();
    const dx = next.minX - previous.minX;
    const dy = next.minY - previous.minY;
    this.bounds = next;
    if (dx !== 0 || dy !== 0) {
      this.ops = translateVelloOps(this.ops, dx, dy);
      this.offsetX += dx;
      this.offsetY += dy;
      const base = this.basePainter;
      this.canvasPainter = base
        ? (ctx: CanvasRenderingContext2D) => {
            ctx.save();
            ctx.translate(this.offsetX, this.offsetY);
            base(ctx);
            ctx.restore();
          }
        : undefined;
      this.drawVersion++;
    }
    this.boundsVersion++;
  }

  /**
   * attrs 变化触发重渲染，但忽略 x/y：纯位置变更走 BlockPatcher 的 reposition 快路径
   * （translateVelloOps），避免拖拽每帧全量 renderBlock（图片/文本重栅格）。
   */
  override blockStateSelector: PomeloStateSelector<any> = (state) => {
    const record = state.getBlockById(this.record.id);
    if (!record) return null;
    // 剔除顶层 x/y：纯位置变更由 reposition（translateVelloOps）处理，不触发全量 renderBlock
    return JSON.stringify(record.attrs, (key, value) => (key === "x" || key === "y" ? undefined : value));
  };
}
