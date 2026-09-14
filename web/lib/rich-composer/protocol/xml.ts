/*
 * [INPUT]: 无外部依赖
 * [OUTPUT]: 对外提供 XML 文本/属性的转义、反转义、解析与稳定序列化；解析大小写不敏感，序列化永远输出规范小写
 * [POS]: web/lib/rich-composer/protocol 的 XML 原语层（RFC §6）；被 parse/serialize 与回复渲染共用
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { RefAttrRecord } from "./types";

export function escapeXMLText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeXMLAttribute(value: string): string {
  return escapeXMLText(value).replace(/"/g, "&quot;");
}

// unescape 必须最后处理 &amp;，否则会二次解码 `&amp;lt;`。
export function unescapeXML(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const attributePattern = /([A-Za-z_][\w-]*)\s*=\s*(["'])([\s\S]*?)\2/g;

// 解析属性串（标签名之后、`/>` 之前）；键统一小写，跳过非法片段。
export function parseAttributes(source: string): RefAttrRecord {
  const attrs: RefAttrRecord = {};
  for (const match of source.matchAll(attributePattern)) {
    attrs[match[1].toLowerCase()] = unescapeXML(match[3]);
  }
  return attrs;
}

// 序列化属性：按白名单顺序稳定输出（identity 字段在前），跳过空值。
export function serializeAttributes(attrs: RefAttrRecord, order: readonly string[] = []): string {
  const seen = new Set<string>();
  const keys = [
    ...order.filter((key) => key in attrs),
    ...Object.keys(attrs).filter((key) => !order.includes(key)),
  ];
  return keys
    .filter((key) => {
      if (seen.has(key)) return false;
      seen.add(key);
      const value = attrs[key];
      return value !== undefined && value !== null && value !== "";
    })
    .map((key) => ` ${key}="${escapeXMLAttribute(String(attrs[key]))}"`)
    .join("");
}
