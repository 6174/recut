/*
 * [INPUT]: 依赖 pomelo-core（PomeloRendererAdapter）、pomelo-vello（VelloOp/Rgba）、pomelo-vello/vello-text
 *          （screenTextOp/textOp）、world-canvas/text-metrics（truncateText/measureTextWidth）、world-canvas/graph-theme（色板/阈值）
 * [OUTPUT]: 对外提供 world-canvas vello block 的公共绘制辅助：coverImageOpsV（center-cover 填充）、
 *           captionOpsV（卡片外元素徽标，屏幕像素恒定；支持前置彩色前缀，如实体类型名）、screenScaleOf（视口缩放）、
 *           isLowDetail（是否进入低细节缩放，供各 block 隐藏文字）、
 *           moreHintOpsV（文本框内容溢出时右下角的「＋更多」小 chip，提示走全屏入口查看完整内容）。
 *           配色/排版常量一律从 graph-theme 取，本文件不再定义颜色。
 * [POS]: lib/pomelo/world-canvas/blocks 的 vello block 共享辅助层（无具体 Block，被各 *-block-v.ts 复用）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { PomeloRendererAdapter } from "../../pomelo-core/pomelo-renderer";
import type { Rgba, VelloOp } from "../../pomelo-vello/op-bridge";
import { screenTextOp, textOp } from "../../pomelo-vello/vello-text";
import { CARD_FILL, CARD_STROKE_STRONG, CAPTION_FILL, GRAPH_TEXT, LOW_DETAIL_SCALE, TEXT_SECONDARY } from "../graph-theme";
import { measureTextWidth, truncateText } from "../text-metrics";

// 元素标题徽标（卡片外上方）：屏幕像素恒定。
// CAPTION_TOP_OFFSET = 徽标文字顶边到卡片上缘的屏幕像素距离；CAPTION_SIZE = 屏幕字号。
export const CAPTION_TOP_OFFSET = 16;
export const CAPTION_SIZE = GRAPH_TEXT.caption;

/** 适配器当前视口缩放（zoom 常量文字/徽标用）。 */
export function screenScaleOf(adapter: PomeloRendererAdapter): number {
  const scale = adapter.transform?.scale;
  return scale && scale > 0 ? scale : 1;
}

/** 视口缩放是否已低到只该看到 shape（<= LOW_DETAIL_SCALE 时各 block 隐藏文字）。 */
export function isLowDetail(adapter: PomeloRendererAdapter): boolean {
  return screenScaleOf(adapter) <= LOW_DETAIL_SCALE;
}

// 溢出提示「＋更多」：文本框右下角一枚小 chip（微透明底 + 描边 + 次级文字）。
// 提示用户框内内容被裁掉，完整内容点右上角全屏入口查看。
const MORE_HINT_RADIUS = 8;
export function moreHintOpsV(x: number, y: number, w: number, h: number): VelloOp[] {
  const label = "＋更多";
  const size = 10;
  const padX = 6;
  const padY = 3;
  const chipW = measureTextWidth(label, size) + padX * 2;
  const chipH = size + padY * 2;
  const chipX = x + w - chipW - 6;
  const chipY = y + h - chipH - 6;
  return [
    { kind: "roundRect", x: chipX, y: chipY, width: chipW, height: chipH, radius: MORE_HINT_RADIUS, fill: CARD_FILL, stroke: CARD_STROKE_STRONG, strokeWidth: 1 },
    textOp({ text: label, x: chipX + padX, y: chipY + padY, size, maxWidth: chipW - padX * 2, fill: TEXT_SECONDARY }),
  ];
}

/** cover 填充的 op：等比放大铺满目标盒并居中，再按 clip 圆角裁剪（对齐 CSS background-size: cover; position: center）。
 *  纹理分辨率按视口缩放自适应：把盒子需要的设备像素传给 ensureImage，放大时升档避免发糊。 */
export function coverImageOpsV(adapter: PomeloRendererAdapter, url: string, box: { x: number; y: number; width: number; height: number }, clip: { x: number; y: number; width: number; height: number; radius: number }): VelloOp[] {
  if (!url || box.width <= 0 || box.height <= 0) return [];
  const ratio = adapter.getImagePixelRatio();
  // 首次按盒子下界估算纹理档位（cover 绘制长边 ≥ 盒子长边），尺寸已知后再按实际绘制尺寸精修
  let imageId = adapter.ensureImage(url, Math.max(box.width, box.height) * ratio);
  if (imageId === null) return [];
  const size = adapter.getImageSize(imageId);
  const ops: VelloOp[] = [
    { kind: "pushClipRoundRect", x: clip.x, y: clip.y, width: clip.width, height: clip.height, radius: clip.radius },
  ];
  if (size && size.width > 0 && size.height > 0) {
    const scale = Math.max(box.width / size.width, box.height / size.height);
    const drawW = size.width * scale;
    const drawH = size.height * scale;
    // 已注册纹理分辨率不足时请求升档（异步；下一帧尺寸/纹理就绪后重绘）
    const upgraded = adapter.ensureImage(url, Math.max(drawW, drawH) * ratio);
    if (upgraded !== null) imageId = upgraded;
    ops.push({ kind: "image", imageId, x: box.x + (box.width - drawW) / 2, y: box.y + (box.height - drawH) / 2, width: drawW, height: drawH });
  } else {
    // 尺寸未知（图片仍在上传/加载）：先按目标盒拉伸占位，下一帧尺寸就绪后重绘为 cover
    ops.push({ kind: "image", imageId, x: box.x, y: box.y, width: box.width, height: box.height });
  }
  ops.push({ kind: "popClip" });
  return ops;
}

/** 元素标题徽标：画在卡片外上方，按屏幕像素恒定（委托 vello-text 的 screenTextOp）。
 *  可选 prefix（如实体类型名）先画，再紧随其后画 title，两者颜色可不同（前缀用类型色）。 */
export function captionOpsV(adapter: PomeloRendererAdapter, x: number, y: number, width: number, title: string, prefix?: { text: string; fill: Rgba }): { ops: VelloOp[]; top: number } {
  if (!title && !prefix?.text) return { ops: [], top: y };
  const scale = screenScaleOf(adapter);
  const top = y - CAPTION_TOP_OFFSET / scale;
  const maxScreenWidth = width * scale;
  const ops: VelloOp[] = [];
  let cursorX = x;
  let remaining = maxScreenWidth;
  if (prefix?.text) {
    const label = truncateText(prefix.text, remaining, CAPTION_SIZE);
    const labelWidth = Math.min(measureTextWidth(label, CAPTION_SIZE), remaining);
    ops.push(screenTextOp(adapter, { text: label, x: cursorX, y: top, screenSize: CAPTION_SIZE, maxScreenWidth: remaining, align: "left", fill: prefix.fill }));
    cursorX += labelWidth / scale;
    remaining = Math.max(0, remaining - labelWidth);
  }
  if (title && remaining > 0) {
    ops.push(screenTextOp(adapter, { text: truncateText(title, remaining, CAPTION_SIZE), x: cursorX, y: top, screenSize: CAPTION_SIZE, maxScreenWidth: remaining, align: "left", fill: CAPTION_FILL }));
  }
  return { top, ops };
}
