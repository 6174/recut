/*
 * [INPUT]: 依赖 context-catalog/types、mediaContextPayload、MediaEventAsset 与 lucide 图标
 * [OUTPUT]: 对外提供 media 来源：按 kind/项目 scope 搜索素材、预览真实大图/元数据、toContext 生成 media 旁路
 * [POS]: web/lib/context-catalog/sources 的素材域来源；复用 Asset SSE 缓存，不新增轮询
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { createElement } from "react";
import { Captions, Film, Image as ImageIcon, Link2, Music2 } from "lucide-react";
import { mediaContextPayload } from "@/components/agent-panel-types";
import type { MediaEventAsset } from "@/components/use-media-asset-events";
import type { ContextOption, ContextPreview, ContextSearchContext, ContextSource } from "../types";
import { matchScore, sourceLimit } from "../search";

function kindIcon(kind: MediaEventAsset["kind"], className: string) {
  if (kind === "video") return createElement(Film, { className });
  if (kind === "audio") return createElement(Music2, { className });
  if (kind === "transcript") return createElement(Captions, { className });
  if (kind === "reference") return createElement(Link2, { className });
  return createElement(ImageIcon, { className });
}

function toOption(asset: MediaEventAsset): ContextOption {
  return {
    key: `media:${asset.id}`,
    sourceType: "media",
    group: "media",
    subKind: asset.kind,
    title: asset.name,
    subtitle: `${asset.kind} · ${asset.origin}`,
    badges: [{ key: "kind", label: asset.kind, tone: "muted" }],
    data: asset,
    context: mediaContextPayload(asset.id),
    score: 0,
  };
}

export const mediaSource: ContextSource = {
  type: "media",
  attrs: ["type", "assetid", "name"],
  identity: (attrs) => (attrs.assetid ? String(attrs.assetid) : null),
  group: "media",
  titleKey: "agent.context.source.media",
  insertMode: "inline",
  inlineInsertable: true,
  scope: "project",
  icon: (attrs) => kindIcon(attrs.type as MediaEventAsset["kind"], "size-3.5"),
  label: (attrs) => String(attrs.name ?? attrs.assetid ?? "素材"),
  toContext: (attrs) => (attrs.assetid ? mediaContextPayload(String(attrs.assetid)) : null),
  search: async (ctx) => {
    const query = ctx.query.trim();
    const projectID = ctx.scope?.projectId ?? ctx.runtime.projectID;
    const scope = ctx.scope?.mediaScope ?? (projectID ? "project" : "library");
    const matched = ctx.runtime.mediaAssets.filter((asset) => {
      if (!query && scope === "project" && projectID && !asset.projectIds?.includes(projectID)) return false;
      if (query && !(matchScore(`${asset.name} ${asset.kind} ${asset.origin}`, query) > 0)) return false;
      return true;
    });
    return matched.slice(0, sourceLimit(ctx.query, ctx.group, ctx.limit)).map(toOption);
  },
  preview: (option, ctx): ContextPreview => {
    const asset = option.data as MediaEventAsset;
    const url = `${ctx.apiBase}/v1/media/assets/${encodeURIComponent(asset.id)}/content`;
    const isVisual = asset.kind === "image" || asset.kind === "video";
    const prompt = typeof asset.metadata?.prompt === "string" ? (asset.metadata.prompt as string) : undefined;
    return {
      title: asset.name,
      subtitle: `${asset.kind} · ${asset.origin}`,
      media: isVisual ? { kind: asset.kind === "video" ? "video" : "image", url } : undefined,
      body: prompt,
      facts: [
        { key: "mime", label: "类型", value: asset.mimeType || asset.kind },
        { key: "origin", label: "来源", value: asset.origin },
        { key: "status", label: "状态", value: asset.status },
        { key: "created", label: "创建", value: asset.createdAt ? new Date(asset.createdAt).toLocaleString("zh-CN") : "—" },
      ],
      badges: option.badges,
    };
  },
};
