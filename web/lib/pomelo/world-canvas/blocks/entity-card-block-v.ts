/*
 * [INPUT]: 依赖 pomelo-vello（VelloBlock/VelloOp/vello-text）、world-canvas/blocks/entity-card-metrics、
 *          world-canvas/blocks/vello-shared（公共绘制辅助/色板）、world-canvas/text-metrics（truncateText）
 * [OUTPUT]: 对外提供 EntityCardBlockV（type: entity-card）与 entityCardRectV：深色卡面 + 头图 center-cover +
 *           标题/副标题 + 资料格 + 元素徽标（vello op + Canvas2D 双实现）；有效矩形与业务命中/选区/连线共用。
 * [POS]: lib/pomelo/world-canvas/blocks 的实体卡 vello block。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { VelloBlock, type VelloBlockDraw } from "../../pomelo-vello/vello-block";
import type { VelloOp } from "../../pomelo-vello/op-bridge";
import { drawTextCanvas, textOp } from "../../pomelo-vello/vello-text";
import { truncateText } from "../text-metrics";
import { entityCardContentHeight, entityCardRect } from "./entity-card-metrics";
import {
  CAPTION_TOP_OFFSET,
  CARD_FILL,
  CARD_STROKE,
  SHADOW_FILL,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TILE_FILL,
  captionOpsV,
  coverImageOpsV,
  drawCaptionCanvas,
  drawCoverImageCanvas,
  roundRect,
  screenScaleOf,
} from "./vello-shared";

const PAD = 14;
const CARD_RADIUS = 14;
const IMAGE_H = 160;
const THUMB = 30;
const THUMB_GAP = 5;
const GRID_GAP_Y = 12;
const GRID_CAPACITY = 9;
const TITLE_SIZE_TEXT_FIRST = 21;
const SUBTITLE_SIZE_TEXT_FIRST = 11;

function stringListOf(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]).filter((item) => typeof item === "string" && item) : [];
}

/** 实体卡有效渲染矩形：与业务命中/选区/连线锚点共用同一实现（见 entity-card-metrics）。 */
export const entityCardRectV = entityCardRect;

/** 实体卡：深色卡面 + 头图 center-cover + 标题/副标题 + 资料格 + 元素徽标（vello op + Canvas2D 双实现）。 */
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
    const title = String(attrs.title ?? "实体");
    const summary = String(attrs.desc ?? "").trim() || "补充一句简介…";
    const coverUrl = String(attrs.coverUrl ?? "");
    const hasCover = Boolean(coverUrl || String(attrs.cover ?? ""));
    const contentH = entityCardContentHeight(attrs);
    // resize 变大时多余高度给头图（避免卡底大片空白）
    const imageH = hasCover ? IMAGE_H + Math.max(0, h - contentH) : 0;
    const textTop = hasCover ? imageH + PAD : PAD;
    const totalCount = Math.max(stringListOf(attrs.photos).length, stringListOf(attrs.photoUrls).length);
    const titleSize = hasCover ? 15 : TITLE_SIZE_TEXT_FIRST;
    const summarySize = hasCover ? 10 : SUBTITLE_SIZE_TEXT_FIRST;
    const gridTop = textTop + (hasCover ? 24 + 14 : 30 + 18) + GRID_GAP_Y;
    const caption = captionOpsV(this.adapter, x, y, w, title);

    const ops: VelloOp[] = [
      { kind: "blurRect", x: x + 3, y: y + 7, width: w, height: h, radius: CARD_RADIUS, stdDev: 6, fill: SHADOW_FILL },
      { kind: "roundRect", x, y, width: w, height: h, radius: CARD_RADIUS, fill: CARD_FILL, stroke: CARD_STROKE, strokeWidth: 1 },
      ...caption.ops,
    ];
    if (hasCover) {
      ops.push(...coverImageOpsV(this.adapter, coverUrl, { x, y, width: w, height: imageH }, { x, y, width: w, height: h, radius: CARD_RADIUS }));
    }
    ops.push(textOp({ text: truncateText(title, w - PAD * 2, titleSize), x: x + PAD, y: y + textTop, size: titleSize, maxWidth: w - PAD * 2, embolden: 0.035, fill: TEXT_PRIMARY }));
    ops.push(textOp({ text: truncateText(summary, w - PAD * 2, summarySize), x: x + PAD, y: y + textTop + (hasCover ? 24 : 30), size: summarySize, maxWidth: w - PAD * 2, fill: TEXT_SECONDARY }));

    const tiles = Math.min(totalCount, GRID_CAPACITY);
    const urlPhotos = stringListOf(attrs.photoUrls);
    const tileRects: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < tiles; index++) {
      const tx = x + PAD + (index % 3) * (THUMB + THUMB_GAP);
      const ty = y + gridTop + Math.floor(index / 3) * (THUMB + THUMB_GAP);
      tileRects.push({ x: tx, y: ty });
      ops.push({ kind: "roundRect", x: tx, y: ty, width: THUMB, height: THUMB, radius: 8, fill: TILE_FILL, stroke: [0, 0, 0, 0], strokeWidth: 0 });
      ops.push(...coverImageOpsV(this.adapter, urlPhotos[index] ?? "", { x: tx, y: ty, width: THUMB, height: THUMB }, { x: tx, y: ty, width: THUMB, height: THUMB, radius: 8 }));
    }

    const canvas = (ctx: CanvasRenderingContext2D) => {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.28)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 7;
      roundRect(ctx, x, y, w, h, CARD_RADIUS);
      ctx.fillStyle = "#0f1410";
      ctx.fill();
      ctx.restore();
      roundRect(ctx, x, y, w, h, CARD_RADIUS);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.stroke();
      if (hasCover) {
        ctx.fillStyle = "#1d231e";
        ctx.fillRect(x, y, w, imageH);
        drawCoverImageCanvas(ctx, this.adapter, coverUrl, { x, y, width: w, height: imageH }, { x, y, width: w, height: h, radius: CARD_RADIUS });
      }
      drawCaptionCanvas(ctx, this.adapter, x, caption.top, w, title);
      drawTextCanvas(ctx, { text: truncateText(title, w - PAD * 2, titleSize), x: x + PAD, y: y + textTop, size: titleSize, maxWidth: w - PAD * 2, embolden: 0.035, fill: TEXT_PRIMARY });
      drawTextCanvas(ctx, { text: truncateText(summary, w - PAD * 2, summarySize), x: x + PAD, y: y + textTop + (hasCover ? 24 : 30), size: summarySize, maxWidth: w - PAD * 2, fill: TEXT_SECONDARY });
      for (let index = 0; index < tiles; index++) {
        const tile = tileRects[index];
        roundRect(ctx, tile.x, tile.y, THUMB, THUMB, 8);
        ctx.fillStyle = "#1d231e";
        ctx.fill();
        drawCoverImageCanvas(ctx, this.adapter, urlPhotos[index] ?? "", { x: tile.x, y: tile.y, width: THUMB, height: THUMB }, { x: tile.x, y: tile.y, width: THUMB, height: THUMB, radius: 8 });
      }
    };

    return { ops, bounds: this.blockBounds(), canvas };
  }
}
