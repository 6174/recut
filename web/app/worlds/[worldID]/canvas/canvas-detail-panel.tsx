/*
 * [INPUT]: 依赖 canvas-store（selection/context 动作）、panel/*（World/Entity/Relation/Element 态）、
 * canvas-dialogs（DeleteConfirmDialog/AddFieldDialog 由 CanvasDialogs 渲染）、worlds-store、lucide-react
 * [OUTPUT]: 对外提供 CanvasDetailPanel：320px 详情面板壳（B.3/B.8——空选 = World 态常显），
 * 停靠左/右可切（panelSide 持久化，头部切换按钮），按 selection 类型路由到 panel 子组件；
 * 多选（selectedIds.length>1）时显示 MultiSelectionSummary 汇总（类型计数 + 逐项列表 + 清空）；
 * 实体态底部操作区（进入内部 / 删除设定）
 * [POS]: worlds/[worldID]/canvas 的详情层组合根；内容编辑在 panel/* 各态组件内聚实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { PanelLeft, PanelRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { WorldDetail } from "@/lib/recut-worlds-client";
import { useWorldsStore } from "@/lib/worlds-store";
import { useWorldCanvasStore } from "./canvas-store";
import { typeLabelOf } from "./panel/field-row";
import { EntityDraftBanner, EntityPanel, EntityPanelFooter } from "./panel/entity-panel";
import { ElementPanel } from "./panel/element-panel";
import { RelationPanel } from "./panel/relation-panel";
import { WorldPanel } from "./panel/world-panel";

export function CanvasDetailPanel() {
  const selection = useWorldCanvasStore((state) => state.selection);
  // 多选（框选 / Shift 点选）：selection 置空，面板改为汇总视图
  const selectedIds = useWorldCanvasStore((state) => state.selectedIds);
  const multi = selectedIds.length > 1;
  const select = useWorldCanvasStore((state) => state.select);
  const panelOpen = useWorldCanvasStore((state) => state.panelOpen);
  const worldId = useWorldCanvasStore((state) => state.worldId);
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  const worldName = useWorldCanvasStore((state) => state.worldName);
  const entityTypes = useWorldCanvasStore((state) => state.entityTypes);
  const relationTypes = useWorldCanvasStore((state) => state.relationTypes);
  const panelSide = useWorldCanvasStore((state) => state.panelSide);
  const setPanelSide = useWorldCanvasStore((state) => state.setPanelSide);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
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

  const headerLabel = multi
    ? "多选"
    : selection?.type === "entity"
      ? typeLabelOf(selection.entity, entityTypes)
      : selection?.type === "world"
        ? "世界"
        : selection?.type === "relation"
          ? "语义关系"
          : selection?.type === "canvas"
            ? "画布草稿"
            : "世界";
  const headerTitle = multi
    ? `已选 ${selectedIds.length} 项`
    : selection?.type === "entity"
      ? selection.entity.name
      : selection?.type === "relation"
        ? (relationTypes.find((item) => item.id === selection.relation.fromRole)?.labelZh ?? selection.relation.fromRole)
        : selection?.type === "canvas"
          ? selection.element.name || "画布元素"
          : (detail?.name ?? worldName);

  if (!panelOpen) return null;
  return (
    <aside className={`absolute top-0 z-20 flex h-full w-80 flex-col overflow-hidden bg-card ${panelSide === "left" ? "left-0 border-r" : "right-0 border-l"}`}>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-primary">{headerLabel}{loadingDetail ? " · 加载中" : ""}</p>
          <h3 className="mt-0.5 truncate text-base font-semibold">{headerTitle}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label={panelSide === "left" ? "移到右侧" : "移到左侧"}
            title={panelSide === "left" ? "移到右侧" : "移到左侧"}
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted"
            onClick={() => setPanelSide(panelSide === "left" ? "right" : "left")}
            type="button"
          >
            {panelSide === "left" ? <PanelRight className="size-4" /> : <PanelLeft className="size-4" />}
          </button>
          {(selection || multi) && (
            <button aria-label="关闭详情" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted" onClick={() => select(null)} type="button">
              <X className="size-4" />
            </button>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {multi ? (
          <MultiSelectionSummary ids={selectedIds} />
        ) : selection?.type === "entity" ? (
          <div className="space-y-4">
            <EntityDraftBanner entity={selection.entity} readOnly={readOnly} />
            <EntityPanel entity={selection.entity} entityTypes={entityTypes} />
          </div>
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

// 多选汇总（框选/Shift 点选）：按类型计数 + 逐项列表（点击回单选，便于逐个查看）；底部清空。
function MultiSelectionSummary({ ids }: { ids: string[] }) {
  const elements = useWorldCanvasStore((state) => state.elements);
  const entities = useWorldCanvasStore((state) => state.entities);
  const relations = useWorldCanvasStore((state) => state.relations);
  const selectMany = useWorldCanvasStore((state) => state.selectMany);
  const rows = ids.map((id) => {
    if (id.startsWith("arrow:")) {
      const relation = relations.find((item) => item.id === id.slice("arrow:".length));
      return { id, kind: "关系", label: relation?.fromRole ?? "关系" };
    }
    if (id.startsWith("entity:")) {
      const entity = entities.find((item) => item.id === id.slice("entity:".length));
      return { id, kind: "设定", label: entity?.name ?? "设定" };
    }
    const element = elements.find((item) => item.id === id);
    return { id, kind: "元素", label: element?.name || element?.kind || "元素" };
  });
  const counts = (["设定", "关系", "元素"] as const)
    .map((kind) => ({ kind, count: rows.filter((row) => row.kind === kind).length }))
    .filter((item) => item.count > 0)
    .map((item) => `${item.kind} ${item.count}`)
    .join(" · ");
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{counts}</p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => selectMany([row.id])}
              type="button"
            >
              <span className="min-w-0 truncate">{row.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{row.kind}</span>
            </button>
          </li>
        ))}
      </ul>
      <button className="w-full rounded-md border py-1.5 text-xs hover:bg-muted" onClick={() => selectMany([])} type="button">
        清空选择
      </button>
    </div>
  );
}
