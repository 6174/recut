/*
 * [INPUT]: 依赖 world-canvas/text-metrics（measureTextWidth / wrapTextLines）
 * [OUTPUT]: 对外提供文本块（自由文本元素 kind=text 与文本属性卡 attr media=text）的排版常量与
 *           「内容自适应高度」单一真源：两者都是「无背景 + 圆角描边框」的文本框，文字四周留内边距——
 *           文本元素（字号 13 / 行高 20 / 内边距 10）高度 = max(40, 20 + 行数 × 20)；
 *           文本属性卡（字号 11 / 行高 17 / 内边距 10）高度 = max(37, 20 + 行数 × 17)。
 *           两者都受 16:9 最大高度约束（TEXT_BLOCK_MAX_ASPECT = 9/16：最大高 = 宽度 × 9/16）——
 *           textElementHeight/textAttrHeight 返回值即已封顶，渲染侧据此裁剪。
 *           渲染（free-element-block-v）、文档组装（canvas-pomelo）与 store 编辑态共用同一公式，
 *           长文本不再只显示一行被裁掉。文本块不支持 resize（见 world-canvas/resize-policy），高度随内容。
 * [POS]: lib/pomelo/world-canvas/blocks 的文本块度量（渲染器无关）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { wrapTextLines } from "../text-metrics";

// 自由文本元素（与 free-element-block-v 的文本排版一致）
export const TEXT_ELEMENT_SIZE = 13;
export const TEXT_ELEMENT_LINE_HEIGHT = 20;
// 文本框内边距：圆角描边框内文字四周留白（文本起于 x/y+PAD，可用宽 width-2*PAD）
export const TEXT_ELEMENT_PAD = 10;
export const TEXT_ELEMENT_MIN_HEIGHT = TEXT_ELEMENT_PAD * 2 + TEXT_ELEMENT_LINE_HEIGHT;

// 文本属性卡（与 free-element-block-v 的 attr 文本排版一致）
export const TEXT_ATTR_SIZE = 11;
export const TEXT_ATTR_LINE_HEIGHT = 17;
export const TEXT_ATTR_PAD = 10;
export const TEXT_ATTR_MIN_HEIGHT = TEXT_ATTR_PAD * 2 + TEXT_ATTR_LINE_HEIGHT;

// 文本框最大高度按 16:9 制定：最大高 = 宽度 × 9/16（越宽的框允许多显示几行）。
// 超出即裁剪并提示「＋更多」，完整内容走右上角全屏入口。
export const TEXT_BLOCK_MAX_ASPECT = 9 / 16;

/** 文本框最大高度（16:9：宽度 × 9/16）。 */
export function textBlockMaxHeight(width: number): number {
  return Math.max(1, width) * TEXT_BLOCK_MAX_ASPECT;
}

/** 自由文本元素高度：按换行后行数定高，封顶 16:9 最大高（上下各留 TEXT_ELEMENT_PAD；渲染侧文本起于 x/y+PAD）。 */
export function textElementHeight(text: string, width: number): number {
  const lines = wrapTextLines(text, Math.max(20, width - TEXT_ELEMENT_PAD * 2), TEXT_ELEMENT_SIZE).length;
  const contentHeight = Math.max(TEXT_ELEMENT_MIN_HEIGHT, TEXT_ELEMENT_PAD * 2 + lines * TEXT_ELEMENT_LINE_HEIGHT);
  return Math.min(contentHeight, textBlockMaxHeight(width));
}

/** 文本属性卡高度：按换行后行数定高，封顶 16:9 最大高（上下各留 TEXT_ATTR_PAD；渲染侧文本起于 x/y+PAD、可用宽 width-2*PAD）。 */
export function textAttrHeight(text: string, width: number): number {
  const lines = wrapTextLines(text, Math.max(20, width - TEXT_ATTR_PAD * 2), TEXT_ATTR_SIZE).length;
  const contentHeight = Math.max(TEXT_ATTR_MIN_HEIGHT, TEXT_ATTR_PAD * 2 + lines * TEXT_ATTR_LINE_HEIGHT);
  return Math.min(contentHeight, textBlockMaxHeight(width));
}

// 高度封顶后是否还有内容被裁掉：按可用行数（含内边距）与实际换行行数比较。
// 渲染侧据此在右下角画「＋更多」提示（完整内容走右上角全屏入口）。
function textBlockOverflows(text: string, width: number, pad: number, lineHeight: number, size: number): boolean {
  const usableLines = Math.floor((textBlockMaxHeight(width) - pad * 2) / lineHeight);
  if (usableLines <= 0) return true;
  const lines = wrapTextLines(text, Math.max(20, width - pad * 2), size).length;
  return lines > usableLines;
}

/** 自由文本元素内容是否超出 16:9 最大高度（超出则渲染「＋更多」）。 */
export function textElementOverflows(text: string, width: number): boolean {
  return textBlockOverflows(text, width, TEXT_ELEMENT_PAD, TEXT_ELEMENT_LINE_HEIGHT, TEXT_ELEMENT_SIZE);
}

/** 文本属性卡内容是否超出 16:9 最大高度（超出则渲染「＋更多」）。 */
export function textAttrOverflows(text: string, width: number): boolean {
  return textBlockOverflows(text, width, TEXT_ATTR_PAD, TEXT_ATTR_LINE_HEIGHT, TEXT_ATTR_SIZE);
}
