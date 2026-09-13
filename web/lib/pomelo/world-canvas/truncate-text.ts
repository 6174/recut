/*
 * [INPUT]: 依赖 pixi.js、text-metrics（truncateText）
 * [OUTPUT]: 对外提供 truncateText（re-export，画布文本截断省略号）与 drawElementCaption（元素左上角标题徽标：
 * 图标 + 名称，画在卡片外上方，所有元素统一；可选 scale 传入 1/视口缩放时徽标按屏幕像素恒定）
 * [POS]: lib/pomelo/world-canvas 的渲染辅助（实体卡标题/简述、连线标签、元素徽标共用）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as PIXI from "pixi.js";
import { truncateText } from "./text-metrics";

export { truncateText };

const CAPTION_FONT = 'system-ui, -apple-system, "PingFang SC", sans-serif';
// 徽标基线：图标/标题文字底边贴着卡片上缘（fontSize 11，文字向上 ~16px）
export const CAPTION_Y = -16;

// 元素左上角标题徽标：类型 icon + 名称（无圆点），绘于卡片上方（容器内负 y 偏移），暗色主题
// zoom 常量：传入 scale = 1 / 视口缩放 时，徽标整体反向缩放（图标/字号按屏幕像素恒定）；
// maxWidth 需调用方已按同一缩放换算（世界宽 × 视口 scale），保证截断宽度与所见一致
export function drawElementCaption(
  container: PIXI.Container,
  options: { title: string; icon?: string; maxWidth?: number; x?: number; y?: number; scale?: number },
) {
  const { title, icon = "◍", maxWidth = 160, x = 0, y = CAPTION_Y, scale = 1 } = options;
  if (!title) return;
  const layer = new PIXI.Container();
  // 位置反向除以 scale：徽标整体在屏幕上保持恒定偏移（zoom 常量下与卡片间距不变）
  layer.position.set(x, y * scale);
  layer.scale.set(scale);
  const iconText = new PIXI.Text(icon, {
    fontFamily: CAPTION_FONT,
    fontSize: 12,
    fill: 0xa1a1aa,
  });
  layer.addChild(iconText);
  const iconWidth = iconText.width;
  const titleText = new PIXI.Text(truncateText(title, Math.max(40, maxWidth - iconWidth - 6), 11), {
    fontFamily: CAPTION_FONT,
    fontSize: 11,
    fill: 0xd4d4d8,
  });
  titleText.position.set(iconWidth + 6, 0);
  layer.addChild(titleText);
  container.addChild(layer);
}
