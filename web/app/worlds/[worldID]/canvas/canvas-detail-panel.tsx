/*
 * [INPUT]: 依赖 canvas-store（selection/context 动作）、panel/*（World/Entity/Relation/Element 态）、
 * canvas-dialogs（DeleteConfirmDialog/AddFieldDialog 由 CanvasDialogs 渲染）、worlds-store、lucide-react
 * [OUTPUT]: 对外提供 CanvasDetailPanel：右侧 320px 详情面板壳（B.3/B.8——空选 = World 态常显），
 * 按 selection 类型路由到 panel 子组件；实体态底部操作区（进入内部 / 删除设定）
 * [POS]: worlds/[worldID]/canvas 的详情层组合根；内容编辑在 panel/* 各态组件内聚实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { WorldDetail } from "@/lib/recut-worlds-client";
import { useWorldsStore } from "@/lib/worlds-store";
import { useWorldCanvasStore } from "./canvas-store";
import { typeLabelOf } from "./panel/field-row";
import { EntityPanel, EntityPanelFooter } from "./panel/entity-panel";
import { ElementPanel } from "./panel/element-panel";
import { RelationPanel } from "./panel/relation-panel";
import { WorldPanel } from "./panel/world-panel";

export function CanvasDetailPanel() {
  const selection = useWorldCanvasStore((state) => state.selection);
  const select = useWorldCanvasStore((state) => state.select);
  const worldId = useWorldCanvasStore((state) => state.worldId);
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  const worldName = useWorldCanvasStore((state) => state.worldName);
  const entityTypes = useWorldCanvasStore((state) => state.entityTypes);
  const detail = useWorldsStore((state) => state.detailsByID[worldId]) as WorldDetail | undefined;
  const loadDetail = useWorldsStore((state) => state.loadDetail);

  // World 态数据：详情（名称/简介/类型/全世界计数）按需加载
  const [loadingDetail, setLoadingDetail] = useState(false);
  useEffect(() => {
    if (!apiBase || !worldId || detail) return;
    setLoadingDetail(true);
    void loadDetail(apiBase, worldId)
      .catch(() => {})
      .finally(() => setLoadingDetail(false));
  }, [apiBase, detail, loadDetail, worldId]);

  const headerLabel =
    selection?.type === "entity"
      ? typeLabelOf(selection.entity, entityTypes)
      : selection?.type === "world"
        ? "世界"
        : selection?.type === "relation"
          ? "语义关系"
          : selection?.type === "canvas"
            ? "画布草稿"
            : "世界";
  const headerTitle =
    selection?.type === "entity"
      ? selection.entity.title
      : selection?.type === "relation"
        ? selection.relation.type
        : selection?.type === "canvas"
          ? selection.element.name || "画布元素"
          : (detail?.name ?? worldName);

  return (
    <aside className="absolute right-0 top-0 z-20 flex h-full w-80 flex-col overflow-hidden border-l bg-card">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-primary">{headerLabel}{loadingDetail ? " · 加载中" : ""}</p>
          <h3 className="mt-0.5 truncate text-base font-semibold">{headerTitle}</h3>
        </div>
        {selection && (
          <button aria-label="关闭详情" className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted" onClick={() => select(null)} type="button">
            <X className="size-4" />
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {selection?.type === "entity" ? (
          <EntityPanel entity={selection.entity} entityTypes={entityTypes} />
        ) : selection?.type === "relation" ? (
          <RelationPanel relation={selection.relation} />
        ) : selection?.type === "canvas" ? (
          <ElementPanel fromEntityId={selection.fromEntityId} toEntityId={selection.toEntityId} />
        ) : (
          <WorldPanel worldDetail={detail} />
        )}
      </div>
      {selection?.type === "entity" && (
        <footer className="shrink-0 border-t p-3">
          <EntityPanelFooter entity={selection.entity} />
        </footer>
      )}
    </aside>
  );
}
