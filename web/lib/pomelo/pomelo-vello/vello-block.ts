/*
 * [INPUT]: 依赖 pomelo-core（PomeloBlock）、pomelo-tiles（TileWorldBounds）、op-bridge（VelloOp）
 * [OUTPUT]: 对外提供 VelloBlock：pomelo 的 block 基类，renderBlock() 产出 vello op（+ 可选 Canvas2D painter，
 *           供软件光栅器回退）；render()/reposition() 分别标记内容/位置版本，供适配器做增量瓦片失效。
 * [POS]: pomelo-vello 的 block 基类（替代 PixiBlock），world-canvas 各 block 迁移目标。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { PomeloBlock } from "../pomelo-core/pomelo-renderer";
import type { TileWorldBounds } from "../pomelo-core/pomelo-tiles/types";
import type { VelloOp } from "./op-bridge";

export interface VelloBlockDraw {
  ops: VelloOp[];
  bounds: TileWorldBounds;
  /** 可选：Canvas2D 回退绘制（同一个 block 同时支持 vello 与软件光栅器）。 */
  canvas?: (ctx: CanvasRenderingContext2D) => void;
}

export abstract class VelloBlock extends PomeloBlock {
  /** 每次 renderBlock 递增；适配器据此重编码 chunk。 */
  drawVersion = 0;
  /** 每次 reposition 递增；适配器据此只挪 bounds、不重编码。 */
  boundsVersion = 0;
  ops: VelloOp[] = [];
  bounds: TileWorldBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  canvasPainter?: (ctx: CanvasRenderingContext2D) => void;

  /** 子类实现：由 attrs 产出绘制 op 与世界矩形。 */
  protected abstract renderBlock(): VelloBlockDraw;

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
    this.canvasPainter = draw.canvas;
    this.drawVersion++;
  }

  /** 仅位置变化：attrs 已由 patch 更新，重算 bounds，不重编码 op。 */
  reposition(): void {
    this.bounds = this.blockBounds();
    this.boundsVersion++;
  }

  // attrs 任一变化都触发重渲染（默认 selector 恒 null 会导致文档更新不重绘）
  override blockStateSelector = (state: Parameters<PomeloBlock["computeBlockState"]>[0]) => {
    const record = state.getBlockById(this.record.id);
    return record ? JSON.stringify(record.attrs) : null;
  };
}
