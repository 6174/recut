/*
 * [INPUT]: 依赖 context-catalog/types、agent-panel-types 的属性 payload、recut-worlds-client 的 EntityAttr/entityAttrMediaRef、world-media 的 resolveMediaSrc 与 lucide 图标
 * [OUTPUT]: 对外提供属性引用来源：entityAttrSource（type=entity_attr，World Entity 扩展属性）与 mediaAttrSource（type=media_attr，素材扩展属性）；两者只作为实体/素材选项的下钻子项出现，顶层 search 恒为空，另导出 toEntityAttrOption/toMediaAttrOption 与 formatAttributeValue 供来源复用；media 类型属性在预览中附带可渲染的媒体
 * [POS]: web/lib/context-catalog/sources 的属性引用来源；把任意 owner（entity/asset）的扩展属性变成可 @、可序列化、可被后端物化的引用
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { createElement } from "react";
import { Tags } from "lucide-react";
import { entityAttrContextPayload, mediaAttrContextPayload, worldAttrContextPayload } from "@/components/agent-panel-types";
import { entityAttrMediaRef, type EntityAttr } from "@/lib/recut-worlds-client";
import { resolveMediaSrc } from "@/lib/world-media";
import type { ContextOption, ContextPreview, ContextSource } from "../types";

// formatAttributeValue 把属性值压成单行预览；媒体/对象值退化为类型描述而非原始 JSON。
export function formatAttributeValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(formatAttributeValue).filter(Boolean).join("、");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : undefined;
    const kind = typeof record.kind === "string" ? record.kind : undefined;
    if (name || kind) return [name, kind].filter(Boolean).join(" · ");
    return "（对象）";
  }
  return String(value);
}

// mediaAttrPreview 把 media 属性值（{assetId|url}）解析为预览可渲染的媒体；仅可视媒体（图片/视频）返回，非媒体或音频返回 undefined。
function mediaAttrPreview(apiBase: string | undefined, type: string | undefined, value: unknown): ContextPreview["media"] | undefined {
  if (type !== "media") return undefined;
  const ref = entityAttrMediaRef(value);
  if (!ref || ref.kind === "audio") return undefined;
  const url = resolveMediaSrc(apiBase, ref);
  if (!url) return undefined;
  return { kind: ref.kind === "video" ? "video" : "image", url };
}

function attrSubtitle(attr: EntityAttr): string {
  const preview = formatAttributeValue(attr.value);
  return preview.length > 80 ? `${preview.slice(0, 80)}…` : preview;
}

// toEntityAttrOption / toMediaAttrOption 生成下钻子选项：sourceType 决定序列化标签与后端物化。
export function toEntityAttrOption(worldId: string, entityId: string, attr: EntityAttr): ContextOption {
  return {
    key: `entity_attr:${worldId}:${entityId}:${attr.key}`,
    sourceType: "entity_attr",
    group: "entity",
    subKind: attr.type,
    title: attr.label || attr.key,
    subtitle: attrSubtitle(attr),
    badges: [{ key: "attr", label: attr.type, tone: "muted" }],
    data: { worldId, entityId, attr },
    context: entityAttrContextPayload(worldId, entityId, attr.key),
    score: 0,
  };
}

export function toMediaAttrOption(assetId: string, attr: { key: string; label?: string; type?: string; value?: unknown }): ContextOption {  return {
    key: `media_attr:${assetId}:${attr.key}`,
    sourceType: "media_attr",
    group: "media",
    subKind: attr.type,
    title: attr.label || attr.key,
    subtitle: attrSubtitle({ key: attr.key, label: attr.label ?? attr.key, type: "text", value: attr.value }),
    badges: [{ key: "attr", label: attr.type ?? "attr", tone: "muted" }],
    data: { assetId, attr },
    context: mediaAttrContextPayload(assetId, attr.key),
    score: 0,
  };
}

export const entityAttrSource: ContextSource = {
  type: "entity_attr",
  attrs: ["worldid", "entityid", "attrkey", "name"],
  identity: (attrs) =>
    attrs.worldid && attrs.entityid && attrs.attrkey ? `${attrs.worldid}:${attrs.entityid}:${attrs.attrkey}` : null,
  group: "entity",
  titleKey: "agent.context.source.entityAttr",
  insertMode: "inline",
  inlineInsertable: true,
  icon: () => createElement(Tags, { className: "size-3.5" }),
  label: (attrs) => String(attrs.name ?? attrs.attrkey ?? "属性"),
  toContext: (attrs) =>
    attrs.worldid && attrs.entityid && attrs.attrkey
      ? entityAttrContextPayload(String(attrs.worldid), String(attrs.entityid), String(attrs.attrkey))
      : null,
  // 属性只作为实体选项的下钻子项存在，不参与顶层搜索。
  search: async () => [],
  preview: (option, ctx): ContextPreview => {
    const data = option.data as { worldId: string; entityId: string; attr: EntityAttr };
    return {
      title: data.attr.label || data.attr.key,
      subtitle: option.subtitle,
      media: mediaAttrPreview(ctx.apiBase, data.attr.type, data.attr.value),
      body: formatAttributeValue(data.attr.value),
      facts: [
        { key: "type", label: "类型", value: data.attr.type },
        { key: "key", label: "字段", value: data.attr.key },
      ],
      badges: option.badges,
    };
  },
};

export const mediaAttrSource: ContextSource = {
  type: "media_attr",
  attrs: ["assetid", "attrkey", "name"],
  identity: (attrs) => (attrs.assetid && attrs.attrkey ? `${attrs.assetid}:${attrs.attrkey}` : null),
  group: "media",
  titleKey: "agent.context.source.mediaAttr",
  insertMode: "inline",
  inlineInsertable: true,
  icon: () => createElement(Tags, { className: "size-3.5" }),
  label: (attrs) => String(attrs.name ?? attrs.attrkey ?? "属性"),
  toContext: (attrs) =>
    attrs.assetid && attrs.attrkey ? mediaAttrContextPayload(String(attrs.assetid), String(attrs.attrkey)) : null,
  search: async () => [],
  preview: (option, ctx): ContextPreview => {
    const data = option.data as { assetId: string; attr: { key: string; label?: string; type?: string; value?: unknown } };
    return {
      title: data.attr.label || data.attr.key,
      subtitle: option.subtitle,
      media: mediaAttrPreview(ctx.apiBase, data.attr.type, data.attr.value),
      body: formatAttributeValue(data.attr.value),
      facts: [
        { key: "type", label: "类型", value: data.attr.type ?? "attr" },
        { key: "key", label: "字段", value: data.attr.key },
      ],
      badges: option.badges,
    };
  },
};

// toWorldAttrOption 生成 World 下钻子项：World 自身身份字段 / 简介 / 世界技能。
export function toWorldAttrOption(worldId: string, key: string, label: string, value: unknown): ContextOption {
  const preview = formatAttributeValue(value);
  return {
    key: `world_attr:${worldId}:${key}`,
    sourceType: "world_attr",
    group: "world",
    title: label,
    subtitle: preview.length > 80 ? `${preview.slice(0, 80)}…` : preview,
    badges: [{ key: "attr", label: "world", tone: "muted" }],
    data: { worldId, key, label, value },
    context: worldAttrContextPayload(worldId, key),
    score: 0,
  };
}

export const worldAttrSource: ContextSource = {
  type: "world_attr",
  attrs: ["worldid", "attrkey", "name"],
  identity: (attrs) => (attrs.worldid && attrs.attrkey ? `${attrs.worldid}:${attrs.attrkey}` : null),
  group: "world",
  titleKey: "agent.context.source.worldAttr",
  insertMode: "inline",
  inlineInsertable: true,
  icon: () => createElement(Tags, { className: "size-3.5" }),
  label: (attrs) => String(attrs.name ?? attrs.attrkey ?? "属性"),
  toContext: (attrs) =>
    attrs.worldid && attrs.attrkey ? worldAttrContextPayload(String(attrs.worldid), String(attrs.attrkey)) : null,
  search: async () => [],
  preview: (option): ContextPreview => {
    const data = option.data as { worldId: string; key: string; label: string; value: unknown };
    return {
      title: data.label,
      subtitle: option.subtitle,
      body: formatAttributeValue(data.value),
      facts: [{ key: "key", label: "字段", value: data.key }],
      badges: option.badges,
    };
  },
};
