/*
 * [INPUT]: 依赖 context-catalog/types、Agent 面板的 Work Surface/Focus 类型、lucide 图标
 * [OUTPUT]: 对外提供 current 组的两个来源：workSurfaceSource（当前页面）与 workFocusSource（当前选择，并把 selection 的 asset/world_entity ref 展开为 group=current 的媒体/实体选项）
 * [POS]: web/lib/context-catalog/sources 的「当前」来源；宿主签发，inlineInsertable=false，只允许 attach/toggle
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { createElement } from "react";
import { Crosshair, FileText } from "lucide-react";
import { hasWorkFocusSelection, creationEntityContextPayload, mediaContextPayload, type ContextRef } from "@/components/agent-panel-types";
import type { ContextOption, ContextPreview, ContextSearchContext, ContextSource } from "../types";

function surfaceOption(ctx: ContextSearchContext): ContextOption | null {
  const surface = ctx.runtime.workSurface;
  if (!surface) return null;
  return {
    key: `work_surface:${surface.surface}:${surface.target?.kind ?? "none"}`,
    sourceType: "work_surface",
    group: "current",
    title: surface.title,
    subtitle: surface.path ?? surface.surface,
    badges: [{ key: "surface", label: surface.surface, tone: "muted" }],
    data: surface,
    score: 0,
    pinned: true,
  };
}

function focusOption(ctx: ContextSearchContext): ContextOption | null {
  const focus = ctx.runtime.workFocus;
  if (!focus || !hasWorkFocusSelection(focus)) return null;
  return {
    key: `work_focus:${focus.view ?? "focus"}`,
    sourceType: "work_focus",
    group: "current",
    title: focus.summary || focus.view || "当前选择",
    subtitle: `${focus.selection?.refs.length ?? 0} 项选中`,
    badges: [{ key: "focus", label: "焦点", tone: "primary" }],
    data: focus,
    score: 0,
    pinned: true,
  };
}

const SELECTION_REF_SUPPORTED = new Set<ContextRef["kind"]>(["asset", "world_entity"]);

function worldSurfaceWorldId(runtime: ContextSearchContext["runtime"]): string | null {
  const surface = runtime.workSurface;
  return surface?.target?.kind === "world" ? surface.target.worldId : null;
}

// selection 展开：asset → media；world_entity → creation_entity（需已知 worldId）；其余标注「即将支持」。
export function selectionOptions(ctx: ContextSearchContext): ContextOption[] {
  const refs = ctx.runtime.workFocus?.selection?.refs ?? [];
  const worldId = worldSurfaceWorldId(ctx.runtime);
  const options: ContextOption[] = [];
  for (const ref of refs) {
    if (ref.kind === "asset") {
      const asset = ctx.runtime.mediaAssets.find((item) => item.id === ref.id);
      options.push({
        key: `media:${ref.id}`,
        sourceType: "media",
        group: "current",
        subKind: asset?.kind,
        title: asset?.name ?? ref.id,
        subtitle: "当前选中素材",
        badges: [{ key: "selected", label: "当前选中", tone: "primary" }],
        data: asset ?? { id: ref.id },
        context: mediaContextPayload(ref.id),
        score: 0,
        pinned: true,
      });
      continue;
    }
    if (ref.kind === "world_entity" && worldId) {
      const entity = ctx.runtime.entityFor(worldId, ref.id);
      options.push({
        key: `creation_entity:${worldId}:${ref.id}`,
        sourceType: "creation_entity",
        group: "current",
        subKind: entity?.typeId,
        title: entity?.name ?? ref.id,
        subtitle: "当前选中实体",
        badges: [{ key: "selected", label: "当前选中", tone: "primary" }],
        data: { worldId, entityId: ref.id },
        context: creationEntityContextPayload(worldId, ref.id),
        score: 0,
        pinned: true,
      });
      continue;
    }
    if (!SELECTION_REF_SUPPORTED.has(ref.kind)) {
      options.push({
        key: `selection:${ref.kind}:${ref.id}`,
        sourceType: "work_focus",
        group: "current",
        title: `${ref.kind} · ${ref.id}`,
        badges: [{ key: "soon", label: "即将支持", tone: "muted" }],
        disabled: true,
        disabledReasonKey: "agent.context.disabled.selectionRef",
        data: ref,
        score: 0,
        pinned: true,
      });
    }
  }
  return options;
}

export const workSurfaceSource: ContextSource = {
  type: "work_surface",
  attrs: ["surface", "targetid", "title"],
  identity: (attrs) => (attrs.surface ? `${attrs.surface}:${attrs.targetid ?? ""}` : null),
  group: "current",
  titleKey: "agent.context.source.workSurface",
  insertMode: "attach",
  inlineInsertable: false,
  icon: () => createElement(FileText, { className: "size-3.5" }),
  label: (attrs) => String(attrs.title ?? attrs.surface ?? "当前页面"),
  search: async (ctx) => {
    const option = surfaceOption(ctx);
    return option ? [option] : [];
  },
  preview: (option, ctx): ContextPreview => {
    const surface = ctx.runtime.workSurface;
    return {
      title: option.title,
      subtitle: option.subtitle,
      body: surface?.policy?.defaultIntent ? `默认意图：${surface.policy.defaultIntent}` : undefined,
      facts: [
        { key: "surface", label: "类型", value: surface?.surface ?? "—" },
        { key: "target", label: "目标", value: surface?.target?.kind ?? "—" },
        { key: "route", label: "路由", value: surface?.path ?? "—" },
      ],
      badges: option.badges,
    };
  },
};

export const workFocusSource: ContextSource = {
  type: "work_focus",
  attrs: ["view"],
  identity: (attrs) => (attrs.view ? String(attrs.view) : null),
  group: "current",
  titleKey: "agent.context.source.workFocus",
  insertMode: "attach",
  inlineInsertable: false,
  icon: () => createElement(Crosshair, { className: "size-3.5" }),
  label: (attrs) => String(attrs.view ?? "当前选择"),
  search: async (ctx) => {
    const options: ContextOption[] = [];
    const focus = focusOption(ctx);
    if (focus) options.push(focus);
    options.push(...selectionOptions(ctx));
    return options;
  },
  preview: (option, ctx): ContextPreview => {
    const focus = ctx.runtime.workFocus;
    const refs = focus?.selection?.refs ?? [];
    return {
      title: option.title,
      subtitle: option.subtitle,
      facts: [
        { key: "view", label: "视图", value: focus?.view ?? "—" },
        { key: "refs", label: "选区", value: refs.map((ref) => `${ref.kind}:${ref.id}`).join("、") || "—" },
        { key: "cursor", label: "光标", value: focus?.cursor?.kind === "time" ? `${focus.cursor.seconds}s` : "—" },
      ],
      badges: option.badges,
    };
  },
};
