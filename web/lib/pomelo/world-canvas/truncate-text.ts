/*
 * [INPUT]: 依赖 pixi.js 与 pomelo-core（PixiBlock）
 * [OUTPUT]: 对外提供画布文本截断工具：按最大宽度截断并追加省略号
 * [POS]: lib/pomelo/world-canvas 的渲染辅助（实体卡标题/简述、连线标签共用）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
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
