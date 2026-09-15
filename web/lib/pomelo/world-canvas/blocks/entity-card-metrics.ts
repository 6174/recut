/*
 * [INPUT]: 依赖 arrow-geometry（setNodeRectResolver）
 * [OUTPUT]: 对外提供实体卡 flex 布局度量与有效矩形的渲染器无关单一实现
 *           （entityCardContentHeight / entityCardRect / entityCardBottomHeight / entityCardImageHeight /
 *           entityCardTextTop / entityCardThumbTop / entityCardTitleHeight / entityCardThumbColumns），
 *           并向 arrow-geometry 注册节点矩形解析器，保证连线几何与渲染所见一致
 * [POS]: lib/pomelo/world-canvas 的实体卡几何 metrics（vello block 与业务命中/选区/连线共用，无渲染器依赖）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 *
 * 布局模型（对齐 CSS flex column）：
 *   卡片 = 头图区（flex:1，center-cover） + 底部内容区（固定高度：标题 + 副标题 + 缩略图 + 上下内边距）。
 *   底部内容区高度由内容决定（entityCardBottomHeight）；卡片拉伸出的多余高度全部给头图，
 *   头图不足时保底 MIN_IMAGE_H；头图只在自身区域内绘制（不侵入底部文字区）。
 */
import { setNodeRectResolver } from "../arrow-geometry";

export const ENTITY_CARD_PAD = 14;
const CARD_RADIUS = 14;
const MIN_IMAGE_H = 120;
const THUMB = 30;
const THUMB_GAP = 5;
const THUMB_SECTION_GAP = 12;
const MIN_W = 240;
const TITLE_H_COVER = 24;
const SUMMARY_H_COVER = 14;
const TITLE_H_PLAIN = 30;
const SUMMARY_H_PLAIN = 18;

function stringListOf(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]).filter((item) => typeof item === "string" && item) : [];
}

export function entityCardHasCover(attrs: Record<string, unknown>): boolean {
  return Boolean(String(attrs.coverUrl ?? "") || String(attrs.cover ?? ""));
}

// 资料缩略图每行数量：按卡片可用宽度自适应换行（不再固定九宫格）。
// 渲染（entity-card-block-v）与内容高度共用同一函数，保证行数/高度一致。
export function entityCardThumbColumns(attrs: Record<string, unknown>): number {
  const width = Math.max(Number(attrs.width) || 264, MIN_W);
  const available = width - ENTITY_CARD_PAD * 2;
  return Math.max(1, Math.floor((available + THUMB_GAP) / (THUMB + THUMB_GAP)));
}

function entityCardThumbCount(attrs: Record<string, unknown>): number {
  return Math.max(stringListOf(attrs.photos).length, stringListOf(attrs.photoUrls).length);
}

function entityCardThumbRows(attrs: Record<string, unknown>): number {
  const count = entityCardThumbCount(attrs);
  return count <= 0 ? 0 : Math.ceil(count / entityCardThumbColumns(attrs));
}

/** 缩略图网格高度（0 行时为 0）。 */
export function entityCardThumbBlockHeight(attrs: Record<string, unknown>): number {
  const rows = entityCardThumbRows(attrs);
  return rows <= 0 ? 0 : rows * THUMB + (rows - 1) * THUMB_GAP;
}

/** 底部内容区高度（标题 + 副标题 + 缩略图 + 上下内边距）：flex 布局中"固定"的部分。 */
export function entityCardBottomHeight(attrs: Record<string, unknown>): number {
  const hasCover = entityCardHasCover(attrs);
  const titleH = hasCover ? TITLE_H_COVER : TITLE_H_PLAIN;
  const summaryH = hasCover ? SUMMARY_H_COVER : SUMMARY_H_PLAIN;
  const thumbH = entityCardThumbBlockHeight(attrs);
  const thumbSection = thumbH > 0 ? THUMB_SECTION_GAP + thumbH : 0;
  return ENTITY_CARD_PAD + titleH + summaryH + thumbSection + ENTITY_CARD_PAD;
}

/** 头图区高度 = 卡片高度减去底部内容区（flex:1），不足时保底 MIN_IMAGE_H；无头图返回 0。 */
export function entityCardImageHeight(attrs: Record<string, unknown>, height: number): number {
  if (!entityCardHasCover(attrs)) return 0;
  return Math.max(MIN_IMAGE_H, height - entityCardBottomHeight(attrs));
}

/** 标题文字顶边相对卡片顶边的偏移（头图区高度 + 上内边距）。 */
export function entityCardTextTop(attrs: Record<string, unknown>, height: number): number {
  return entityCardImageHeight(attrs, height) + ENTITY_CARD_PAD;
}

/** 缩略图网格顶边相对卡片顶边的偏移。 */
export function entityCardThumbTop(attrs: Record<string, unknown>, height: number): number {
  const hasCover = entityCardHasCover(attrs);
  const titleH = hasCover ? TITLE_H_COVER : TITLE_H_PLAIN;
  const summaryH = hasCover ? SUMMARY_H_COVER : SUMMARY_H_PLAIN;
  return entityCardTextTop(attrs, height) + titleH + summaryH + THUMB_SECTION_GAP;
}

export function entityCardTitleHeight(attrs: Record<string, unknown>): number {
  return entityCardHasCover(attrs) ? TITLE_H_COVER : TITLE_H_PLAIN;
}

// 内容固有高度：头图区保底 MIN_IMAGE_H + 底部内容区；无头图 = 纯底部内容区
export function entityCardContentHeight(attrs: Record<string, unknown>): number {
  const bottom = entityCardBottomHeight(attrs);
  return entityCardHasCover(attrs) ? MIN_IMAGE_H + bottom : bottom;
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

// 头图裁剪用的圆角半径（与卡面一致，仅顶部两角生效）
export const ENTITY_CARD_RADIUS = CARD_RADIUS;

// 注册连线几何的实体卡有效矩形解析（箭头锚点/边界与渲染所见一致）
setNodeRectResolver((record) => (record.type === "entity-card" ? entityCardRect(record.attrs as Record<string, unknown>) : null));
