/*
 * [INPUT]: 依赖 Tiptap JSONContent、protocol/types 的注册表与 protocol/xml 的属性序列化
 * [OUTPUT]: 对外提供 docToMarkdown（PM → markdown + XML，泛化 brainloop pm-to-markdown 的 atomHandlers）、referenceAttrsToTag（单条引用 → 规范标签）与 extractRefsFromDoc（从 PM JSON 提取去重引用）
 * [POS]: web/lib/rich-composer/protocol 的序列化层；与 parse.ts 共同构成 prompt 双向协议，输入内核与回复渲染共用
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { JSONContent } from "@tiptap/core";
import type { ExtractedRef, RefAttrRecord, RefProtocolRegistry } from "./types";
import { serializeAttributes } from "./xml";

// 引用节点的判别属性名：refType = descriptor.type，其余属性来自 descriptor.attrs 白名单。
export const REFERENCE_NODE_TYPE = "reference";
export const REFERENCE_TYPE_ATTR = "refType";

export function referenceAttrsToTag(
  refType: string,
  attrs: Record<string, unknown>,
  registry: RefProtocolRegistry,
): string {
  const protocol = registry.find((item) => item.type === refType);
  if (!protocol) return "";
  const record: RefAttrRecord = {};
  for (const key of protocol.attrs) {
    const value = attrs[key];
    if (value === undefined || value === null || value === "") continue;
    record[key] = typeof value === "string" ? value : String(value);
  }
  return `<${refType}${serializeAttributes(record, protocol.attrs)} />`;
}

export function docToMarkdown(doc: JSONContent, registry: RefProtocolRegistry): string {
  const text = serializeNode(doc, registry);
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function extractRefsFromDoc(doc: JSONContent, registry: RefProtocolRegistry): ExtractedRef[] {
  const byType = new Map(registry.map((protocol) => [protocol.type, protocol]));
  const seen = new Map<string, ExtractedRef>();
  visit(doc, (node) => {
    if (node.type !== REFERENCE_NODE_TYPE) return;
    const refType = readString(node.attrs?.[REFERENCE_TYPE_ATTR]);
    if (!refType) return;
    const protocol = byType.get(refType);
    if (!protocol) return;
    const attrs = normalizeAttrs(node.attrs);
    const identity = protocol.identity(attrs);
    if (!identity) return;
    const key = `${refType}:${identity}`;
    if (!seen.has(key)) seen.set(key, { type: refType, attrs, identity, key });
  });
  return [...seen.values()];
}

function serializeNode(node: JSONContent, registry: RefProtocolRegistry): string {
  if (!node.type) {
    return (node.content ?? []).map((child) => serializeNode(child, registry)).join("");
  }
  if (node.type === REFERENCE_NODE_TYPE) {
    const refType = readString(node.attrs?.[REFERENCE_TYPE_ATTR]);
    return refType ? referenceAttrsToTag(refType, node.attrs ?? {}, registry) : "";
  }
  if (node.type === "text") {
    return applyMarks(node.text ?? "", node.marks);
  }
  if (node.type === "hardBreak") {
    return "\n";
  }
  if (node.type === "paragraph") {
    const content = serializeChildren(node, registry).trim();
    return content ? `${content}\n\n` : "";
  }
  if (node.type === "heading") {
    const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
    const content = serializeChildren(node, registry).trim();
    return content ? `${"#".repeat(level)} ${content}\n\n` : "";
  }
  if (node.type === "bulletList") {
    return (node.content ?? []).map((item) => `- ${serializeChildren(item, registry).trim()}`).join("\n") + "\n\n";
  }
  if (node.type === "orderedList") {
    return (node.content ?? []).map((item, index) => `${index + 1}. ${serializeChildren(item, registry).trim()}`).join("\n") + "\n\n";
  }
  if (node.type === "codeBlock") {
    return `\`\`\`\n${serializeChildren(node, registry)}\n\`\`\`\n\n`;
  }
  return serializeChildren(node, registry);
}

function serializeChildren(node: JSONContent, registry: RefProtocolRegistry): string {
  return (node.content ?? []).map((child) => serializeNode(child, registry)).join("");
}

// applyMarks 与 brainloop 一致：由外向内包裹，顺序稳定（test 依赖）。
function applyMarks(text: string, marks: Array<{ type?: string }> | undefined): string {
  if (!marks || marks.length === 0) return text;
  return marks.reduce((result, mark) => {
    if (mark.type === "bold") return `**${result}**`;
    if (mark.type === "italic") return `*${result}*`;
    if (mark.type === "code") return `\`${result}\``;
    if (mark.type === "strike") return `~~${result}~~`;
    return result;
  }, text);
}

export function visit(node: JSONContent, visitNode: (node: JSONContent) => void): void {
  visitNode(node);
  for (const child of node.content ?? []) visit(child, visitNode);
}

export function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

// normalizeAttrs：把节点属性裁剪为纯字符串表，空值剔除，供 descriptor.identity 使用。
export function normalizeAttrs(attrs: Record<string, unknown> | null | undefined): RefAttrRecord {
  const record: RefAttrRecord = {};
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    record[key] = typeof value === "string" ? value : String(value);
  }
  return record;
}
