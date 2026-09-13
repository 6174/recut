/*
 * [INPUT]: 依赖 arrow-geometry（setNodeRectResolver）
 * [OUTPUT]: 对外提供实体卡有效矩形与内容固有高度的渲染器无关单一实现（entityCardContentHeight / entityCardRect /
 *           entityCardThumbColumns：资料缩略图按卡宽自适应列数），并向 arrow-geometry 注册节点矩形解析器，
 *           保证连线几何与渲染所见一致
 * [POS]: lib/pomelo/world-canvas 的实体卡几何 metrics（vello block 与业务命中/选区/连线共用，无渲染器依赖）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { setNodeRectResolver } from "../arrow-geometry";

const PAD = 14;
const IMAGE_H = 160;
const THUMB = 30;
const THUMB_GAP = 5;
const MIN_W = 240;
const TEXT_BLOCK_H = 76;

function stringListOf(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]).filter((item) => typeof item === "string" && item) : [];
}

// 资料缩略图每行数量：按卡片可用宽度自适应换行（不再固定九宫格）。
// 渲染（entity-card-block-v）与内容高度共用同一函数，保证行数/高度一致。
export function entityCardThumbColumns(attrs: Record<string, unknown>): number {
  const width = Math.max(Number(attrs.width) || 264, MIN_W);
  const available = width - PAD * 2;
  return Math.max(1, Math.floor((available + THUMB_GAP) / (THUMB + THUMB_GAP)));
}

// 内容固有高度：有头图 = 头图 + 文本区；无头图 = 纯文本优先；有资料时按宽度算列数后追加缩略行
export function entityCardContentHeight(attrs: Record<string, unknown>): number {
  const count = Math.max(stringListOf(attrs.photos).length, stringListOf(attrs.photoUrls).length);
  const hasCover = Boolean(String(attrs.coverUrl ?? "") || String(attrs.cover ?? ""));
  const textTop = (hasCover ? IMAGE_H + 52 : TEXT_BLOCK_H) + PAD;
  if (count <= 0) return textTop;
  const rows = Math.ceil(count / entityCardThumbColumns(attrs));
  return textTop + rows * THUMB + (rows - 1) * THUMB_GAP + PAD;
}

// 实体卡的有效渲染矩形（attrs 可能存有旧的更小尺寸；命中/选区/连线锚点必须与渲染一致）
export function entityCardRect(attrs: Record<string, unknown>): { x: number; y: number; width: number; height: number } {
  return {
    x: Number(attrs.x) || 0,
    y: Number(attrs.y) || 0,
    width: Math.max(Number(attrs.width) || 264, MIN_W),
    height: Math.max(Number(attrs.height) || 0, entityCardContentHeight(attrs)),
  };
}

// 注册连线几何的实体卡有效矩形解析（箭头锚点/边界与渲染所见一致）
setNodeRectResolver((record) => (record.type === "entity-card" ? entityCardRect(record.attrs as Record<string, unknown>) : null));
