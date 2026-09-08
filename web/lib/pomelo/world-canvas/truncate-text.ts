/*
 * [INPUT]: 依赖 pixi.js 与 document 测量 canvas
 * [OUTPUT]: 对外提供 truncateText（画布文本截断省略号）与 drawElementCaption（元素左上角标题徽标：
 * 图标 + 名称，画在卡片外上方，所有元素统一）
 * [POS]: lib/pomelo/world-canvas 的渲染辅助（实体卡标题/简述、连线标签、元素徽标共用）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";

const measureCanvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
const measureCtx = measureCanvas?.getContext("2d") ?? null;

export function truncateText(text: string, maxWidth: number, fontSize = 12): string {
  if (!measureCtx) return text;
  measureCtx.font = `${fontSize}px system-ui, -apple-system, "PingFang SC", sans-serif`;
  if (measureCtx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 0 && measureCtx.measureText(`${text.slice(0, end)}…`).width > maxWidth) {
    end -= 1;
  }
  return `${text.slice(0, end)}…`;
}

const CAPTION_FONT = 'system-ui, -apple-system, "PingFang SC", sans-serif';
// 徽标基线：图标/标题文字底边贴着卡片上缘（fontSize 11，文字向上 ~16px）
export const CAPTION_Y = -16;

// 元素左上角标题徽标：类型 icon + 名称（无圆点），绘于卡片上方（容器内负 y 偏移），暗色主题
export function drawElementCaption(container: PIXI.Container, options: { title: string; icon?: string; maxWidth?: number; x?: number; y?: number }) {
  const { title, icon = "◍", maxWidth = 160, x = 0, y = CAPTION_Y } = options;
  if (!title) return;
  const iconText = new PIXI.Text(icon, {
    fontFamily: CAPTION_FONT,
    fontSize: 12,
    fill: 0xa1a1aa,
  });
  iconText.position.set(x, y);
  container.addChild(iconText);
  const iconWidth = iconText.width;
  const titleText = new PIXI.Text(truncateText(title, Math.max(40, maxWidth - iconWidth - 6), 11), {
    fontFamily: CAPTION_FONT,
    fontSize: 11,
    fill: 0xd4d4d8,
  });
  titleText.position.set(x + iconWidth + 6, y);
  container.addChild(titleText);
}
