/*
 * [INPUT]: 依赖 protocol/serialize 的 REFERENCE_NODE_TYPE/REFERENCE_TYPE_ATTR 与 protocol/parse 的 extractRefs/stringToDoc、protocol/types
 * [OUTPUT]: 对外提供 RichComposerValue 类型与 normalizeValue / extractRefsFromText / serializeValue 便捷函数
 * [POS]: web/lib/rich-composer 的值契约（协议 RFC §4.2）；持久化只存 text，refs 为派生值
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { JSONContent } from "@tiptap/core";
import { extractRefs, stringToDoc } from "./protocol/parse";
import { docToMarkdown } from "./protocol/serialize";
import type { ExtractedRef, RefProtocolRegistry } from "./protocol/types";

export type RichComposerValue = {
  /** 序列化后的 markdown + XML 文本（持久化真相） */
  text: string;
  /** 结构化引用列表（由 text 派生，按 identity 去重） */
  refs: ExtractedRef[];
  /** 编辑态 doc（仅同一会话内无损回填；不持久化） */
  doc?: JSONContent;
  /** 只有空白或只有引用块时视为空 */
  isEmpty: boolean;
};

export function normalizeValue(text: string, registry: RefProtocolRegistry): RichComposerValue {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  return {
    text: normalized,
    refs: normalized ? extractRefs(normalized, registry) : [],
    isEmpty: normalized.length === 0,
  };
}

export function valueFromDoc(doc: JSONContent, registry: RefProtocolRegistry): RichComposerValue {
  const text = docToMarkdown(doc, registry);
  return { text, refs: extractRefs(text, registry), doc, isEmpty: text.length === 0 };
}

export function docFromValue(value: RichComposerValue, registry: RefProtocolRegistry): JSONContent {
  return value.doc ?? stringToDoc(value.text, registry);
}
