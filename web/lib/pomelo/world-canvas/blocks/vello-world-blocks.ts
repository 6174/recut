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
import { bezierTangent, curveSegment, relationGeometry, type RelationGeometry } from "../arrow-geometry";
import { attrMediaLabel } from "../entity-color";
import { truncateText } from "../text-metrics";

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
const CARD_FILL: Rgba = [20, 21, 26, 255];
const CARD_STROKE: Rgba = [58, 61, 70, 255];
const TILE_FILL: Rgba = [29, 35, 30, 255];
const TEXT_PRIMARY: Rgba = [229, 231, 235, 255];
const TEXT_SECONDARY: Rgba = [156, 163, 175, 255];
const TEXT_TERTIARY: Rgba = [161, 161, 170, 255];
const CAPTION_FILL: Rgba = [212, 212, 216, 255];
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

/** 元素标题徽标（◍ 名称）：画在卡片外上方，按屏幕像素恒定（world 尺寸 = 屏幕尺寸 / 视口缩放）。 */
function captionOpsV(adapter: PomeloRendererAdapter, x: number, y: number, width: number, title: string): { ops: VelloOp[]; top: number } {
  if (!title) return { ops: [], top: y };
  const scale = screenScaleOf(adapter);
  const size = CAPTION_SIZE / scale;
  const top = y - (CAPTION_GAP + CAPTION_SIZE + 2) / scale;
  return {
    top,
    ops: [{ kind: "text", fontId: 1, x, y: top, size, maxWidth: width, align: "left", fill: CAPTION_FILL, text: truncateText(`◍ ${title}`, width, size) }],
  };
}

function drawCaptionCanvas(ctx: CanvasRenderingContext2D, adapter: PomeloRendererAdapter, x: number, top: number, width: number, title: string): void {
  if (!title || top === undefined) return;
  const scale = screenScaleOf(adapter);
  const size = CAPTION_SIZE / scale;
  ctx.fillStyle = "#d4d4d8";
  ctx.font = `${size}px ${FONT}`;
  ctx.textBaseline = "top";
  ctx.fillText(truncateText(`◍ ${title}`, width, size), x, top);
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
      { kind: "roundRect", x: x + 2, y: y + 6, width: w, height: h, radius: CARD_RADIUS, fill: [0, 0, 0, 90], stroke: [0, 0, 0, 0], strokeWidth: 0 },
      { kind: "roundRect", x, y, width: w, height: h, radius: CARD_RADIUS, fill: CARD_FILL, stroke: CARD_STROKE, strokeWidth: 1 },
      ...caption.ops,
    ];
    if (hasCover) {
      ops.push(...coverImageOpsV(this.adapter, coverUrl, { x, y, width: w, height: imageH }, { x, y, width: w, height: h, radius: CARD_RADIUS }));
    }
    ops.push({ kind: "text", fontId: 1, x: x + PAD, y: y + textTop, size: titleSize, maxWidth: w - PAD * 2, align: "left", embolden: 0.035, fill: TEXT_PRIMARY, text: truncateText(title, w - PAD * 2, titleSize) });
    ops.push({ kind: "text", fontId: 1, x: x + PAD, y: y + textTop + (hasCover ? 24 : 30), size: summarySize, maxWidth: w - PAD * 2, align: "left", fill: TEXT_SECONDARY, text: truncateText(summary, w - PAD * 2, summarySize) });

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
      ctx.globalAlpha = 0.35;
      roundRect(ctx, x + 2, y + 6, w, h, CARD_RADIUS);
      ctx.fillStyle = "#000000";
      ctx.fill();
      ctx.restore();
      roundRect(ctx, x, y, w, h, CARD_RADIUS);
      ctx.fillStyle = "#14151a";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#3a3d46";
      ctx.stroke();
      if (hasCover) {
        ctx.fillStyle = "#1d231e";
        ctx.fillRect(x, y, w, imageH);
        drawCoverImageCanvas(ctx, this.adapter, coverUrl, { x, y, width: w, height: imageH }, { x, y, width: w, height: h, radius: CARD_RADIUS });
      }
      drawCaptionCanvas(ctx, this.adapter, x, caption.top, w, title);
      ctx.fillStyle = "#e5e7eb";
      ctx.font = `600 ${titleSize}px ${FONT}`;
      ctx.textBaseline = "top";
      ctx.fillText(truncateText(title, w - PAD * 2, titleSize), x + PAD, y + textTop);
      ctx.fillStyle = "#9ca3af";
      ctx.font = `${summarySize}px ${FONT}`;
      ctx.fillText(truncateText(summary, w - PAD * 2, summarySize), x + PAD, y + textTop + (hasCover ? 24 : 30));
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

/** 便签/文本：浅色底 + 文本。 */
export class NoteBlockV extends VelloBlock {
  static type = "note";

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 200;
    const h = Number(attrs.height) || 120;
    const text = String(attrs.text ?? "便签");
    const ops: VelloOp[] = [
      { kind: "roundRect", x, y, width: w, height: h, radius: 8, fill: [250, 240, 180, 255], stroke: [0, 0, 0, 0], strokeWidth: 0 },
      { kind: "text", fontId: 1, x: x + 12, y: y + 12, size: 16, maxWidth: w - 24, align: "left", fill: [40, 40, 40, 255], text: truncateText(text, w - 24, 16) },
    ];
    const canvas = (ctx: CanvasRenderingContext2D) => {
      roundRect(ctx, x, y, w, h, 8);
      ctx.fillStyle = "#faf0b4";
      ctx.fill();
      ctx.fillStyle = "#282828";
      ctx.font = `16px ${FONT}`;
      ctx.textBaseline = "top";
      ctx.fillText(truncateText(text, w - 24, 16), x + 12, y + 12);
    };
    return { ops, bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h }, canvas };
  }
}

/** World 根节点：椭圆 + 名称。 */
export class WorldNodeBlockV extends VelloBlock {
  static type = "world-node";

  renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 200;
    const h = Number(attrs.height) || 80;
    const title = String(attrs.title ?? "World");
    const ops: VelloOp[] = [
      { kind: "roundRect", x, y, width: w, height: h, radius: h / 2, fill: [30, 41, 59, 255], stroke: [96, 165, 250, 255], strokeWidth: 2 },
      { kind: "text", fontId: 1, x: x + 20, y: y + h / 2 - 12, size: 18, maxWidth: w - 40, align: "center", fill: [219, 234, 254, 255], text: truncateText(title, w - 40, 18) },
    ];
    const canvas = (ctx: CanvasRenderingContext2D) => {
      roundRect(ctx, x, y, w, h, h / 2);
      ctx.fillStyle = "#1e293b";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#60a5fa";
      ctx.stroke();
      ctx.fillStyle = "#dbeafe";
      ctx.font = `18px ${FONT}`;
      ctx.textBaseline = "top";
      ctx.fillText(truncateText(title, w - 40, 18), x + 20, y + h / 2 - 12);
    };
    return { ops, bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h }, canvas };
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
      { kind: "text", fontId: 1, x: x + 12, y: y + h - 26, size: 12, maxWidth: w - 24, align: "left", fill: TEXT_SECONDARY, text: "media" },
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

/** 关系连线：复用 arrow-geometry 的二次贝塞尔，曲线 + 箭头 + 标签。 */
export class RelationArrowBlockV extends VelloBlock {
  static type = "relation-arrow";

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
    const segment = curveSegment(geo, geo.ta, geo.tb);
    const tangent = bezierTangent(geo.curve.p0, geo.curve.cp, geo.curve.p2, geo.tb);
    const angle = Math.atan2(tangent.y, tangent.x);
    const headLength = 11;
    const headWidth = 9;

    const ops: VelloOp[] = [
      {
        kind: "quadStroke",
        p0: [segment.p0.x, segment.p0.y],
        cp: [segment.cp.x, segment.cp.y],
        p1: [segment.p2.x, segment.p2.y],
        stroke: color,
        strokeWidth: 2,
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
    if (state?.label) {
      ops.push({ kind: "text", fontId: 1, x: geo.mid.x - 40, y: geo.mid.y - 18, size: 11, maxWidth: 80, align: "center", fill: TEXT_TERTIARY, text: state.label });
    }

    const minX = Math.min(segment.p0.x, segment.cp.x, segment.p2.x) - 20;
    const minY = Math.min(segment.p0.y, segment.cp.y, segment.p2.y) - 20;
    const maxX = Math.max(segment.p0.x, segment.cp.x, segment.p2.x) + 20;
    const maxY = Math.max(segment.p0.y, segment.cp.y, segment.p2.y) + 20;

    const canvas = (ctx: CanvasRenderingContext2D) => {
      ctx.beginPath();
      ctx.moveTo(segment.p0.x, segment.p0.y);
      ctx.quadraticCurveTo(segment.cp.x, segment.cp.y, segment.p2.x, segment.p2.y);
      ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},0.95)`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(geo.b.x, geo.b.y);
      ctx.lineTo(geo.b.x - headLength * Math.cos(angle) + (headWidth / 2) * Math.sin(angle), geo.b.y - headLength * Math.sin(angle) - (headWidth / 2) * Math.cos(angle));
      ctx.lineTo(geo.b.x - headLength * Math.cos(angle) - (headWidth / 2) * Math.sin(angle), geo.b.y - headLength * Math.sin(angle) + (headWidth / 2) * Math.cos(angle));
      ctx.closePath();
      ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
      ctx.fill();
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
      { kind: "roundRect", x: x + 2, y: y + 6, width: w, height: h, radius: 12, fill: [0, 0, 0, 90], stroke: [0, 0, 0, 0], strokeWidth: 0 },
      { kind: "roundRect", x, y, width: w, height: h, radius: 12, fill: CARD_FILL, stroke: CARD_STROKE, strokeWidth: 1 },
      ...caption.ops,
    ];
    if (modality === "image" && src) {
      ops.push(...coverImageOpsV(this.adapter, src, { x: x + 6, y: y + 6, width: w - 12, height: innerH - 12 }, { x: x + 6, y: y + 6, width: w - 12, height: innerH - 12, radius: 8 }));
    } else {
      ops.push({ kind: "text", fontId: 1, x: x + 12, y: y + innerH / 2 - 10, size: 14, maxWidth: w - 24, align: "left", fill: TEXT_TERTIARY, text: modality === "video" ? "视频 · 双击预览" : "音频 · 双击预览" });
    }
    if (attached) ops.push({ kind: "text", fontId: 1, x: x + 10, y: y + h - 16, size: 9, maxWidth: w - 20, align: "left", fill: TEXT_SECONDARY, text: "◈ 参考素材" });

    const canvas = (ctx: CanvasRenderingContext2D) => {
      ctx.save();
      ctx.globalAlpha = 0.35;
      roundRect(ctx, x + 2, y + 6, w, h, 12);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.restore();
      roundRect(ctx, x, y, w, h, 12);
      ctx.fillStyle = "#14151a";
      ctx.fill();
      ctx.strokeStyle = "#3a3d46";
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
      ops.push({ kind: "text", fontId: 1, x, y, size: 13, maxWidth: Math.max(40, w), align: "left", fill: [212, 212, 216, 255], text: truncateText(text || "（空文本）", Math.max(40, w), 13) });
    } else if (elementKind === "attr") {
      const label = `${attrMediaLabel(media)}${text ? ` · ${text.slice(0, 12)}` : ""}`;
      const caption = captionOpsV(this.adapter, x, y, w, label);
      ops.push({ kind: "roundRect", x, y, width: w, height: h, radius: 12, fill: CARD_FILL, stroke: CARD_STROKE, strokeWidth: 1 });
      ops.push(...caption.ops);
      if (media === "image" && mediaSrc) {
        ops.push(...coverImageOpsV(this.adapter, mediaSrc, { x, y, width: w, height: h }, { x, y, width: w, height: h, radius: 12 }));
      } else if (text) {
        ops.push({ kind: "text", fontId: 1, x: x + 10, y: y + 10, size: 11, maxWidth: w - 20, align: "left", fill: TEXT_PRIMARY, text: truncateText(text, w - 20, 11) });
      }
    } else {
      const radius = shapeType === "ellipse" || shapeType === "diamond" ? Math.min(w, h) / 2 : 8;
      ops.push({ kind: "roundRect", x, y, width: w, height: h, radius, fill: [255, 255, 255, 8], stroke: [82, 82, 91, 255], strokeWidth: 1.5 });
      if (text) ops.push({ kind: "text", fontId: 1, x: x + 10, y: y + 10, size: 11, maxWidth: w - 16, align: "left", fill: TEXT_TERTIARY, text: truncateText(text, w - 16, 11) });
    }

    const canvas = (ctx: CanvasRenderingContext2D) => {
      roundRect(ctx, x, y, w, h, elementKind === "attr" ? 12 : 8);
      ctx.fillStyle = elementKind === "attr" ? "#14151a" : "rgba(255,255,255,0.03)";
      ctx.fill();
      ctx.strokeStyle = elementKind === "attr" ? "#3a3d46" : "#52525b";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (elementKind === "attr" && media === "image" && mediaSrc) {
        drawCoverImageCanvas(ctx, this.adapter, mediaSrc, { x, y, width: w, height: h }, { x, y, width: w, height: h, radius: 12 });
      } else {
        ctx.fillStyle = elementKind === "attr" ? "#e5e7eb" : "#a1a1aa";
        ctx.font = `12px ${FONT}`;
        ctx.textBaseline = "top";
        ctx.fillText(truncateText(text, w - 16, 12), x + 10, y + 10);
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
