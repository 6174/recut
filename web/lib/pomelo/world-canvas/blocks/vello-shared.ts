/*
 * [INPUT]: 依赖 pomelo-core（PomeloRendererAdapter）、pomelo-vello（VelloOp/Rgba）、pomelo-vello/vello-text
 *          （screenTextOp/drawScreenTextCanvas）、world-canvas/text-metrics（truncateText）
 * [OUTPUT]: 对外提供 world-canvas vello block 的公共绘制辅助（cover 填充、元素徽标、圆角路径）与统一视觉色板
 *           （CARD_FILL/CARD_STROKE/TEXT_* 等）及屏幕像素常量（CAPTION_TOP_OFFSET/CAPTION_SIZE）。
 * [POS]: lib/pomelo/world-canvas/blocks 的 vello block 共享层（无具体 Block，被各 *-block-v.ts 复用）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloRendererAdapter } from "../../pomelo-core/pomelo-renderer";
import type { Rgba, VelloOp } from "../../pomelo-vello/op-bridge";
import { drawScreenTextCanvas, screenTextOp } from "../../pomelo-vello/vello-text";
import { truncateText } from "../text-metrics";

// 元素标题徽标（卡片外上方）：屏幕像素恒定。
// CAPTION_TOP_OFFSET = 徽标文字顶边到卡片上缘的屏幕像素距离（徽标底边距卡面约 5px）；
// CAPTION_SIZE = 屏幕字号。
export const CAPTION_TOP_OFFSET = 16;
export const CAPTION_SIZE = 11;

// 统一画布视觉：CARD_FILL=#0f1410（主题绿黑），描边=白色低透明，瓦片=#1d231e
export const CARD_FILL: Rgba = [15, 20, 16, 255];
export const CARD_STROKE: Rgba = [255, 255, 255, 20];
export const CARD_STROKE_STRONG: Rgba = [255, 255, 255, 41];
export const TILE_FILL: Rgba = [29, 35, 30, 255];
export const SHADOW_FILL: Rgba = [0, 0, 0, 71];
export const WORLD_ACCENT: Rgba = [93, 157, 117, 255];
export const TEXT_PRIMARY: Rgba = [244, 244, 245, 255];
export const TEXT_SECONDARY: Rgba = [139, 147, 167, 255];
export const TEXT_TERTIARY: Rgba = [107, 114, 128, 255];
export const CAPTION_FILL: Rgba = [212, 212, 216, 255];
export const LABEL_FILL: Rgba = [161, 161, 170, 255];

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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
export function screenScaleOf(adapter: PomeloRendererAdapter): number {
  const scale = adapter.transform?.scale;
  return scale && scale > 0 ? scale : 1;
}

/** cover 填充的 op：等比放大铺满目标盒并居中，再按 clip 圆角裁剪（对齐 CSS background-size: cover; position: center）。 */
export function coverImageOpsV(adapter: PomeloRendererAdapter, url: string, box: { x: number; y: number; width: number; height: number }, clip: { x: number; y: number; width: number; height: number; radius: number }): VelloOp[] {
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
export function drawCoverImageCanvas(ctx: CanvasRenderingContext2D, adapter: PomeloRendererAdapter, url: string, box: { x: number; y: number; width: number; height: number }, clip: { x: number; y: number; width: number; height: number; radius: number }): void {
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
export function captionOpsV(adapter: PomeloRendererAdapter, x: number, y: number, width: number, title: string): { ops: VelloOp[]; top: number } {
  if (!title) return { ops: [], top: y };
  const scale = screenScaleOf(adapter);
  const top = y - CAPTION_TOP_OFFSET / scale;
  const text = truncateText(`● ${title}`, width * scale, CAPTION_SIZE);
  return { top, ops: [screenTextOp(adapter, { text, x, y: top, screenSize: CAPTION_SIZE, maxScreenWidth: width * scale, align: "left", fill: CAPTION_FILL })] };
}

export function drawCaptionCanvas(ctx: CanvasRenderingContext2D, adapter: PomeloRendererAdapter, x: number, top: number, width: number, title: string): void {
  if (!title) return;
  const scale = screenScaleOf(adapter);
  drawScreenTextCanvas(ctx, adapter, { text: truncateText(`● ${title}`, width * scale, CAPTION_SIZE), x, y: top, screenSize: CAPTION_SIZE, maxScreenWidth: width * scale, align: "left", fill: CAPTION_FILL });
}
