/*
 * [INPUT]: 依赖 react、canvas-store（apiBase/worldId/worldName/entities/elements/entityTypes/context/setContext/unhideEntity）、
 * lib/world-entity-tree（分组建树/过滤）、components/world-entity-tree（共用渲染件）、
 * recut-worlds-client（读 entities.list 取整棵世界实体树）、lucide-react
 * [OUTPUT]: 对外提供 CanvasOutlinePanel：右侧 dock 下半部的「大纲」panel —— 顶部「整棵世界」根节点 + 搜索框 +
 * 按类型分组、子设定逐级嵌套的完整世界实体树 + 「已从画布移除」放回区（无外层定位/无浮层，高度由 dock 的 resizer 决定）
 * [POS]: worlds/[worldID]/canvas 的导航 panel，由 canvas-detail-panel 与属性 panel 同 dock 叠放（上属性 / 下大纲）。
 * 导航语义只有一种：点任意节点 = 进入它的子世界（根节点 = 回到全局世界），不在当前世界里做「定位到某张卡」的二义交互；
 * 树始终是「根世界的整棵树」，不随当前所在层裁剪，因此进到任意子世界都还能看到完整层级
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Globe2, RotateCcw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { WorldEntityTree } from "@/components/world-entity-tree";
import { createRecutWorldsClient, type WorldEntitySummary } from "@/lib/recut-worlds-client";
import { buildEntityTreeGroups, filterEntityTreeGroups, type EntityTreeNode } from "@/lib/world-entity-tree";
import { useWorldCanvasStore } from "./canvas-store";
import { typeLabelOf } from "./panel/field-row";

export function CanvasOutlinePanel() {
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  const worldId = useWorldCanvasStore((state) => state.worldId);
  const worldName = useWorldCanvasStore((state) => state.worldName);
  const entities = useWorldCanvasStore((state) => state.entities);
  const elements = useWorldCanvasStore((state) => state.elements);
  const entityTypes = useWorldCanvasStore((state) => state.entityTypes);
  const context = useWorldCanvasStore((state) => state.context);
  const [query, setQuery] = useState("");
  // 折叠集（默认全展开，只有显式折叠的节点在这里）：新节点/新层级天然可见
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [treeItems, setTreeItems] = useState<WorldEntitySummary[]>([]);
  // 整棵树始终是「整个世界的实体」：store.entities 只含当前层，故这里自己读一次全量摘要。
  // 仅在当前层的结构签名变化时重取（改名/创建/删除/进出层），字段级编辑不会造成刷新风暴。
  const treeSignature = entities
    .map((entity) => `${entity.id}|${entity.name}|${entity.typeId}|${entity.parentId ?? ""}|${entity.isProvisional ? 1 : 0}`)
    .join(",");
  useEffect(() => {
    if (!apiBase || !worldId) return;
    let active = true;
    void createRecutWorldsClient(apiBase)
      .entities.list({ worldId, limit: 500, includeProvisional: true })
      .then((page) => {
        if (active) setTreeItems(page.items);
      })
      .catch(() => {
        // 读失败保持上一次的树（画布本体会经 applyCanvasError 提示）
      });
    return () => {
      active = false;
    };
  }, [apiBase, worldId, treeSignature]);

  const groups = useMemo(() => buildEntityTreeGroups(treeItems), [treeItems]);
  const visibleGroups = useMemo(() => filterEntityTreeGroups(groups, query), [groups, query]);
  const filtering = query.trim().length > 0;
  // 过滤态强制展开，否则命中项可能藏在折叠的父节点里
  const collapsedIds = filtering ? new Set<string>() : collapsed;

  const hiddenIds = new Set(elements.filter((element) => element.refKind === "entity" && element.props?.hidden).map((element) => String(element.refId)));
  const hiddenEntities = treeItems.filter((entity) => hiddenIds.has(entity.id));
  const currentContextId = context?.entityId ?? "";

  // 只有一种导航语义：点节点 = 进入它的子世界（根节点 = 回全局世界）
  const enterWorld = (entityId: string) => {
    const store = useWorldCanvasStore.getState();
    if (entityId === (store.context?.entityId ?? "")) return;
    const node = treeItems.find((item) => item.id === entityId);
    store.setContext({ entityId, title: node?.name ?? "子世界" });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-4">
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <h3 className="text-sm font-semibold">大纲</h3>
          <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">{treeItems.length}</span>
        </div>
      </header>
      <div className="border-b p-2">
        <div className="flex items-center gap-1.5 rounded-md border bg-card px-2">
          <Search className="size-3 shrink-0 text-muted-foreground" />
          <input
            className="min-w-0 flex-1 bg-transparent py-1.5 text-xs outline-none"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索设定…"
            value={query}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
        {/* 根节点 = 整棵世界：树的顶点，点它回到全局世界 */}
        <button
          className={`mb-1.5 flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-muted ${
            currentContextId ? "text-foreground/90" : "bg-secondary font-medium text-foreground"
          }`}
          onClick={() => useWorldCanvasStore.getState().setContext(null)}
          title={worldName}
          type="button"
        >
          <Globe2 className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{worldName || "整个世界"}</span>
        </button>
        <WorldEntityTree
          activeId={currentContextId || null}
          collapsedIds={collapsedIds}
          forceExpand={filtering}
          groups={visibleGroups}
          labelOf={(typeId) => typeLabelOf({ typeId }, entityTypes)}
          onSelect={(node: EntityTreeNode) => enterWorld(node.id)}
          onToggleCollapse={(entityId) =>
            setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(entityId)) next.delete(entityId);
              else next.add(entityId);
              return next;
            })
          }
        />
        {!visibleGroups.length && (
          <p className="px-2 py-4 text-xs text-muted-foreground">{treeItems.length ? "没有匹配的设定" : "这个世界还没有设定"}</p>
        )}
        {hiddenEntities.length > 0 && (
          <div className="mt-2 border-t pt-2">
            <p className="px-1 pb-1 text-[10px] font-medium text-muted-foreground">已从画布移除（设定保留）</p>
            <ul className="space-y-0.5">
              {hiddenEntities.map((entity) => (
                <li className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-muted" key={entity.id}>
                  <span className="truncate">{entity.name}</span>
                  <button
                    className="flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => void useWorldCanvasStore.getState().unhideEntity(entity.id)}
                    type="button"
                  >
                    <RotateCcw className="size-3" /> 放回
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
