/*
 * [INPUT]: 依赖 arrow-geometry（addNodeRectResolver）、graph-theme（字号 GRAPH_TEXT）
 * [OUTPUT]: 对外提供实体卡 flex 布局度量与有效矩形的渲染器无关单一实现
 *           （entityCardCoverHeight / entityCardContentHeight / entityCardRect / entityCardBottomHeight / entityCardImageHeight /
 *           entityCardTextTop / entityCardThumbTop / entityCardTitleHeight / entityCardSummaryHeight /
 *           entityCardThumbColumns / entityCardThumbBlockHeight、ENTITY_CARD_THUMB / ENTITY_CARD_THUMB_GAP、
 *           ENTITY_TITLE_SIZE / ENTITY_SUMMARY_SIZE），
 *           并向 arrow-geometry 注册节点矩形解析器，保证连线几何与渲染所见一致
 * [POS]: lib/pomelo/world-canvas 的实体卡几何 metrics（vello block 与业务命中/选区/连线共用，无渲染器依赖）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 *
 * 布局模型（单一骨架，高度一律由内容派生）：
 *   有封面：媒体区 = 封面比例定尺（entityCardCoverHeight，与图片 Block 同一适应模式），卡片高度 = 媒体区 + footer；
 *   无封面：媒体区 = 占位保底（MIN_MEDIA_H_PLAIN），卡片高度 = 媒体区 + footer。
 *   实体卡不支持 resize（resize 白名单见 world-canvas/resize-policy），忽略存储高度，保证新建与既有卡片同高。
 */
import { addNodeRectResolver } from "../arrow-geometry";
import { GRAPH_TEXT } from "../graph-theme";

export const ENTITY_CARD_PAD = 14;
const CARD_RADIUS = 16;
// 媒体区高度界限：有真实封面时按比例在此区间内（保底大一些，图片可读），仅占位时用小保底
const MIN_MEDIA_H_COVER = 120;
const MAX_MEDIA_H_COVER = 420;
const MIN_MEDIA_H_PLAIN = 84;
export const ENTITY_CARD_THUMB = 30;
export const ENTITY_CARD_THUMB_GAP = 5;
const THUMB = ENTITY_CARD_THUMB;
const THUMB_GAP = ENTITY_CARD_THUMB_GAP;
const THUMB_SECTION_GAP = 12;
const MIN_W = 240;
// 字号与行高盒（footer 主/副行）
export const ENTITY_TITLE_SIZE = GRAPH_TEXT.entityTitle;
export const ENTITY_SUMMARY_SIZE = GRAPH_TEXT.entitySummary;
const TITLE_H = 26;
const SUMMARY_H = 16;

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

/** footer 高度（标题 + 副标题 + 缩略图 + 上下内边距）：flex 布局中"固定"的部分。 */
export function entityCardBottomHeight(attrs: Record<string, unknown>): number {
  const thumbH = entityCardThumbBlockHeight(attrs);
  const thumbSection = thumbH > 0 ? THUMB_SECTION_GAP + thumbH : 0;
  return ENTITY_CARD_PAD + TITLE_H + SUMMARY_H + thumbSection + ENTITY_CARD_PAD;
}

/** 封面区高度：有封面时按封面比例定尺（宽锚卡片宽度、高夹 [120, 420]，与图片 Block 同一适应模式）；
 *  封面比例尚未测得（attrs.coverAspect 缺席）时用保底；无封面 = 占位保底。 */
export function entityCardCoverHeight(attrs: Record<string, unknown>): number {
  if (!entityCardHasCover(attrs)) return MIN_MEDIA_H_PLAIN;
  const width = Math.max(Number(attrs.width) || 264, MIN_W);
  const aspect = Number(attrs.coverAspect);
  if (!(aspect > 0)) return MIN_MEDIA_H_COVER;
  return Math.min(MAX_MEDIA_H_COVER, Math.max(MIN_MEDIA_H_COVER, Math.round(width / aspect)));
}

/** 媒体区高度：有封面 = 封面比例定尺；无封面 = 占位保底（卡片高度即内容高度，不再有 flex 拉伸）。 */
export function entityCardImageHeight(attrs: Record<string, unknown>, _height: number): number {
  return entityCardCoverHeight(attrs);
}

/** 标题文字顶边相对卡片顶边的偏移（媒体区高度 + 上内边距）。 */
export function entityCardTextTop(attrs: Record<string, unknown>, height: number): number {
  return entityCardImageHeight(attrs, height) + ENTITY_CARD_PAD;
}

/** 缩略图网格顶边相对卡片顶边的偏移（footer 内，标题/副标题之下）。 */
export function entityCardThumbTop(attrs: Record<string, unknown>, height: number): number {
  return entityCardTextTop(attrs, height) + TITLE_H + SUMMARY_H + THUMB_SECTION_GAP;
}

export function entityCardTitleHeight(_attrs: Record<string, unknown>): number {
  return TITLE_H;
}

export function entityCardSummaryHeight(_attrs: Record<string, unknown>): number {
  return SUMMARY_H;
}

// 内容固有高度：封面区（无封面 = 占位保底）+ footer
export function entityCardContentHeight(attrs: Record<string, unknown>): number {
  return entityCardCoverHeight(attrs) + entityCardBottomHeight(attrs);
}

// 实体卡的有效渲染矩形（attrs 可能存有旧的更小尺寸；命中/选区/连线锚点必须与渲染一致）
export function entityCardRect(attrs: Record<string, unknown>): { x: number; y: number; width: number; height: number } {
  const width = Math.max(Number(attrs.width) || 264, MIN_W);
  // 实体卡不支持 resize：高度一律由内容定尺（有封面 = 封面比例区 + footer；无封面 = 占位保底 + footer），
  // 忽略存储高度，保证新建与既有卡片同高。
  return { x: Number(attrs.x) || 0, y: Number(attrs.y) || 0, width, height: entityCardContentHeight(attrs) };
}

// 媒体区裁剪用的圆角半径（与卡面一致，仅顶部两角生效）
export const ENTITY_CARD_RADIUS = CARD_RADIUS;

// 注册连线几何的实体卡有效矩形解析（箭头锚点/边界与渲染所见一致）
addNodeRectResolver((record) => (record.type === "entity-card" ? entityCardRect(record.attrs as Record<string, unknown>) : null));
