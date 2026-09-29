/*
 * [INPUT]: 无外部依赖（document 测量 canvas）
 * [OUTPUT]: 对外提供 measureTextWidth / truncateText（按目标宽度测量 / 截断加省略号）与 wrapTextLines
 *           （按目标宽度换行成行数组，供文本块内容自适应高度使用；CJK 逐字、拉丁按词，超长串按字符硬切）。
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

// CJK 字符（逐字换行）范围 + 拉丁按词换行的 token 化：供文本块内容自适应高度估算行数。
const CJK_RANGE = "\u2E80-\u9FFF\u3000-\u303F\uF900-\uFAFF\uFF00-\uFFEF\uAC00-\uD7AF";
const TOKEN_RE = new RegExp(`[${CJK_RANGE}]|[^\\s${CJK_RANGE}]+|\\s+`, "g");

// 按目标宽度把文本换行成行数组（空文本 = 一个空行）。用于文本块的内容自适应高度：
// 与渲染侧（wasm 自动换行）同源的字号 + 近似字宽，估算行数；宁可略高不可裁切。
export function wrapTextLines(text: string, maxWidth: number, fontSize = 12): string[] {
  const lines: string[] = [];
  const push = (line: string) => lines.push(line.replace(/\s+$/, ""));
  for (const paragraph of String(text ?? "").split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    const tokens = paragraph.match(TOKEN_RE) ?? [];
    let line = "";
    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        if (line) line += token;
        continue;
      }
      if (line.trim() && measureTextWidth(line + token, fontSize) > maxWidth) {
        push(line);
        line = token;
      } else {
        line += token;
      }
      // 超长 token（无空格长串）：按字符硬切，避免溢出
      while (measureTextWidth(line, fontSize) > maxWidth) {
        let cut = line.length - 1;
        while (cut > 1 && measureTextWidth(line.slice(0, cut), fontSize) > maxWidth) cut -= 1;
        push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    push(line);
  }
  return lines.length ? lines : [""];
}
