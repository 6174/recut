/*
 * [INPUT]: 依赖 protocol/types 的 RefProtocol 注册表与 protocol/xml 的属性解析
 * [OUTPUT]: 对外提供 parseInlineRefs（保留位置）、extractRefs（按 identity 去重）、stripRefs（迁移期剥离标签）与 hasInlineRefs
 * [POS]: web/lib/rich-composer/protocol 的解析层；未知标签一律保留为原文，前向兼容（World 正文可能含未来标签）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { JSONContent } from "@tiptap/core";
import type { ExtractedRef, ParsedRef, RefProtocolRegistry } from "./types";
import { REFERENCE_TYPE_ATTR } from "./serialize";
import { parseAttributes } from "./xml";

// 匹配 `<tag ... />` 或 `<tag ...>inner</tag>`；原子引用没有语义子树，带非空 inner 的标签不是内联引用。
const tagPattern = /<([a-zA-Z_][\w.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)\s*(?:\/>|>([\s\S]*?)<\/\1>)/g;

function protocolsByType(registry: RefProtocolRegistry) {
  return new Map(registry.map((protocol) => [protocol.type, protocol]));
}

export function parseInlineRefs(text: string, registry: RefProtocolRegistry): ParsedRef[] {
  if (!text) return [];
  const byType = protocolsByType(registry);
  const refs: ParsedRef[] = [];
  for (const match of text.matchAll(tagPattern)) {
    const type = match[1];
    if (!byType.has(type)) continue;
    // 带非空内容的同名标签是块级内容（如 context-quote），不是原子引用。
    if (match[3] !== undefined && match[3].trim() !== "") continue;
    const start = match.index ?? 0;
    refs.push({ type, attrs: parseAttributes(match[2]), raw: match[0], start, end: start + match[0].length });
  }
  return refs;
}

// extractRefs 是 refs 的权威派生：正文多处引用同一对象只产出一条，按首次出现顺序。
export function extractRefs(text: string, registry: RefProtocolRegistry): ExtractedRef[] {
  const byType = protocolsByType(registry);
  const seen = new Map<string, ExtractedRef>();
  for (const ref of parseInlineRefs(text, registry)) {
    const protocol = byType.get(ref.type);
    if (!protocol) continue;
    const identity = protocol.identity(ref.attrs);
    if (!identity) continue;
    const key = `${ref.type}:${identity}`;
    if (!seen.has(key)) seen.set(key, { type: ref.type, attrs: ref.attrs, identity, key });
  }
  return [...seen.values()];
}

export function hasInlineRefs(text: string, registry: RefProtocolRegistry): boolean {
  return parseInlineRefs(text, registry).length > 0;
}

// stripRefs 用于确实要丢弃引用的位置（如仅纯文本摘要）。
export function stripRefs(text: string, registry: RefProtocolRegistry): string {
  const byType = protocolsByType(registry);
  return text.replace(tagPattern, (raw, type: string) => (byType.has(type) ? "" : raw));
}

// referenceDisplayText 用于纯文本渲染位（画布文本/便签、卡片副标题、turn 预览）：
// 已注册标签替换为 `@name`（与 chip 文案一致），未知标签原样保留。绝不向用户暴露原始 XML。
export function referenceDisplayText(text: string, registry: RefProtocolRegistry): string {
  if (!text) return text;
  const byType = protocolsByType(registry);
  return text.replace(tagPattern, (raw, type: string, attrsSource: string) => {
    const protocol = byType.get(type);
    if (!protocol) return raw;
    const attrs = parseAttributes(attrsSource ?? "");
    const label = protocol.label?.(attrs) ?? attrs.name ?? attrs.title ?? protocol.type;
    return `@${label}`;
  });
}

// stringToDoc 把持久化 markdown+XML（或历史纯文本）还原为可编辑 PM JSON。
// 未知标签原样保留为文本，绝不清除用户内容；纯文本等价于单个/多个段落。
export function stringToDoc(value: string, registry: RefProtocolRegistry): JSONContent {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) return { type: "doc", content: [{ type: "paragraph" }] };
  const blocks: JSONContent[] = normalized
    .split(/\n{2,}/)
    .map((block) => ({ type: "paragraph", content: parseInlineNodes(block, registry) }))
    .filter((block) => (block.content?.length ?? 0) > 0);
  return { type: "doc", content: blocks.length ? blocks : [{ type: "paragraph" }] };
}

function parseInlineNodes(block: string, registry: RefProtocolRegistry): JSONContent[] {
  const byType = protocolsByType(registry);
  const nodes: JSONContent[] = [];
  let cursor = 0;
  for (const match of block.matchAll(tagPattern)) {
    const start = match.index ?? 0;
    const type = match[1];
    if (!byType.has(type) || (match[3] !== undefined && match[3].trim() !== "")) continue;
    appendTextNodes(nodes, block.slice(cursor, start));
    const attrs = parseAttributes(match[2]);
    nodes.push({ type: "reference", attrs: { [REFERENCE_TYPE_ATTR]: type, ...attrs } });
    cursor = start + match[0].length;
  }
  appendTextNodes(nodes, block.slice(cursor));
  return nodes;
}

function appendTextNodes(target: JSONContent[], text: string): void {
  if (!text) return;
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (line.length > 0) target.push({ type: "text", text: line });
    if (index < lines.length - 1) target.push({ type: "hardBreak" });
  });
}
