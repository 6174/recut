/*
 * [INPUT]: 依赖 context-catalog/types、creationWorldContextPayload、World 目录类型与 lucide 图标
 * [OUTPUT]: 对外提供 creation_world 来源：搜索 World、预览身份/只读/统计、toContext 生成 creation_world 旁路
 * [POS]: web/lib/context-catalog/sources 的 Worlds 域来源；非 local 只读（预览标只读，要求修改时引导 Fork）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { createElement } from "react";
import { Globe2 } from "lucide-react";
import { creationWorldContextPayload } from "@/components/agent-panel-types";
import { worldKindLabels, worldReadOnly, type WorldSummary } from "@/lib/recut-worlds-client";
import type { ContextOption, ContextPreview, ContextSearchContext, ContextSource } from "../types";
import { matchScore, sourceLimit } from "../search";

function toOption(world: WorldSummary): ContextOption {
  const readOnly = worldReadOnly(world);
  return {
    key: `creation_world:${world.id}`,
    sourceType: "creation_world",
    group: "world",
    subKind: world.type,
    title: world.name,
    subtitle: world.description,
    badges: [
      { key: "kind", label: worldKindLabels[world.type] ?? world.type, tone: "default" },
      ...(readOnly ? [{ key: "readonly", label: "只读", tone: "muted" as const }] : []),
    ],
    data: world,
    context: creationWorldContextPayload(world.id),
    score: 0,
  };
}

export const worldsSource: ContextSource = {
  type: "creation_world",
  attrs: ["worldid", "revisionid", "name"],
  identity: (attrs) => (attrs.worldid ? String(attrs.worldid) : null),
  group: "world",
  titleKey: "agent.context.source.world",
  insertMode: "inline",
  inlineInsertable: true,
  icon: () => createElement(Globe2, { className: "size-3.5" }),
  label: (attrs) => String(attrs.name ?? attrs.worldid ?? "世界观"),
  toContext: (attrs) => (attrs.worldid ? creationWorldContextPayload(String(attrs.worldid)) : null),
  navigate: (attrs) => {
    if (typeof window !== "undefined" && attrs.worldid) window.location.href = `/worlds/${attrs.worldid}`;
  },
  search: async (ctx) => {
    const query = ctx.query.trim();
    const matched = ctx.runtime.worlds
      .filter((world) => !query || matchScore(`${world.name} ${world.description}`, query) > 0)
      .slice(0, sourceLimit(ctx.query, ctx.group, ctx.limit));
    return matched.map(toOption);
  },
  preview: (option, ctx): ContextPreview => {
    const world = option.data as WorldSummary;
    const detail = ctx.runtime.worldDetailFor(world.id);
    const readOnly = worldReadOnly(world);
    const counts = Object.entries(world.entityCounts ?? {})
      .filter(([, count]) => Boolean(count))
      .map(([kind, count]) => `${kind}×${count}`)
      .join(" · ");
    return {
      title: world.name,
      subtitle: world.description,
      facts: [
        { key: "kind", label: "类型", value: worldKindLabels[world.type] ?? world.type },
        { key: "origin", label: "来源", value: readOnly ? "只读（非本地）" : "本地" },
        { key: "entities", label: "实体", value: counts || "—" },
        { key: "revision", label: "版本", value: detail?.revision?.id?.slice(0, 8) ?? world.currentRevisionId?.slice(0, 8) ?? "—" },
        { key: "updated", label: "更新", value: world.updatedAt ? new Date(world.updatedAt).toLocaleString("zh-CN") : "—" },
      ],
      badges: option.badges,
      open: {
        labelKey: "agent.context.preview.openWorld",
        href: `/worlds/${world.id}`,
      },
    };
  },
};
