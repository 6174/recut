/*
 * [INPUT]: 依赖 context-catalog/types、creationEntityContextPayload、Entity 目录类型与 lucide 图标
 * [OUTPUT]: 对外提供 creation_entity 来源：scope=worldId 时本地/服务端搜索、预览类型/intro/attrs、toContext 生成 creation_entity 旁路
 * [POS]: web/lib/context-catalog/sources 的 World Entity 来源；无 scope 时返回空，面板据 source.scope 显示「先选一个 World」
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { createElement } from "react";
import { Users } from "lucide-react";
import { creationEntityContextPayload } from "@/components/agent-panel-types";
import { entityKindLabel, type WorldEntity, type WorldEntitySummary } from "@/lib/recut-worlds-client";
import type { ContextOption, ContextPreview, ContextSearchContext, ContextSource } from "../types";
import { matchScore, sourceLimit } from "../search";

function toOption(worldId: string, entity: WorldEntitySummary): ContextOption {
  return {
    key: `creation_entity:${worldId}:${entity.id}`,
    sourceType: "creation_entity",
    group: "world",
    subKind: entity.typeId,
    title: entity.name,
    subtitle: entity.intro,
    badges: [{ key: "kind", label: entityKindLabel(entity.typeId), tone: "default" }],
    data: { worldId, entityId: entity.id, entity },
    context: creationEntityContextPayload(worldId, entity.id),
    score: 0,
  };
}

export const entitiesSource: ContextSource = {
  type: "creation_entity",
  attrs: ["worldid", "entityid", "kind", "name"],
  identity: (attrs) => (attrs.worldid && attrs.entityid ? `${attrs.worldid}:${attrs.entityid}` : null),
  group: "world",
  titleKey: "agent.context.source.entity",
  insertMode: "inline",
  inlineInsertable: true,
  scope: "world",
  icon: () => createElement(Users, { className: "size-3.5" }),
  label: (attrs) => String(attrs.name ?? attrs.entityid ?? "实体"),
  toContext: (attrs) =>
    attrs.worldid && attrs.entityid ? creationEntityContextPayload(String(attrs.worldid), String(attrs.entityid)) : null,
  search: async (ctx) => {
    const worldId = ctx.scope?.worldId;
    if (!worldId) return [];
    const query = ctx.query.trim();
    let entities = ctx.runtime.entitiesFor(worldId);
    if (query) {
      const localMatches = entities.filter((entity) => matchScore(`${entity.name} ${entity.intro}`, query) > 0);
      if (localMatches.length < 3 && ctx.runtime.loadEntities) {
        try {
          const remote = await ctx.runtime.loadEntities(worldId, query);
          const byID = new Map(entities.map((entity) => [entity.id, entity]));
          for (const entity of remote) byID.set(entity.id, entity);
          entities = [...localMatches, ...[...byID.values()].filter((entity) => !localMatches.some((item) => item.id === entity.id))];
        } catch {
          entities = localMatches;
        }
      } else {
        entities = localMatches;
      }
    }
    return entities.slice(0, sourceLimit(ctx.query, ctx.group, ctx.limit)).map((entity) => toOption(worldId, entity));
  },
  preview: (option, ctx): ContextPreview => {
    const data = option.data as { worldId: string; entityId: string };
    const entity: WorldEntity | undefined = ctx.runtime.entityFor(data.worldId, data.entityId);
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
