/*
 * [INPUT]: 依赖 pomelo-vello（VelloBlock/VelloOp）、world-canvas/graph-theme（配色单一真源、rgba 解析 hex 底色）、
 *          world-canvas/blocks/vello-shared（isLowDetail/captionOpsV/screenScaleOf）、group/group-metrics（圆角）
 * [OUTPUT]: 对外提供 GroupBlockV（type: group）：置底的分组容器——圆角填充 + 柔和描边的纯面；
 *           名称按**与其他节点一致的「卡片外上方」徽标**绘制（captionOpsV，屏幕像素恒定、不会被成员卡挡住）；
 *           zIndex=-2（低于 relation-arrow 的 -1 与所有内容节点，保证容器永远在成员之下）；
 *           低细节视口只留填充面、隐藏标题；无背景（透明）时回退 graph-theme 的 groupFill。
 * [POS]: lib/pomelo/world-canvas/blocks 的分组容器 vello block。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { VelloBlock, type VelloBlockDraw } from "../../pomelo-vello/vello-block";
import type { VelloOp } from "../../pomelo-vello/op-bridge";
import { GRAPH_COLORS, GROUP_FILL, GROUP_STROKE, rgba } from "../graph-theme";
import { CAPTION_TOP_OFFSET, captionOpsV, isLowDetail, screenScaleOf } from "./vello-shared";
import { GROUP_RADIUS } from "../group/group-metrics";

// 拖拽/缩放中的容器填充透明度：组在会话里被抬到最上层，不把下方成员盖住才看得到内容
const DRAGGING_ALPHA = 90;

function fillOf(attrs: Record<string, unknown>) {
  const dragging = attrs.dragging === true;
  const background = String(attrs.background ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(background)) return rgba(background, dragging ? DRAGGING_ALPHA : 255);
  return dragging ? rgba(GRAPH_COLORS.groupFill, DRAGGING_ALPHA) : GROUP_FILL;
}

/** 分组容器：置底圆角容器；名称与其他节点同款「卡片外上方」徽标（captionOpsV），永不被成员遮挡。 */
export class GroupBlockV extends VelloBlock {
  static type = "group";
  override renderOnZoom = true;
  /** 低于连线（-1）与内容节点（0），永远画在最底层。 */
  override zIndex = -2;

  protected blockBounds() {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 0;
    const h = Number(attrs.height) || 0;
    // 徽标画在容器上方：bounds 上探 CAPTION_TOP_OFFSET（屏幕像素），避免标题落在瓦片外被裁
    const scale = screenScaleOf(this.adapter);
    return { minX: x, minY: y - (CAPTION_TOP_OFFSET + 2) / scale, maxX: x + w, maxY: y + h };
  }

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 0;
    const h = Number(attrs.height) || 0;
    const name = String(attrs.name ?? "");
    const ops: VelloOp[] = [
      { kind: "roundRect", x, y, width: w, height: h, radius: GROUP_RADIUS, fill: fillOf(attrs), stroke: GROUP_STROKE, strokeWidth: 1.5 },
    ];
    // 名称 = 卡片外上方徽标，与 note/entity-card/media 同一 captionOpsV 语义（不被组内成员卡覆盖）
    if (!isLowDetail(this.adapter)) ops.push(...captionOpsV(this.adapter, x, y, w, name).ops);
    return { ops, bounds: this.blockBounds() };
  }
}
