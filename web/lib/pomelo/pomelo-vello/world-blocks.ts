/*
 * [INPUT]: 依赖 vello-block（VelloBlock）、op-bridge（VelloOp）、world-canvas/arrow-geometry（纯几何）
 * [OUTPUT]: 对外提供 world-canvas 四类 block 的 vello-native 版本（EntityCardBlockV / NoteBlockV /
 *           WorldNodeBlockV / MediaNodeBlockV / RelationArrowBlockV）：同一份绘制产出 vello op 与 Canvas2D painter；
 *           几何复用 arrow-geometry（与 pixi 版本共享命中/连线几何）。
 * [POS]: pomelo-vello 的 world-canvas block 迁移（M2）；不改动现有 pixi blocks。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloEditorState } from "../pomelo-core/pomelo-state";
import { bezierTangent, curveSegment, relationGeometry, type RelationGeometry } from "../world-canvas/arrow-geometry";
import { VelloBlock, type VelloBlockDraw } from "./vello-block";
import type { VelloOp } from "./op-bridge";
import { type Rgba } from "./op-bridge";

const PAD = 14;
const CARD_RADIUS = 12;
const IMAGE_H = 160;
const THUMB = 30;
const THUMB_GAP = 5;
const GRID_GAP_Y = 12;
const GRID_CAPACITY = 9;
const MIN_W = 240;

const TEXT_PRIMARY: Rgba = [229, 231, 235, 255];
const TEXT_SECONDARY: Rgba = [156, 163, 175, 255];
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
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function entityContentHeight(attrs: Record<string, unknown>): number {
  const count = Math.max(stringListOf(attrs.photos).length, stringListOf(attrs.photoUrls).length);
  const hasCover = Boolean(String(attrs.coverUrl ?? "") || String(attrs.cover ?? ""));
  const textTop = (hasCover ? IMAGE_H + 52 : 76) + PAD;
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

/** 实体卡：深色卡面 + 头图占位 + 标题/副标题 + 资料格（vello op + Canvas2D 双实现）。 */
export class EntityCardBlockV extends VelloBlock {
  static type = "entity-card";

  protected blockBounds() {
    const rect = entityCardRectV(this.record.attrs as Record<string, unknown>);
    return { minX: rect.x, minY: rect.y, maxX: rect.x + rect.width, maxY: rect.y + rect.height };
  }

  protected renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const { x, y, width: w, height: h } = entityCardRectV(attrs);
    const title = String(attrs.title ?? "实体");
    const summary = String(attrs.desc ?? "").trim() || "补充一句简介…";
    const hasCover = Boolean(String(attrs.coverUrl ?? "") || String(attrs.cover ?? ""));
    const imageH = hasCover ? IMAGE_H : 0;
    const textTop = hasCover ? imageH + PAD : PAD;
    const totalCount = Math.max(stringListOf(attrs.photos).length, stringListOf(attrs.photoUrls).length);

    const ops: VelloOp[] = [
      { kind: "roundRect" as const, x: x + 2, y: y + 6, width: w, height: h, radius: CARD_RADIUS, fill: [0, 0, 0, 90] as Rgba, stroke: [0, 0, 0, 0] as Rgba, strokeWidth: 0 },
      { kind: "roundRect" as const, x, y, width: w, height: h, radius: CARD_RADIUS, fill: [20, 21, 26, 255] as Rgba, stroke: [58, 61, 70, 255] as Rgba, strokeWidth: 1 },
      ...(hasCover
        ? [{ kind: "rectFill" as const, x: x + 1, y: y + 1, width: w - 2, height: imageH, fill: [29, 35, 30, 255] as Rgba }]
        : []),
      ...(hasCover
        ? (() => {
            const coverId = this.adapter.ensureImage(String(attrs.coverUrl ?? ""));
            return coverId === null ? [] : [{ kind: "image" as const, imageId: coverId, x: x + 1, y: y + 1, width: w - 2, height: imageH }];
          })()
        : []),
      { kind: "text" as const, fontId: 1, x: x + PAD, y: y + textTop, size: hasCover ? 15 : 21, maxWidth: w - PAD * 2, align: "left" as const, fill: TEXT_PRIMARY, text: title },
      { kind: "text" as const, fontId: 1, x: x + PAD, y: y + textTop + (hasCover ? 24 : 30), size: hasCover ? 10 : 12, maxWidth: w - PAD * 2, align: "left" as const, fill: TEXT_SECONDARY, text: summary },
    ];

    const tiles = Math.min(totalCount, GRID_CAPACITY);
    const urlPhotos = stringListOf(attrs.photoUrls);
    for (let index = 0; index < tiles; index++) {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const tx = x + PAD + col * (THUMB + THUMB_GAP);
      const ty = y + textTop + (hasCover ? 24 + 14 : 30 + 18) + GRID_GAP_Y + row * (THUMB + THUMB_GAP);
      ops.push({ kind: "roundRect", x: tx, y: ty, width: THUMB, height: THUMB, radius: 8, fill: [29, 35, 30, 255], stroke: [0, 0, 0, 0], strokeWidth: 0 });
      const photoId = this.adapter.ensureImage(urlPhotos[index] ?? "");
      if (photoId !== null) ops.push({ kind: "image", imageId: photoId, x: tx + 1, y: ty + 1, width: THUMB - 2, height: THUMB - 2 });
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
        ctx.fillRect(x + 1, y + 1, w - 2, imageH);
      }
      ctx.fillStyle = "#e5e7eb";
      ctx.font = `${hasCover ? 15 : 21}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(title, x + PAD, y + textTop);
      ctx.fillStyle = "#9ca3af";
      ctx.font = `${hasCover ? 10 : 12}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(summary, x + PAD, y + textTop + (hasCover ? 24 : 30));
      for (let index = 0; index < tiles; index++) {
        const tx = x + PAD + (index % 3) * (THUMB + THUMB_GAP);
        const ty = y + textTop + (hasCover ? 24 + 14 : 30 + 18) + GRID_GAP_Y + Math.floor(index / 3) * (THUMB + THUMB_GAP);
        roundRect(ctx, tx, ty, THUMB, THUMB, 8);
        ctx.fillStyle = "#1d231e";
        ctx.fill();
      }
    };

    return { ops, bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h }, canvas };
  }
}

/** 便签/文本：浅色底 + 文本。 */
export class NoteBlockV extends VelloBlock {
  static type = "note";

  protected renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 200;
    const h = Number(attrs.height) || 120;
    const text = String(attrs.text ?? "便签");
    const ops: VelloOp[] = [
      { kind: "roundRect" as const, x, y, width: w, height: h, radius: 8, fill: [250, 240, 180, 255] as Rgba, stroke: [0, 0, 0, 0] as Rgba, strokeWidth: 0 },
      { kind: "text" as const, fontId: 1, x: x + 12, y: y + 12, size: 16, maxWidth: w - 24, align: "left" as const, fill: [40, 40, 40, 255] as Rgba, text },
    ];
    const canvas = (ctx: CanvasRenderingContext2D) => {
      roundRect(ctx, x, y, w, h, 8);
      ctx.fillStyle = "#faf0b4";
      ctx.fill();
      ctx.fillStyle = "#282828";
      ctx.font = "16px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(text, x + 12, y + 12);
    };
    return { ops, bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h }, canvas };
  }
}

/** World 根节点：椭圆 + 名称。 */
export class WorldNodeBlockV extends VelloBlock {
  static type = "world-node";

  protected renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 200;
    const h = Number(attrs.height) || 80;
    const title = String(attrs.title ?? "World");
    const ops: VelloOp[] = [
      { kind: "roundRect" as const, x, y, width: w, height: h, radius: h / 2, fill: [30, 41, 59, 255] as Rgba, stroke: [96, 165, 250, 255] as Rgba, strokeWidth: 2 },
      { kind: "text" as const, fontId: 1, x: x + 20, y: y + h / 2 - 12, size: 18, maxWidth: w - 40, align: "center" as const, fill: [219, 234, 254, 255] as Rgba, text: title },
    ];
    const canvas = (ctx: CanvasRenderingContext2D) => {
      roundRect(ctx, x, y, w, h, h / 2);
      ctx.fillStyle = "#1e293b";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#60a5fa";
      ctx.stroke();
      ctx.fillStyle = "#dbeafe";
      ctx.font = "18px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(title, x + 20, y + h / 2 - 12);
    };
    return { ops, bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h }, canvas };
  }
}

/** 媒体节点：图占位 + 边框。 */
export class MediaNodeBlockV extends VelloBlock {
  static type = "media";

  protected renderBlock(): VelloBlockDraw {
    const attrs = this.record.attrs as Record<string, unknown>;
    const x = Number(attrs.x) || 0;
    const y = Number(attrs.y) || 0;
    const w = Number(attrs.width) || 200;
    const h = Number(attrs.height) || 160;
    const ops: VelloOp[] = [
      { kind: "roundRect" as const, x, y, width: w, height: h, radius: 10, fill: [29, 35, 30, 255] as Rgba, stroke: [75, 85, 99, 255] as Rgba, strokeWidth: 1 },
      { kind: "text" as const, fontId: 1, x: x + 12, y: y + h - 26, size: 12, maxWidth: w - 24, align: "left" as const, fill: [156, 163, 175, 255] as Rgba, text: "media" },
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

  protected renderBlock(): VelloBlockDraw {
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
        kind: "quadStroke" as const,
        p0: [segment.p0.x, segment.p0.y] as [number, number],
        cp: [segment.cp.x, segment.cp.y] as [number, number],
        p1: [segment.p2.x, segment.p2.y] as [number, number],
        stroke: color,
        strokeWidth: 2,
      },
      {
        kind: "triangleFill" as const,
        points: [
          [geo.b.x, geo.b.y],
          [geo.b.x - headLength * Math.cos(angle) + (headWidth / 2) * Math.sin(angle), geo.b.y - headLength * Math.sin(angle) - (headWidth / 2) * Math.cos(angle)],
          [geo.b.x - headLength * Math.cos(angle) - (headWidth / 2) * Math.sin(angle), geo.b.y - headLength * Math.sin(angle) + (headWidth / 2) * Math.cos(angle)],
        ] as [[number, number], [number, number], [number, number]],
        fill: color,
      },
    ];
    if (state?.label) {
      ops.push({ kind: "text", fontId: 1, x: geo.mid.x - 40, y: geo.mid.y - 18, size: 11, maxWidth: 80, align: "center", fill: [161, 161, 170, 255] as Rgba, text: state.label });
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

/** 媒体元素（type: media）：图 cover-fit / 视频音频占位。 */
export class RealMediaBlockV extends VelloBlock {
  static type = "media";

  protected renderBlock(): VelloBlockDraw {
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

    const ops: VelloOp[] = [
      { kind: "roundRect", x: x + 2, y: y + 6, width: w, height: h, radius: 12, fill: [0, 0, 0, 90], stroke: [0, 0, 0, 0], strokeWidth: 0 },
      { kind: "roundRect", x, y, width: w, height: h, radius: 12, fill: [20, 21, 26, 255], stroke: [58, 61, 70, 255], strokeWidth: 1 },
    ];
    if (modality === "image" && src) {
      const id = this.adapter.ensureImage(src);
      if (id !== null) ops.push({ kind: "image", imageId: id, x: x + 6, y: y + 6, width: w - 12, height: innerH - 12 });
    } else {
      ops.push({ kind: "text", fontId: 1, x: x + 12, y: y + innerH / 2 - 10, size: 14, maxWidth: w - 24, align: "left", fill: [161, 161, 170, 255], text: modality === "video" ? "视频 · 双击预览" : "音频 · 双击预览" });
    }
    if (attached) ops.push({ kind: "text", fontId: 1, x: x + 10, y: y + h - 16, size: 9, maxWidth: w - 20, align: "left", fill: [156, 163, 175, 255], text: "◈ 参考素材" });

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
      ctx.fillStyle = "#a1a1aa";
      ctx.font = "14px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(modality === "video" ? "视频 · 双击预览" : "音频 · 双击预览", x + 12, y + innerH / 2 - 10);
    };
    return { ops, bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h }, canvas };
  }
}

/** 自由元素（type: free-element）：文本 / 形状 / 属性预览卡（v1 简化视觉）。 */
export class FreeElementBlockV extends VelloBlock {
  static type = "free-element";

  protected renderBlock(): VelloBlockDraw {
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
      ops.push({ kind: "text", fontId: 1, x, y, size: 13, maxWidth: Math.max(40, w), align: "left", fill: [212, 212, 216, 255], text: text || "（空文本）" });
    } else if (elementKind === "attr") {
      ops.push({ kind: "roundRect", x, y, width: w, height: h, radius: 12, fill: [20, 21, 26, 255], stroke: [58, 61, 70, 255], strokeWidth: 1 });
      if (media === "image" && mediaSrc) {
        const id = this.adapter.ensureImage(mediaSrc);
        if (id !== null) ops.push({ kind: "image", imageId: id, x: x + 1, y: y + 1, width: w - 2, height: h - 2 });
      } else if (text) {
        ops.push({ kind: "text", fontId: 1, x: x + 10, y: y + 10, size: 11, maxWidth: w - 20, align: "left", fill: [229, 231, 235, 255], text });
      }
    } else {
      const radius = shapeType === "ellipse" || shapeType === "diamond" ? Math.min(w, h) / 2 : 8;
      ops.push({ kind: "roundRect", x, y, width: w, height: h, radius, fill: [255, 255, 255, 8], stroke: [82, 82, 91, 255], strokeWidth: 1.5 });
      if (text) ops.push({ kind: "text", fontId: 1, x: x + 10, y: y + 10, size: 11, maxWidth: w - 16, align: "left", fill: [161, 161, 170, 255], text });
    }

    const canvas = (ctx: CanvasRenderingContext2D) => {
      roundRect(ctx, x, y, w, h, elementKind === "attr" ? 12 : 8);
      ctx.fillStyle = elementKind === "attr" ? "#14151a" : "rgba(255,255,255,0.03)";
      ctx.fill();
      ctx.strokeStyle = elementKind === "attr" ? "#3a3d46" : "#52525b";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = elementKind === "attr" ? "#e5e7eb" : "#a1a1aa";
      ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(text, x + 10, y + 10);
    };
    return { ops, bounds: { minX: x, minY: y, maxX: x + w, maxY: y + h }, canvas };
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
