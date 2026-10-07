/*
 * [INPUT]: 依赖 react、lucide-react、ui/dropdown-menu、components/asset-reference-picker（封面上传/素材库）、
 *   overlays/actions（nodeActionsFor/isActionEnabled）、overlays/types、canvas-store（setCoverPicker/saveEntityField/
 *   worldId/worldName/entityTypes/entities/toast）、lib/world-entity/guided（buildEntityContext/buildMediaContext/
 *   actionsFor/rankActions/buildActionText/draftIdFor/isActionEnabled/styleLockFromEntities）、lib/agent-panel-context（setDraft）
 * [OUTPUT]: 对外提供 nodeToolbarPlugin（内置节点工具栏插件）：节点上方浮出的基础常用操作条；实体卡与媒体卡额外给「AI」二级菜单
 *   （用 AI 完善的动作列表，点击预填全局输入框）；实体卡另有「设置封面」（打开素材库选择并写回实体封面）。无适用操作时不出现
 * [POS]: worlds/[worldID]/canvas/overlays 的节点工具栏插件（RFC 2026-10-07 §2.3/§3.2）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Sparkles } from "lucide-react";
import { AssetReferenceDialog } from "@/components/asset-reference-picker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAgentPanelContext } from "@/lib/agent-panel-context";
import {
  actionsFor,
  buildActionText,
  buildEntityContext,
  buildMediaContext,
  draftIdFor,
  isActionEnabled as isGuidedActionEnabled,
  rankActions,
  styleLockFromEntities,
  type GuidedAiAction,
  type GuidedPromptContext,
} from "@/lib/world-entity/guided";
import { useWorldCanvasStore } from "../canvas-store";
import { isActionEnabled, nodeActionsFor } from "./actions";
import type { NodeOverlayContext, NodeOverlayPlugin } from "./types";

export const nodeToolbarPlugin: NodeOverlayPlugin = {
  id: "node-toolbar",
  kind: "toolbar",
  priority: 0,
  match: (ctx) => ctx.subject.kind === "entity" || nodeActionsFor(ctx).length > 0,
  render: (ctx) => <NodeToolbar ctx={ctx} />,
};

const TOOLBAR_BTN = "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

export function NodeToolbar({ ctx }: { ctx: NodeOverlayContext }) {
  const actions = nodeActionsFor(ctx);
  const guided = useGuidedContext(ctx);
  const isEntity = ctx.subject.kind === "entity";
  if (!actions.length && !isEntity && !guided) return null;
  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border bg-card/95 p-0.5 shadow-lg backdrop-blur" onPointerDown={(event) => event.stopPropagation()}>
      {guided && <AiMenu guided={guided} />}
      {actions.map((action) => {
        const enabled = isActionEnabled(action, ctx);
        const Icon = action.icon;
        return (
          <button
            className={TOOLBAR_BTN}
            disabled={!enabled}
            key={action.id}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void action.run(ctx);
            }}
            title={action.label}
            type="button"
          >
            <Icon className="size-3.5" />
            <span className="hidden sm:inline">{action.label}</span>
          </button>
        );
      })}
      {isEntity && <EntityCoverPicker ctx={ctx} />}
    </div>
  );
}

// 由节点 subject 装配 guided 上下文（实体卡 / 媒体卡共用同一 AI 菜单数据源）。
function useGuidedContext(ctx: NodeOverlayContext): GuidedPromptContext | null {
  const worldId = useWorldCanvasStore((state) => state.worldId);
  const worldName = useWorldCanvasStore((state) => state.worldName);
  const entityTypes = useWorldCanvasStore((state) => state.entityTypes);
  const entities = useWorldCanvasStore((state) => state.entities);
  const styleLock = styleLockFromEntities(entities);
  if (ctx.subject.kind === "entity") {
    const entity = ctx.subject.entity;
    const typeLabel = entityTypes.find((item) => item.id === entity.typeId)?.name ?? entity.typeId;
    return buildEntityContext({ entity, typeLabel, worldId, worldName, locale: "zh", ...(styleLock ? { styleLock } : {}) });
  }
  const subject = ctx.subject;
  const owningEntity = subject.owningEntityId ? entities.find((item) => item.id === subject.owningEntityId) ?? null : null;
  return buildMediaContext({ element: subject.element, modality: subject.modality, owningEntity, worldId, worldName, locale: "zh", ...(styleLock ? { styleLock } : {}) });
}

// 「AI」二级菜单：把「用 AI 完善」的动作收进下拉，点击预填全局输入框（不自动发送）。
function AiMenu({ guided }: { guided: GuidedPromptContext }) {
  const toast = useWorldCanvasStore((state) => state.toast);
  const setDraft = useAgentPanelContext((state) => state.setDraft);
  const ranked = rankActions(guided, actionsFor(guided));
  if (!ranked.length) return null;

  const invoke = (action: GuidedAiAction) => {
    const gate = isGuidedActionEnabled(action, guided);
    if (!gate.ok) {
      toast(`「${action.label}」暂不可用：${gate.reason ?? "条件不满足"}`, "info");
      return;
    }
    setDraft({ id: draftIdFor(action, guided), text: buildActionText(action, guided) });
    toast(`「${action.label}」已填入输入框，确认后发送`, "success");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={`${TOOLBAR_BTN} text-primary hover:text-primary`} title="用 AI 完善（预填提示词）" type="button">
          <Sparkles className="size-3.5" />
          <span className="hidden sm:inline">AI</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuLabel>用 AI 完善（{ranked.length}）</DropdownMenuLabel>
        {ranked.map((action) => {
          const gate = isGuidedActionEnabled(action, guided);
          return (
            <DropdownMenuItem className="justify-between" disabled={!gate.ok} key={action.id} onSelect={() => invoke(action)} title={gate.ok ? action.desc ?? action.label : gate.reason}>
              <span className="truncate">{action.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// 「设置封面」：打开素材库选图/视频，选中写回实体一等封面字段（saveEntityField 的 cover）。
function EntityCoverPicker({ ctx }: { ctx: NodeOverlayContext }) {
  const entity = ctx.subject.kind === "entity" ? ctx.subject.entity : null;
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  const coverPicker = useWorldCanvasStore((state) => state.coverPicker);
  const setCoverPicker = useWorldCanvasStore((state) => state.setCoverPicker);
  const saveEntityField = useWorldCanvasStore((state) => state.saveEntityField);
  if (!entity || coverPicker?.entityId !== entity.id) return null;
  return (
    <AssetReferenceDialog
      apiBase={apiBase}
      description="选择图片或视频作为该设定的封面。"
      kinds={["image", "video"]}
      onClose={() => setCoverPicker(null)}
      onPick={(asset) => {
        void saveEntityField(entity, { cover: { assetId: asset.id, ...(asset.name ? { name: asset.name } : {}), kind: asset.kind } });
        setCoverPicker(null);
      }}
      open
      projectID={null}
      selectedIDs={[]}
      title="设置封面"
    />
  );
}
