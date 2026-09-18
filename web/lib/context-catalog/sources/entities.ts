/*
 * [INPUT]: 依赖 context-catalog/types、creationEntityContextPayload、toEntityAttrOption 与 Entity 目录类型、lucide 图标
 * [OUTPUT]: 对外提供 creation_entity 来源（group=entity）：全局搜索所有 World 的实体，query 支持 `World.实体` 二级模糊过滤；选项可下钻到实体扩展属性
 * [POS]: web/lib/context-catalog/sources 的 Entity 来源；先全局后下钻，不再要求宿主先 scope 到某个 World
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { createElement } from "react";
import { Users } from "lucide-react";
import { creationEntityContextPayload } from "@/components/agent-panel-types";
import { entityKindLabel, type EntityAttr, type WorldEntitySummary } from "@/lib/recut-worlds-client";
import type { ContextOption, ContextPreview, ContextSource } from "../types";
import { matchScore, splitEntityQuery } from "../search";
import { toEntityAttrOption } from "./attribute";

export function entitySummaryOption(entity: WorldEntitySummary, worldName: string): ContextOption {
  const subtitle = [worldName, entity.intro].filter(Boolean).join(" · ");
  return {
    key: `creation_entity:${entity.worldId}:${entity.id}`,
    sourceType: "creation_entity",
    group: "entity",
    subKind: entity.typeId,
    title: entity.name,
    subtitle,
    badges: [{ key: "kind", label: entityKindLabel(entity.typeId), tone: "default" }],
    data: { worldId: entity.worldId, entityId: entity.id, entity },
    context: creationEntityContextPayload(entity.worldId, entity.id),
    score: 0,
  };
}

export const entitiesSource: ContextSource = {
  type: "creation_entity",
  attrs: ["worldid", "entityid", "kind", "name"],
  identity: (attrs) => (attrs.worldid && attrs.entityid ? `${attrs.worldid}:${attrs.entityid}` : null),
  group: "entity",
  titleKey: "agent.context.source.entity",
  insertMode: "inline",
  inlineInsertable: true,
  icon: () => createElement(Users, { className: "size-3.5" }),
  label: (attrs) => String(attrs.name ?? attrs.entityid ?? "实体"),
  toContext: (attrs) =>
    attrs.worldid && attrs.entityid ? creationEntityContextPayload(String(attrs.worldid), String(attrs.entityid)) : null,
  search: async (ctx) => {
    const { worldQuery, entityQuery } = splitEntityQuery(ctx.query);
    const names = new Map(ctx.runtime.worlds.map((world) => [world.id, world.name]));
    // 服务端跨 World 搜索（world/text 两级过滤）；缺失时退化为已缓存的 per-World 列表。
    let pool: Array<WorldEntitySummary & { worldName?: string }>;
    if (ctx.runtime.searchEntities) {
      pool = await ctx.runtime.searchEntities({ text: entityQuery || undefined, world: worldQuery || undefined });
    } else {
      pool = ctx.runtime.worlds.flatMap((world) => ctx.runtime.entitiesFor(world.id));
    }
    return pool
      .filter((entity) => {
        const worldName = entity.worldName ?? names.get(entity.worldId) ?? entity.worldId;
        if (worldQuery && matchScore(worldName, worldQuery) < 0) return false;
        if (entityQuery && matchScore(`${entity.name} ${entity.intro}`, entityQuery) < 0) return false;
        return true;
      })
      .map((entity) => entitySummaryOption(entity, entity.worldName ?? names.get(entity.worldId) ?? entity.worldId));
  },
  expandable: () => true,
  children: async (option, ctx) => {
    const data = option.data as { worldId: string; entityId: string; entity?: { attrs?: EntityAttr[] } };
    // 宿主已注入实体对象（如详情页置顶项）时直接用其 attrs，避免再取一次。
    let attrs = data.entity?.attrs;
    if (!attrs?.length) {
      let entity = ctx.runtime.entityFor(data.worldId, data.entityId);
      if ((!entity || !entity.attrs?.length) && ctx.runtime.loadEntity) {
        try {
          entity = await ctx.runtime.loadEntity(data.worldId, data.entityId);
        } catch {
          entity = undefined;
        }
      }
      attrs = entity?.attrs;
    }
    return (attrs ?? []).map((attr) => toEntityAttrOption(data.worldId, data.entityId, attr));
  },
  preview: (option, ctx): ContextPreview => {
    const data = option.data as { worldId: string; entityId: string };
    const entity = ctx.runtime.entityFor(data.worldId, data.entityId);
    const facts = entity?.attrs?.slice(0, 6).map((attr) => ({
      key: attr.key,
      label: attr.label ?? attr.key,
      value: typeof attr.value === "object" ? "（媒体）" : String(attr.value ?? "—"),
    })) ?? [];
    return {
      title: option.title,
      subtitle: entity ? entityKindLabel(entity.typeId) : option.subtitle,
      body: entity?.intro,
      facts: [
        ...facts,
        { key: "world", label: "所属 World", value: ctx.runtime.worlds.find((world) => world.id === data.worldId)?.name ?? data.worldId },
        { key: "relations", label: "关系", value: String(entity?.relations?.length ?? 0) },
      ],
      badges: option.badges,
      open: {
        labelKey: "agent.context.preview.openEntity",
        href: `/worlds/${data.worldId}`,
      },
    };
  },
};
