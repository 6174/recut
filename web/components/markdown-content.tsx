/*
 * [INPUT]: 不依赖业务状态；接收 markdown/mdx 正文
 * [OUTPUT]: 对外提供官网正文渲染器：段落、##/### 标题、- / 有序列表、**加粗**、行内代码、围栏代码块、`|` 表格、`>` 引用块
 * [POS]: web/components 的公开展示原子；Blog 详情与 App 详情共用，保证两处正文排版一致
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

type ContentBlock =
  | { kind: "text"; lines: string[] }
  | { kind: "code"; language: string; lines: string[] };

function parseBlocks(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let current: string[] = [];
  let inCode = false;
  const flush = () => {
    if (current.length) blocks.push({ kind: "text", lines: current });
    current = [];
  };
  for (const line of content.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      if (inCode) {
        blocks.push({ kind: "code", language: line.trimStart().slice(3).trim(), lines: current });
        current = [];
        inCode = false;
      } else {
        flush();
        inCode = true;
        current = [];
      }
      continue;
    }
    if (inCode) {
      current.push(line);
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    current.push(line);
  }
  if (inCode) blocks.push({ kind: "code", language: "", lines: current });
  else flush();
  return blocks;
}

function inlineMarkdown(text: string) {
  const parts = text.split(/(\*\*.+?\*\*|`[^`]+`)/g);
  return parts.map((part, index) => {
    if (index % 2 === 0) return part;
    if (part.startsWith("**")) return <strong className="font-semibold text-foreground" key={index}>{part.slice(2, -2)}</strong>;
    return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-primary" key={index}>{part.slice(1, -1)}</code>;
  });
}

function isTableLine(line: string) {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|");
}

function isTableSeparator(line: string) {
  return /^\|[\s:|-]+\|$/.test(line.trim());
}

export function MarkdownContent({ content }: { content: string }) {
  const blocks = parseBlocks(content);
  const nodes = blocks.map((block, index) => {
    if (block.kind === "code") {
      return <pre className="mt-4 overflow-x-auto rounded-xl bg-foreground p-4 text-xs leading-5 text-background" key={index}><code>{block.lines.join("\n")}</code></pre>;
    }
    const lines = block.lines;
    if (lines.every((line) => line.trimStart().startsWith(">"))) {
      const quote = lines.map((line) => line.replace(/^\s*>\s?/, "")).join(" ");
      return <blockquote className="mt-4 border-l-2 border-primary/40 pl-4 text-sm leading-6 text-muted-foreground" key={index}>{inlineMarkdown(quote)}</blockquote>;
    }
    if (lines.some(isTableSeparator) && lines.filter(isTableLine).length >= 2) {
      const rows = lines.filter(isTableLine).map((line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()));
      const headerIndex = rows.findIndex((row) => !row.every((cell) => /^[\s:|-]*$/.test(cell)));
      const headRow = headerIndex >= 0 ? rows[headerIndex] : null;
      const bodyRows = headRow ? rows.slice(headerIndex + 1).filter((row) => row.some((cell) => cell !== "")) : rows;
      return <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[32rem] border-collapse text-left text-sm"><thead>{headRow && <tr className="border-b bg-muted/50 text-xs font-semibold text-muted-foreground">{headRow.map((cell, cellIndex) => <th className="px-3 py-2 font-semibold" key={cellIndex}>{cell}</th>)}</tr>}</thead><tbody>{bodyRows.map((row, rowIndex) => <tr className="border-b last:border-0" key={rowIndex}>{row.map((cell, cellIndex) => <td className="px-3 py-2 text-muted-foreground" key={cellIndex}>{inlineMarkdown(cell)}</td>)}</tr>)}</tbody></table></div>;
    }
    if (lines.every((line) => /^[-*] /.test(line))) {
      return <ul className="mt-2 space-y-2" key={index}>{lines.map((line, itemIndex) => <li className="pl-1" key={itemIndex}>{inlineMarkdown(line.replace(/^[-*] /, ""))}</li>)}</ul>;
    }
    if (lines.every((line) => /^\d+\. /.test(line))) {
      return <ol className="mt-2 list-decimal space-y-2 pl-5" key={index}>{lines.map((line, itemIndex) => <li key={itemIndex}>{inlineMarkdown(line.replace(/^\d+\. /, ""))}</li>)}</ol>;
    }
    if (/^#{2,3} /.test(lines[0]) && lines.length === 1) {
      const level = lines[0].match(/^(#{2,3}) /)![1].length;
      const text = lines[0].replace(/^#{2,3} /, "");
      if (level === 2) return <h2 className="mt-12 text-2xl font-semibold tracking-tight" key={index}>{inlineMarkdown(text)}</h2>;
      return <h3 className="mt-8 text-lg font-semibold tracking-tight" key={index}>{inlineMarkdown(text)}</h3>;
    }
    return <p className="mt-2" key={index}>{inlineMarkdown(lines.join(" "))}</p>;
  });
  return <div className="mt-12 border-t pt-10 text-base leading-8 text-foreground/85">{nodes}</div>;
}

