/*
 * [INPUT]: 依赖 pomelo-core（PomeloEditorState）、pomelo-vello（VelloBlock/VelloOp/op-bridge）、
 *          world-canvas/arrow-geometry（纯几何）、world-canvas/text-metrics（truncateText）
 * [OUTPUT]: 对外提供 world-canvas 业务 block 的 vello-native 版本（EntityCardBlockV / NoteBlockV /
 *           WorldNodeBlockV / MediaNodeBlockV / RelationArrowBlockV / RealMediaBlockV /
 *           FreeElementBlockV / WORLD_VELLO_BLOCKS）与 entityCardRectV：同一份绘制产出 vello op 与
 *           Canvas2D painter；图片统一 center-cover 填充 + 圆角裁剪；文本按宽度截断；元素标题徽标按屏幕像素恒定。
 * [POS]: world-canvas 业务层的 vello block 实现（业务代码，不进入 pomelo-vello 内核）；几何复用 arrow-geometry。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloEditorState } from "../../pomelo-core/pomelo-state";
import { VelloBlock, type VelloBlockDraw } from "../../pomelo-vello/vello-block";
import type { Rgba, VelloOp } from "../../pomelo-vello/op-bridge";
import type { PomeloRendererAdapter } from "../../pomelo-core/pomelo-renderer";
import { drawScreenTextCanvas, drawTextCanvas, screenTextOp, textOp } from "../../pomelo-vello/vello-text";
import { bezierTangent, curveSegment, relationGeometry, type RelationGeometry } from "../arrow-geometry";
import { attrMediaLabel } from "../entity-color";
import { measureTextWidth, truncateText } from "../text-metrics";

const PAD = 14;
const CARD_RADIUS = 14;
const IMAGE_H = 160;
const THUMB = 30;
const THUMB_GAP = 5;
const GRID_GAP_Y = 12;
const GRID_CAPACITY = 9;
const MIN_W = 240;
const TITLE_SIZE_TEXT_FIRST = 21;
const SUBTITLE_SIZE_TEXT_FIRST = 11;
const TEXT_BLOCK_H = 76;
// 元素标题徽标（卡片外上方）：屏幕像素恒定
const CAPTION_GAP = 16;
const CAPTION_SIZE = 11;

const FONT = 'system-ui, -apple-system, "PingFang SC", sans-serif';
// 统一视觉对齐 pixi 的 canvas-theme：CARD_FILL=#0f1410（主题绿黑），描边=白色低透明，瓦片=#1d231e
const CARD_FILL: Rgba = [15, 20, 16, 255];
const CARD_STROKE: Rgba = [255, 255, 255, 20];
const CARD_STROKE_STRONG: Rgba = [255, 255, 255, 41];
const TILE_FILL: Rgba = [29, 35, 30, 255];
const SHADOW_FILL: Rgba = [0, 0, 0, 71];
const WORLD_ACCENT: Rgba = [93, 157, 117, 255];
const TEXT_PRIMARY: Rgba = [244, 244, 245, 255];
const TEXT_SECONDARY: Rgba = [139, 147, 167, 255];
const TEXT_TERTIARY: Rgba = [107, 114, 128, 255];
const CAPTION_FILL: Rgba = [212, 212, 216, 255];
const LABEL_FILL: Rgba = [161, 161, 170, 255];
const FALLBACK_ARROW: Rgba = [139, 147, 167, 255];

function hexToRgba(hex: string, alpha = 255): Rgba {
  const value = hex.replace("#", "");
  if (value.length < 6) return [59, 130, 246, alpha];
  return [Number.parseInt(value.slice(0, 2), 16) || 0, Number.parseInt(value.slice(2, 4), 16) || 0, Number.parseInt(value.slice(4, 6), 16) || 0, alpha];
}

function stringListOf(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]).filter((item) => typeof item === "string" && item) : [];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** 适配器当前视口缩放（zoom 常量文字/徽标用）。 */
function screenScaleOf(adapter: PomeloRendererAdapter): number {
  const scale = adapter.transform?.scale;
  return scale && scale > 0 ? scale : 1;
}

/** cover 填充的 op：等比放大铺满目标盒并居中，再按 clip 圆角裁剪（对齐 CSS background-size: cover; position: center）。 */
function coverImageOpsV(adapter: PomeloRendererAdapter, url: string, box: { x: number; y: number; width: number; height: number }, clip: { x: number; y: number; width: number; height: number; radius: number }): VelloOp[] {
  if (!url || box.width <= 0 || box.height <= 0) return [];
  const imageId = adapter.ensureImage(url);
  if (imageId === null) return [];
  const size = adapter.getImageSize(imageId);
  const ops: VelloOp[] = [
    { kind: "pushClipRoundRect", x: clip.x, y: clip.y, width: clip.width, height: clip.height, radius: clip.radius },
  ];
  if (size && size.width > 0 && size.height > 0) {
    const scale = Math.max(box.width / size.width, box.height / size.height);
    const drawW = size.width * scale;
    const drawH = size.height * scale;
    ops.push({ kind: "image", imageId, x: box.x + (box.width - drawW) / 2, y: box.y + (box.height - drawH) / 2, width: drawW, height: drawH });
  } else {
    // 尺寸未知（图片仍在上传/加载）：先按目标盒拉伸占位，下一帧尺寸就绪后重绘为 cover
    ops.push({ kind: "image", imageId, x: box.x, y: box.y, width: box.width, height: box.height });
  }
  ops.push({ kind: "popClip" });
  return ops;
}

/** Canvas2D 版 cover 填充（同一裁剪/居中语义）。 */
function drawCoverImageCanvas(ctx: CanvasRenderingContext2D, adapter: PomeloRendererAdapter, url: string, box: { x: number; y: number; width: number; height: number }, clip: { x: number; y: number; width: number; height: number; radius: number }): void {
  if (!url || box.width <= 0 || box.height <= 0) return;
  const imageId = adapter.ensureImage(url);
  if (imageId === null) return;
  const image = adapter.getImageElement(imageId);
  if (!image) return;
  const size = adapter.getImageSize(imageId);
  ctx.save();
  roundRect(ctx, clip.x, clip.y, clip.width, clip.height, clip.radius);
  ctx.clip();
  if (size && size.width > 0 && size.height > 0) {
    const scale = Math.max(box.width / size.width, box.height / size.height);
    const drawW = size.width * scale;
    const drawH = size.height * scale;
    ctx.drawImage(image, box.x + (box.width - drawW) / 2, box.y + (box.height - drawH) / 2, drawW, drawH);
  } else {
    ctx.drawImage(image, box.x, box.y, box.width, box.height);
  }
  ctx.restore();
}

/** 元素标题徽标（● 名称）：画在卡片外上方，按屏幕像素恒定（委托 vello-text 的 screenTextOp）。 */
function captionOpsV(adapter: PomeloRendererAdapter, x: number, y: number, width: number, title: string): { ops: VelloOp[]; top: number } {
  if (!title) return { ops: [], top: y };
  const scale = screenScaleOf(adapter);
  const top = y - (CAPTION_GAP + CAPTION_SIZE + 2) / scale;
  const text = truncateText(`● ${title}`, width * scale, CAPTION_SIZE);
  return { top, ops: [screenTextOp(adapter, { text, x, y: top, screenSize: CAPTION_SIZE, maxScreenWidth: width * scale, align: "left", fill: CAPTION_FILL })] };
}

function drawCaptionCanvas(ctx: CanvasRenderingContext2D, adapter: PomeloRendererAdapter, x: number, top: number, width: number, title: string): void {
  if (!title) return;
  const scale = screenScaleOf(adapter);
  drawScreenTextCanvas(ctx, adapter, { text: truncateText(`● ${title}`, width * scale, CAPTION_SIZE), x, y: top, screenSize: CAPTION_SIZE, maxScreenWidth: width * scale, align: "left", fill: CAPTION_FILL });
}

function entityContentHeight(attrs: Record<string, unknown>): number {
  const count = Math.max(stringListOf(attrs.photos).length, stringListOf(attrs.photoUrls).length);
  const hasCover = Boolean(String(attrs.coverUrl ?? "") || String(attrs.cover ?? ""));
  const textTop = (hasCover ? IMAGE_H + 52 : TEXT_BLOCK_H) + PAD;
  if (count <= 0) return textTop;
  const rows = Math.ceil(Math.min(count, GRID_CAPACITY) / 3);
  return textTop + rows * THUMB + (rows - 1) * THUMB_GAP + PAD;
}

export function entityCardRectV(attrs: Record<string, unknown>) {
  return {
    x: Number(attrs.x) || 0,
    y: Number(attrs.y) || 0,
    width: Math.max(Number(attrs.width) || 264, MIN_W),
    height: Math.max(Number(attrs.height) || 0, entityContentHeight(attrs)),
  };
}

/** 实体卡：深色卡面 + 头图 center-cover + 标题/副标题 + 资料格 + 元素徽标（vello op + Canvas2D 双实现）。 */
export class EntityCardBlockV extends VelloBlock {
  static type = "entity-card";
  override renderOnZoom = true;

  protected blockBounds() {
    const rect = entityCardRectV(this.record.attrs as Record<string, unknown>);
    const scale = screenScaleOf(this.adapter);
    return { minX: rect.x, minY: rect.y - (CAPTION_GAP + CAPTION_SIZE + 2) / scale, maxX: rect.x + rect.width, maxY: rect.y + rect.height };
  }

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const { x, y, width: w, height: h } = entityCardRectV(attrs);
    const title = String(attrs.title ?? "实体");
    const summary = String(attrs.desc ?? "").trim() || "补充一句简介…";
    const coverUrl = String(attrs.coverUrl ?? "");
    const hasCover = Boolean(coverUrl || String(attrs.cover ?? ""));
    const contentH = entityContentHeight(attrs);
    // resize 变大时多余高度给头图（与 pixi 版一致，避免卡底大片空白）
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

/** 便签/文本：与 pixi 一致（深色卡面 + 白 8% 细边 + 次级文字），圆角 12。 */
export class NoteBlockV extends VelloBlock {
  static type = "note";

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 200;
    const h = Number(attrs.height) || 120;
    const text = String(attrs.text ?? "便签");
    const noteText: Rgba = [156, 163, 175, 255];
    const ops: VelloOp[] = [
      { kind: "roundRect", x, y, width: w, height: h, radius: 12, fill: CARD_FILL, stroke: CARD_STROKE, strokeWidth: 1 },
      textOp({ text, x: x + 10, y: y + 10, size: 11, maxWidth: Math.max(20, w - 20), lineHeight: 16, fill: noteText }),
    ];
    const canvas = (ctx: CanvasRenderingContext2D) => {
      roundRect(ctx, x, y, w, h, 12);
      ctx.fillStyle = "#0f1410";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.stroke();
      drawTextCanvas(ctx, { text, x: x + 10, y: y + 10, size: 11, maxWidth: Math.max(20, w - 20), lineHeight: 16, fill: noteText });
    };
    return { ops, bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h }, canvas };
  }
}

/** World 根节点：深色卡面 + 白 16% 细边 + 主题绿光环 + 名称（对齐 pixi 主题色）。 */
export class WorldNodeBlockV extends VelloBlock {
  static type = "world-node";

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 200;
    const h = Number(attrs.height) || 80;
    const title = String(attrs.title ?? "World");
    const worldText = truncateText(title, w - 40, 15);
    const ops: VelloOp[] = [
      { kind: "roundRect", x: x - 3, y: y - 3, width: w + 6, height: h + 6, radius: (h + 6) / 2, fill: [0, 0, 0, 0], stroke: [WORLD_ACCENT[0], WORLD_ACCENT[1], WORLD_ACCENT[2], 102], strokeWidth: 1.5 },
      { kind: "roundRect", x, y, width: w, height: h, radius: h / 2, fill: CARD_FILL, stroke: CARD_STROKE_STRONG, strokeWidth: 1 },
      textOp({ text: worldText, x: x + w / 2, y: y + h / 2 - 11, size: 15, maxWidth: w - 40, align: "center", embolden: 0.03, fill: TEXT_PRIMARY }),
    ];
    const canvas = (ctx: CanvasRenderingContext2D) => {
      roundRect(ctx, x - 3, y - 3, w + 6, h + 6, (h + 6) / 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(93,157,117,0.4)";
      ctx.stroke();
      roundRect(ctx, x, y, w, h, h / 2);
      ctx.fillStyle = "#0f1410";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.stroke();
      drawTextCanvas(ctx, { text: worldText, x: x + w / 2, y: y + h / 2 - 11, size: 15, maxWidth: w - 40, align: "center", embolden: 0.03, fill: TEXT_PRIMARY });
    };
    return { ops, bounds: { minX: x - 3, minY: y - 3, maxX: x + w + 3, maxY: y + h + 3 }, canvas };
  }
}

/** 媒体节点：图占位 + 边框。 */
export class MediaNodeBlockV extends VelloBlock {
  static type = "media-node";

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 200;
    const h = Number(attrs.height) || 160;
    const ops: VelloOp[] = [
      { kind: "roundRect", x, y, width: w, height: h, radius: 10, fill: TILE_FILL, stroke: [75, 85, 99, 255], strokeWidth: 1 },
      textOp({ text: "media", x: x + 12, y: y + h - 26, size: 12, maxWidth: w - 24, fill: TEXT_SECONDARY }),
    ];
    const canvas = (ctx: CanvasRenderingContext2D) => {
      roundRect(ctx, x, y, w, h, 10);
      ctx.fillStyle = "#1d231e";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#4b5563";
      ctx.stroke();
    };
    return { ops, bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h }, canvas };
  }
}

/** 关系连线：复用 arrow-geometry 的二次贝塞尔，曲线 + 箭头 + 标签（线宽/箭头/标签按屏幕像素恒定，对齐 pixi）。 */
export class RelationArrowBlockV extends VelloBlock {
  static type = "relation-arrow";
  override renderOnZoom = true;

  override blockStateSelector = (state: PomeloEditorState) => {
    const fromId = String(this.record.attrs.fromId ?? "");
    const toId = String(this.record.attrs.toId ?? "");
    const from = state.getBlockById(fromId);
    const to = state.getBlockById(toId);
    const geo = relationGeometry(from, to, this.record.attrs as { fromAnchor?: { x: number; y: number }; toAnchor?: { x: number; y: number }; bend?: { dx: number; dy: number } });
    return { fromId, toId, geo, label: String(this.record.attrs.label ?? "") };
  };

  renderBlock(): VelloBlockDraw {
    const state = this.blockState as { geo: RelationGeometry | null; label: string } | null;
    const geo = state?.geo;
    if (!geo) return { ops: [], bounds: this.blockBounds() };
    const color = hexToRgba(String(this.record.attrs.color ?? "#8b93a7"));
    // zoom 常量补偿：线条/箭头/标签尺寸乘 1/scale，屏幕上保持恒定像素（否则低缩放下细线发虚/锯齿明显）
    const scale = screenScaleOf(this.adapter);
    const inv = 1 / scale;
    const segment = curveSegment(geo, geo.ta, geo.tb);
    const tangent = bezierTangent(geo.curve.p0, geo.curve.cp, geo.curve.p2, geo.tb);
    const angle = Math.atan2(tangent.y, tangent.x);
    const headLength = 11 * inv;
    const headWidth = 9 * inv;
    const strokeWidth = 2 * inv;

    const ops: VelloOp[] = [
      {
        kind: "quadStroke",
        p0: [segment.p0.x, segment.p0.y],
        cp: [segment.cp.x, segment.cp.y],
        p1: [segment.p2.x, segment.p2.y],
        stroke: color,
        strokeWidth,
      },
      {
        kind: "triangleFill",
        points: [
          [geo.b.x, geo.b.y],
          [geo.b.x - headLength * Math.cos(angle) + (headWidth / 2) * Math.sin(angle), geo.b.y - headLength * Math.sin(angle) - (headWidth / 2) * Math.cos(angle)],
          [geo.b.x - headLength * Math.cos(angle) - (headWidth / 2) * Math.sin(angle), geo.b.y - headLength * Math.sin(angle) + (headWidth / 2) * Math.cos(angle)],
        ],
        fill: color,
      },
    ];

    // 标签：曲线中点（多条边沿法向 ±14 屏幕像素错开）；字号/药丸/偏移均按屏幕像素恒定。
    // 文本 op 用屏幕 ppem（10）+ glyphScale=1/scale 保证轮廓清晰（同 caption）。
    let label = "";
    let labelTextW = 0;
    let labelX = geo.mid.x;
    let labelY = geo.mid.y;
    let pillW = 0;
    let pillH = 0;
    if (state?.label) {
      label = truncateText(state.label, 120, 10);
      labelTextW = measureTextWidth(label, 10);
      const offsetIndex = Number(this.record.attrs.labelOffsetIndex ?? 0);
      if (offsetIndex > 0) {
        const midTangent = bezierTangent(geo.curve.p0, geo.curve.cp, geo.curve.p2, 0.5);
        const length = Math.hypot(midTangent.x, midTangent.y) || 1;
        const side = offsetIndex % 2 === 1 ? 1 : -1;
        const level = Math.ceil(offsetIndex / 2);
        const px = ((level * 14 * side) / length) * inv;
        labelX = geo.mid.x - midTangent.y * px;
        labelY = geo.mid.y + midTangent.x * px;
      }
      pillW = (labelTextW + 14) * inv;
      pillH = 18 * inv;
      // 边框也按屏幕恒定（strokeWidth 乘 1/scale）：否则缩小时 <1px，描边发虚/断续
      ops.push({ kind: "roundRect", x: labelX - pillW / 2, y: labelY - pillH / 2, width: pillW, height: pillH, radius: 9 * inv, fill: [15, 20, 16, 235], stroke: [255, 255, 255, 40], strokeWidth: inv });
      ops.push(screenTextOp(this.adapter, { text: label, x: labelX - labelTextW / 2 / scale, y: labelY - 7 / scale, screenSize: 10, maxScreenWidth: labelTextW, align: "left", fill: LABEL_FILL }));
    }

    const pad = 24 * inv + (state?.label ? 60 * inv : 0);
    const minX = Math.min(segment.p0.x, segment.cp.x, segment.p2.x, labelX) - pad;
    const minY = Math.min(segment.p0.y, segment.cp.y, segment.p2.y, labelY) - pad;
    const maxX = Math.max(segment.p0.x, segment.cp.x, segment.p2.x, labelX) + pad;
    const maxY = Math.max(segment.p0.y, segment.cp.y, segment.p2.y, labelY) + pad;

    const canvas = (ctx: CanvasRenderingContext2D) => {
      ctx.beginPath();
      ctx.moveTo(segment.p0.x, segment.p0.y);
      ctx.quadraticCurveTo(segment.cp.x, segment.cp.y, segment.p2.x, segment.p2.y);
      ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},0.95)`;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(geo.b.x, geo.b.y);
      ctx.lineTo(geo.b.x - headLength * Math.cos(angle) + (headWidth / 2) * Math.sin(angle), geo.b.y - headLength * Math.sin(angle) - (headWidth / 2) * Math.cos(angle));
      ctx.lineTo(geo.b.x - headLength * Math.cos(angle) - (headWidth / 2) * Math.sin(angle), geo.b.y - headLength * Math.sin(angle) + (headWidth / 2) * Math.cos(angle));
      ctx.closePath();
      ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
      ctx.fill();
      if (label) {
        const w = (labelTextW + 14) * inv;
        const h = 18 * inv;
        roundRect(ctx, labelX - w / 2, labelY - h / 2, w, h, 9 * inv);
        ctx.fillStyle = "rgba(15,20,16,0.92)";
        ctx.fill();
        ctx.lineWidth = inv;
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.stroke();
        drawScreenTextCanvas(ctx, this.adapter, { text: label, x: labelX - labelTextW / 2 / scale, y: labelY - 7 / scale, screenSize: 10, maxScreenWidth: labelTextW, align: "left", fill: LABEL_FILL });
      }
    };

    return { ops, bounds: { minX, minY, maxX, maxY }, canvas };
  }
}

/** 媒体元素（type: media）：图 center-cover / 视频音频占位 + 元素徽标。 */
export class RealMediaBlockV extends VelloBlock {
  static type = "media";
  override renderOnZoom = true;

  protected blockBounds() {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 220;
    const h = Number(attrs.height) || 150;
    const scale = screenScaleOf(this.adapter);
    return { minX: x, minY: y - (CAPTION_GAP + CAPTION_SIZE + 2) / scale, maxX: x + w, maxY: y + h };
  }

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 220;
    const h = Number(attrs.height) || 150;
    const modality = String(attrs.modality ?? "image");
    const src = String(attrs.src ?? "");
    const label = String(attrs.label ?? "媒体");
    const attached = Boolean(attrs.attached);
    const innerH = h - (attached ? 18 : 0);
    const caption = captionOpsV(this.adapter, x, y, w, label);

    const ops: VelloOp[] = [
      { kind: "roundRect", x: x + 2, y: y + 6, width: w, height: h, radius: 12, fill: SHADOW_FILL, stroke: [0, 0, 0, 0], strokeWidth: 0 },
      { kind: "roundRect", x, y, width: w, height: h, radius: 12, fill: CARD_FILL, stroke: CARD_STROKE, strokeWidth: 1 },
      ...caption.ops,
    ];
    if (modality === "image" && src) {
      ops.push(...coverImageOpsV(this.adapter, src, { x: x + 6, y: y + 6, width: w - 12, height: innerH - 12 }, { x: x + 6, y: y + 6, width: w - 12, height: innerH - 12, radius: 8 }));
    } else {
      ops.push(textOp({ text: modality === "video" ? "视频 · 双击预览" : "音频 · 双击预览", x: x + 12, y: y + innerH / 2 - 10, size: 14, maxWidth: w - 24, fill: TEXT_TERTIARY }));
    }
    if (attached) ops.push(textOp({ text: "◈ 参考素材", x: x + 10, y: y + h - 16, size: 9, maxWidth: w - 20, fill: TEXT_SECONDARY }));

    const canvas = (ctx: CanvasRenderingContext2D) => {
      ctx.save();
      ctx.globalAlpha = 0.28;
      roundRect(ctx, x + 2, y + 6, w, h, 12);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.restore();
      roundRect(ctx, x, y, w, h, 12);
      ctx.fillStyle = "#0f1410";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (modality === "image" && src) {
        drawCoverImageCanvas(ctx, this.adapter, src, { x: x + 6, y: y + 6, width: w - 12, height: innerH - 12 }, { x: x + 6, y: y + 6, width: w - 12, height: innerH - 12, radius: 8 });
      } else {
        ctx.fillStyle = "#a1a1aa";
        ctx.font = `14px ${FONT}`;
        ctx.textBaseline = "top";
        ctx.fillText(modality === "video" ? "视频 · 双击预览" : "音频 · 双击预览", x + 12, y + innerH / 2 - 10);
      }
      drawCaptionCanvas(ctx, this.adapter, x, caption.top, w, label);
    };
    return { ops, bounds: this.blockBounds(), canvas };
  }
}

/** 自由元素（type: free-element）：文本 / 形状 / 属性预览卡（v1 简化视觉）。 */
export class FreeElementBlockV extends VelloBlock {
  static type = "free-element";
  override renderOnZoom = true;

  protected blockBounds() {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 120;
    const h = Number(attrs.height) || 60;
    if (String(attrs.elementKind ?? "") === "attr") {
      const scale = screenScaleOf(this.adapter);
      return { minX: x, minY: y - (CAPTION_GAP + CAPTION_SIZE + 2) / scale, maxX: x + w, maxY: y + h };
    }
    return { minX: x, minY: y, maxX: x + w, maxY: y + h };
  }

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 120;
    const h = Number(attrs.height) || 60;
    const elementKind = String(attrs.elementKind ?? "shape");
    const shapeType = String(attrs.shapeType ?? "rectangle");
    const text = String(attrs.text ?? "");
    const media = String(attrs.attrMedia ?? "text");
    const mediaSrc = String(attrs.mediaSrc ?? "");

    const ops: VelloOp[] = [];
    if (elementKind === "text") {
      ops.push(textOp({ text: text || "（空文本）", x, y, size: 13, maxWidth: Math.max(40, w), fill: [212, 212, 216, 255] }));
    } else if (elementKind === "attr") {
      const label = `${attrMediaLabel(media)}${text ? ` · ${text.slice(0, 12)}` : ""}`;
      const caption = captionOpsV(this.adapter, x, y, w, label);
      ops.push({ kind: "roundRect", x, y, width: w, height: h, radius: 12, fill: CARD_FILL, stroke: CARD_STROKE, strokeWidth: 1 });
      ops.push(...caption.ops);
      if (media === "image" && mediaSrc) {
        ops.push(...coverImageOpsV(this.adapter, mediaSrc, { x, y, width: w, height: h }, { x, y, width: w, height: h, radius: 12 }));
      } else if (text) {
        ops.push(textOp({ text, x: x + 10, y: y + 10, size: 11, maxWidth: w - 20, fill: TEXT_PRIMARY }));
      }
    } else {
      const radius = shapeType === "ellipse" || shapeType === "diamond" ? Math.min(w, h) / 2 : 8;
      ops.push({ kind: "roundRect", x, y, width: w, height: h, radius, fill: [255, 255, 255, 8], stroke: [82, 82, 91, 255], strokeWidth: 1.5 });
      if (text) ops.push(textOp({ text, x: x + 10, y: y + 10, size: 11, maxWidth: w - 16, fill: TEXT_TERTIARY }));
    }

    const canvas = (ctx: CanvasRenderingContext2D) => {
      roundRect(ctx, x, y, w, h, elementKind === "attr" ? 12 : 8);
      ctx.fillStyle = elementKind === "attr" ? "#0f1410" : "rgba(255,255,255,0.03)";
      ctx.fill();
      ctx.strokeStyle = elementKind === "attr" ? "rgba(255,255,255,0.08)" : "#52525b";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (elementKind === "attr" && media === "image" && mediaSrc) {
        drawCoverImageCanvas(ctx, this.adapter, mediaSrc, { x, y, width: w, height: h }, { x, y, width: w, height: h, radius: 12 });
      } else {
        drawTextCanvas(ctx, { text, x: x + 10, y: y + 10, size: elementKind === "attr" ? 11 : 12, maxWidth: w - (elementKind === "attr" ? 20 : 16), fill: elementKind === "attr" ? TEXT_PRIMARY : [161, 161, 170, 255] });
      }
      if (elementKind === "attr") {
        const label = `${attrMediaLabel(media)}${text ? ` · ${text.slice(0, 12)}` : ""}`;
        const scale = screenScaleOf(this.adapter);
        drawCaptionCanvas(ctx, this.adapter, x, y - (CAPTION_GAP + CAPTION_SIZE + 2) / scale, w, label);
      }
    };
    return { ops, bounds: this.blockBounds(), canvas };
  }
}

export const WORLD_VELLO_BLOCKS = [
  EntityCardBlockV,
  NoteBlockV,
  WorldNodeBlockV,
  MediaNodeBlockV,
  RelationArrowBlockV,
  RealMediaBlockV,
  FreeElementBlockV,
];
