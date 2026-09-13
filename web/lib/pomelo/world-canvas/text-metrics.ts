/*
 * [INPUT]: 无外部依赖（document 测量 canvas）
 * [OUTPUT]: 对外提供 truncateText / measureTextWidth：按目标宽度截断加省略号。
 * [POS]: lib/pomelo/world-canvas 的纯文本测量（渲染器无关，各 vello block 共用）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
const FONT_STACK = 'system-ui, -apple-system, "PingFang SC", sans-serif';
const measureCanvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
const measureCtx = measureCanvas?.getContext("2d") ?? null;

export function measureTextWidth(text: string, fontSize = 12): number {
  if (!measureCtx) return text.length * fontSize * 0.6;
  measureCtx.font = `${fontSize}px ${FONT_STACK}`;
  return measureCtx.measureText(text).width;
}

export function truncateText(text: string, maxWidth: number, fontSize = 12): string {
  if (!measureCtx) return text;
  measureCtx.font = `${fontSize}px ${FONT_STACK}`;
  if (measureCtx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 0 && measureCtx.measureText(`${text.slice(0, end)}…`).width > maxWidth) {
    end -= 1;
  }
  return `${text.slice(0, end)}…`;
}
