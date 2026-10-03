/*
 * [INPUT]: 依赖 world-canvas/text-metrics（measureTextWidth / wrapTextLines）
 * [OUTPUT]: 对外提供文本块（自由文本元素 kind=text 与文本属性卡 attr media=text）的排版常量与
 *           「内容自适应高度」单一真源：两者都是「无背景 + 圆角描边框」的文本框，文字四周留内边距——
 *           文本元素（字号 13 / 行高 20 / 内边距 10）高度 = max(40, 20 + 行数 × 20)；
 *           文本属性卡（字号 11 / 行高 17 / 内边距 10）高度 = max(37, 20 + 行数 × 17)。
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

/** 自由文本元素高度：按换行后行数定高（上下各留 TEXT_ELEMENT_PAD；渲染侧文本起于 x/y+PAD）。 */
export function textElementHeight(text: string, width: number): number {
  const lines = wrapTextLines(text, Math.max(20, width - TEXT_ELEMENT_PAD * 2), TEXT_ELEMENT_SIZE).length;
  return Math.max(TEXT_ELEMENT_MIN_HEIGHT, TEXT_ELEMENT_PAD * 2 + lines * TEXT_ELEMENT_LINE_HEIGHT);
}

/** 文本属性卡高度：按换行后行数定高（上下各留 TEXT_ATTR_PAD；渲染侧文本起于 x/y+PAD、可用宽 width-2*PAD）。 */
export function textAttrHeight(text: string, width: number): number {
  const lines = wrapTextLines(text, Math.max(20, width - TEXT_ATTR_PAD * 2), TEXT_ATTR_SIZE).length;
  return Math.max(TEXT_ATTR_MIN_HEIGHT, TEXT_ATTR_PAD * 2 + lines * TEXT_ATTR_LINE_HEIGHT);
}
