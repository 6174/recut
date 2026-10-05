/*
 * [INPUT]: 依赖 canvas-store（selection/context 动作）、panel/*（World/Entity/Relation/Element 态）、
 * canvas-outline（大纲 panel）、canvas-dialogs（DeleteConfirmDialog/AddFieldDialog 由 CanvasDialogs 渲染）、
 * worlds-store、lucide-react
 * [OUTPUT]: 对外提供 CanvasDetailPanel：右侧 320px dock（B.3/B.8——空选 = World 态常显），一个 dock 内叠两个 panel
 * （Photoshop 式多面板）：上半属性 panel（头部可折叠整个 dock 为画布右上角小 icon，panelOpen；按 selection 类型
 * 路由到 panel 子组件；多选时显示 MultiSelectionSummary 汇总）+ 可拖拽 resizer + 下半大纲 panel
 * （CanvasOutlinePanel，高度由 resizer 调整，不折叠）
 * [POS]: worlds/[worldID]/canvas 的详情层组合根；内容编辑在 panel/* 各态组件内聚实现
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WorldDetail } from "@/lib/recut-worlds-client";
import { useWorldsStore } from "@/lib/worlds-store";
import { DEFAULT_OUTLINE_HEIGHT, useWorldCanvasStore } from "./canvas-store";
import { CanvasOutlinePanel } from "./canvas-outline";
import { typeLabelOf } from "./panel/field-row";
import { EntityDraftBanner, EntityPanel } from "./panel/entity-panel";
import { ElementPanel } from "./panel/element-panel";
import { GroupPanel } from "./panel/group-panel";
import { RelationPanel } from "./panel/relation-panel";
import { WorldPanel } from "./panel/world-panel";

// dock 内两个 panel 的高度下限：拖 resizer 时两边都还看得见；实际高度存 store（按浏览器持久化）
const MIN_PANEL_HEIGHT = 160;
const MIN_DETAIL_HEIGHT = 220;

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
  const setPanelOpen = useWorldCanvasStore((state) => state.setPanelOpen);
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
            ? selection.element.kind === "group" ? "分组" : "画布草稿"
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

  // dock 内竖向分配：上方属性 panel 吃剩余空间，下方大纲 panel 高度由 resizer 拖动（两边各有下限）；
  // 高度存 store 并持久化（null = 还没拖过 → 两个 panel 平分，默认就能留意到大纲 panel）
  const asideRef = useRef<HTMLElement | null>(null);
  const outlineHeight = useWorldCanvasStore((state) => state.outlineHeight);
  const setOutlineHeight = useWorldCanvasStore((state) => state.setOutlineHeight);
  const [dockHeight, setDockHeight] = useState(0);
  // 折叠态下 dock 没挂载（量不到高度），展开后要重新量一次
  useLayoutEffect(() => {
    setDockHeight(asideRef.current?.getBoundingClientRect().height ?? 0);
  }, [panelOpen]);
  // 没拖过 = 两个 panel 平分；拖过但窗口变小也要夹住，别把属性 panel 挤没
  const maxOutlineHeight = dockHeight > 0 ? Math.max(MIN_PANEL_HEIGHT, dockHeight - MIN_DETAIL_HEIGHT) : Number.POSITIVE_INFINITY;
  const resolvedOutlineHeight = Math.min(
    outlineHeight ?? (dockHeight > 0 ? Math.round(dockHeight / 2) : DEFAULT_OUTLINE_HEIGHT),
    maxOutlineHeight,
  );
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const resizeTo = (clientY: number) => {
    const drag = resizeRef.current;
    if (!drag) return;
    const containerHeight = asideRef.current?.getBoundingClientRect().height ?? 0;
    const max = Math.max(MIN_PANEL_HEIGHT, containerHeight - MIN_DETAIL_HEIGHT);
    setOutlineHeight(Math.min(max, Math.max(MIN_PANEL_HEIGHT, drag.startHeight - (clientY - drag.startY))));
  };

  // 折叠态：面板隐藏，只在画布右上角留一个小 icon 作为再展开入口（取代原先 Header 的 Info 开关）
  if (!panelOpen) {
    return (
      <button
        aria-label="展开属性面板"
        title="属性面板（空选 = 世界属性）"
        className="absolute right-3 top-3 z-20 grid size-8 place-items-center rounded-md border bg-card text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
        onClick={() => setPanelOpen(true)}
        type="button"
      >
        <PanelRightOpen className="size-4" />
      </button>
    );
  }
  return (
    <aside ref={asideRef} className="absolute right-0 top-0 z-20 flex h-full w-80 flex-col overflow-hidden border-l bg-background">
      {/* 上：属性 panel（高度 = dock 剩余空间） */}
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-4">
          <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <h3 className="truncate text-sm font-semibold">{headerTitle}</h3>
            <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{headerLabel}{loadingDetail ? " · 加载中" : ""}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              aria-label="收起属性面板"
              title="收起整个面板栏"
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted"
              onClick={() => setPanelOpen(false)}
              type="button"
            >
              <PanelRightClose className="size-4" />
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
            selection.element.kind === "group" ? (
              <GroupPanel groupId={selection.element.id} />
            ) : (
              <ElementPanel fromEntityId={selection.fromEntityId} toEntityId={selection.toEntityId} />
            )
          ) : (
            <WorldPanel worldDetail={detail} />
          )}
        </div>
      </section>
      {/* 中：拖拽调整两个 panel 的高度分配 */}
      <div
        aria-label="调整大纲高度"
        className="group relative h-1.5 shrink-0 cursor-row-resize touch-none"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeRef.current = { startY: event.clientY, startHeight: resolvedOutlineHeight };
        }}
        onPointerMove={(event) => resizeTo(event.clientY)}
        onPointerUp={() => {
          resizeRef.current = null;
        }}
        onPointerCancel={() => {
          resizeRef.current = null;
        }}
        role="separator"
      >
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border group-hover:bg-foreground/25" />
      </div>
      {/* 下：大纲 panel（高度 = resizer 分配） */}
      <section className="flex shrink-0 flex-col overflow-hidden" style={{ height: resolvedOutlineHeight }}>
        <CanvasOutlinePanel />
      </section>
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
