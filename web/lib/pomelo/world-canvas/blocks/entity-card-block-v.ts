/*
 * [INPUT]: 依赖 pomelo-vello（VelloBlock/VelloOp/vello-text）、world-canvas/blocks/entity-card-metrics、
 *          world-canvas/blocks/vello-shared（公共绘制辅助/色板）、world-canvas/text-metrics（truncateText）
 * [OUTPUT]: 对外提供 EntityCardBlockV（type: entity-card）与 entityCardRectV：深色卡面 + 头图 center-cover +
 *           标题/副标题 + 资料格 + 元素徽标；头图区为 flex:1（剩余空间），底部固定标题/缩略图区；
 *           头图素材生成中/失败（coverStatus）渲染为蓝/红等待态；有效矩形与业务命中/选区/连线共用。
 * [POS]: lib/pomelo/world-canvas/blocks 的实体卡 vello block。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { VelloBlock, type VelloBlockDraw } from "../../pomelo-vello/vello-block";
import type { VelloOp } from "../../pomelo-vello/op-bridge";
import { textOp } from "../../pomelo-vello/vello-text";
import { truncateText } from "../text-metrics";
import {
  ENTITY_CARD_PAD,
  ENTITY_CARD_RADIUS,
  entityCardImageHeight,
  entityCardRect,
  entityCardTextTop,
  entityCardThumbColumns,
  entityCardThumbTop,
  entityCardTitleHeight,
} from "./entity-card-metrics";
import {
  CAPTION_TOP_OFFSET,
  CARD_FILL,
  CARD_STROKE,
  FAILED_ACCENT,
  FAILED_FILL,
  PENDING_ACCENT,
  PENDING_FILL,
  SHADOW_FILL,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TILE_FILL,
  captionOpsV,
  coverImageOpsV,
  screenScaleOf,
} from "./vello-shared";
import { displayRefText } from "./ref-text";

const THUMB = 30;
const THUMB_GAP = 5;
const TITLE_SIZE_TEXT_FIRST = 21;
const SUBTITLE_SIZE_TEXT_FIRST = 11;

function stringListOf(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]).filter((item) => typeof item === "string" && item) : [];
}

/** 实体卡有效渲染矩形：与业务命中/选区/连线锚点共用同一实现（见 entity-card-metrics）。 */
export const entityCardRectV = entityCardRect;

/** 实体卡：深色卡面 + 头图 center-cover + 标题/副标题 + 资料格 + 元素徽标。 */
export class EntityCardBlockV extends VelloBlock {
  static type = "entity-card";
  override renderOnZoom = true;

  protected blockBounds() {
    const rect = entityCardRectV(this.record.attrs as Record<string, unknown>);
    const scale = screenScaleOf(this.adapter);
    return { minX: rect.x, minY: rect.y - (CAPTION_TOP_OFFSET + 2) / scale, maxX: rect.x + rect.width, maxY: rect.y + rect.height };
  }

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const { x, y, width: w, height: h } = entityCardRectV(attrs);
    const title = displayRefText(String(attrs.title ?? "实体"));
    const summary = displayRefText(String(attrs.desc ?? "")).trim() || "补充一句简介…";
    const coverUrl = String(attrs.coverUrl ?? "");
    // flex 布局：底部内容区（标题 + 副标题 + 缩略图）固定高度，剩余空间全部留给头图区。
    const imageH = entityCardImageHeight(attrs, h);
    const hasCover = imageH > 0;
    const textTop = entityCardTextTop(attrs, h);
    const titleH = entityCardTitleHeight(attrs);
    const totalCount = Math.max(stringListOf(attrs.photos).length, stringListOf(attrs.photoUrls).length);
    const titleSize = hasCover ? 15 : TITLE_SIZE_TEXT_FIRST;
    const summarySize = hasCover ? 10 : SUBTITLE_SIZE_TEXT_FIRST;
    const gridTop = entityCardThumbTop(attrs, h);
    const caption = captionOpsV(this.adapter, x, y, w, title);

    const ops: VelloOp[] = [
      { kind: "blurRect", x: x + 3, y: y + 7, width: w, height: h, radius: ENTITY_CARD_RADIUS, stdDev: 6, fill: SHADOW_FILL },
      { kind: "roundRect", x, y, width: w, height: h, radius: ENTITY_CARD_RADIUS, fill: CARD_FILL, stroke: CARD_STROKE, strokeWidth: 1 },
      ...caption.ops,
    ];
    // 头图素材仍在生成 / 失败：不请求未就绪 URL，改渲染等待态（就绪后由画布自动切换）
    const coverStatus = String(attrs.coverStatus ?? "");
    if (hasCover) {
      if (coverStatus === "generating" || coverStatus === "failed") {
        const failed = coverStatus === "failed";
        const accent = failed ? FAILED_ACCENT : PENDING_ACCENT;
        const fill = failed ? FAILED_FILL : PENDING_FILL;
        ops.push({ kind: "roundRect", x, y, width: w, height: imageH, radius: 0, fill, stroke: accent, strokeWidth: 2 });
        ops.push(textOp({ text: failed ? "生成失败" : "生成中…", x: x + ENTITY_CARD_PAD, y: y + Math.max(6, imageH / 2 - 8), size: 12, maxWidth: w - ENTITY_CARD_PAD * 2, fill: failed ? accent : TEXT_PRIMARY }));
      } else {
        // 头图区 = 剩余空间，仅在自身区域内 center-cover：先按卡面圆角裁剪（保留顶部圆角），
        // 再裁到头图矩形，避免 cover 溢出污染下方文字/缩略图区。
        ops.push({ kind: "pushClipRoundRect", x, y, width: w, height: h, radius: ENTITY_CARD_RADIUS });
        ops.push(...coverImageOpsV(this.adapter, coverUrl, { x, y, width: w, height: imageH }, { x, y, width: w, height: imageH, radius: 0 }));
        ops.push({ kind: "popClip" });
      }
    }
    ops.push(textOp({ text: truncateText(title, w - ENTITY_CARD_PAD * 2, titleSize), x: x + ENTITY_CARD_PAD, y: y + textTop, size: titleSize, maxWidth: w - ENTITY_CARD_PAD * 2, embolden: 0.035, fill: TEXT_PRIMARY }));
    ops.push(textOp({ text: truncateText(summary, w - ENTITY_CARD_PAD * 2, summarySize), x: x + ENTITY_CARD_PAD, y: y + textTop + titleH, size: summarySize, maxWidth: w - ENTITY_CARD_PAD * 2, fill: TEXT_SECONDARY }));

    // 按卡片宽度自适应换行（不再固定九宫格、不再截断到 9 张）
    const columns = entityCardThumbColumns(attrs);
    const urlPhotos = stringListOf(attrs.photoUrls);
    for (let index = 0; index < totalCount; index++) {
      const tx = x + ENTITY_CARD_PAD + (index % columns) * (THUMB + THUMB_GAP);
      const ty = y + gridTop + Math.floor(index / columns) * (THUMB + THUMB_GAP);
      ops.push({ kind: "roundRect", x: tx, y: ty, width: THUMB, height: THUMB, radius: 8, fill: TILE_FILL, stroke: [0, 0, 0, 0], strokeWidth: 0 });
      ops.push(...coverImageOpsV(this.adapter, urlPhotos[index] ?? "", { x: tx, y: ty, width: THUMB, height: THUMB }, { x: tx, y: ty, width: THUMB, height: THUMB, radius: 8 }));
    }

    return { ops, bounds: this.blockBounds() };
  }
}
