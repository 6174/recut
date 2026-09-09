/*
 * [INPUT]: 依赖 react、canvas-store（entities/elements/outlineOpen/selection/setContext/hide/unhide）、
 * lucide-react
 * [OUTPUT]: 对外提供 CanvasOutline（T14 大纲/搜索侧栏）：搜索框 + 当前上下文的实体结构树
 * （kind 分组，子设定缩进；点击 = 选中定位）；画面已移除（hidden）的实体单独区（[放回画布]，T16）
 * [POS]: worlds/[worldID]/canvas 的导航侧栏（>50 实体后结构/搜索问题的 v1 解法）；
 * 详情面板停靠左侧时本侧栏右移避让（left-80）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ListTree, RotateCcw, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { WorldEntity } from "@/lib/recut-worlds-client";
import { useWorldCanvasStore } from "./canvas-store";
import { typeLabelOf } from "./panel/field-row";

export function CanvasOutline() {
  const open = useWorldCanvasStore((state) => state.outlineOpen);
  const panelSide = useWorldCanvasStore((state) => state.panelSide);
  if (!open) return null;
  return <OutlineBody panelSide={panelSide} />;
}

function OutlineBody({ panelSide }: { panelSide: "left" | "right" }) {
  const setOutlineOpen = useWorldCanvasStore((state) => state.setOutlineOpen);
  const entities = useWorldCanvasStore((state) => state.entities);
  const elements = useWorldCanvasStore((state) => state.elements);
  const selection = useWorldCanvasStore((state) => state.selection);
  const select = useWorldCanvasStore((state) => state.select);
  const entityTypes = useWorldCanvasStore((state) => state.entityTypes);
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => entities.filter((item) => !query.trim() || item.title.toLowerCase().includes(query.trim().toLowerCase())),
    [entities, query],
  );
  // kind 分组（保持 store 顺序）；子实体缩进展示在父项下
  const groups = new Map<string, WorldEntity[]>();
  for (const entity of filtered) {
    if (entity.parentId) continue;
    const list = groups.get(entity.kind) ?? [];
    list.push(entity);
    groups.set(entity.kind, list);
  }
  const hiddenIds = new Set(elements.filter((element) => element.refKind === "entity" && element.props?.hidden).map((element) => String(element.refId)));
  const hiddenEntities = entities.filter((entity) => hiddenIds.has(entity.id));
  const isSelected = (entity: WorldEntity) => selection?.type === "entity" && selection.entity.id === entity.id;
  return (
    <aside className={`absolute top-0 z-20 flex h-full w-64 flex-col overflow-hidden border-r bg-card ${panelSide === "left" ? "left-80" : "left-0"}`}>
      <header className="flex shrink-0 items-center justify-between border-b px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <ListTree className="size-3.5" /> 大纲
        </p>
        <button aria-label="关闭大纲" className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted" onClick={() => setOutlineOpen(false)} type="button">
          <X className="size-3.5" />
        </button>
      </header>
      <div className="border-b p-2">
        <div className="flex items-center gap-1.5 rounded-md border bg-background px-2">
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
        {[...groups.entries()].map(([kind, items]) => (
          <div key={kind} className="mb-3">
            <p className="px-1 pb-1 text-[10px] font-medium text-muted-foreground">
              {typeLabelOf({ kind } as WorldEntity, entityTypes)} · {items.length}
            </p>
            <ul className="space-y-0.5">
              {items.map((entity) => (
                <li key={entity.id}>
                  <button
                    className={`block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted ${isSelected(entity) ? "bg-primary/10 text-primary" : ""}`}
                    onClick={() => select({ type: "entity", entity })}
                    type="button"
                  >
                    {entity.title}
                    {entity.isProvisional ? <span className="ml-1 text-[9px] text-warning">草稿</span> : null}
                  </button>
                  {(entity.children ?? []).length > 0 && (
                    <ul className="ml-3 space-y-0.5 border-l pl-2">
                      {(entity.children ?? []).map((child) => {
                        const childEntity = entities.find((item) => item.id === child.id);
                        if (!childEntity) return null;
                        return (
                          <li key={child.id}>
                            <button
                              className={`block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted ${isSelected(childEntity) ? "bg-primary/10 text-primary" : ""}`}
                              onClick={() => select({ type: "entity", entity: childEntity })}
                              type="button"
                            >
                              ⤷ {child.title}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!filtered.length && <p className="px-2 py-4 text-xs text-muted-foreground">没有匹配的设定</p>}
        {hiddenEntities.length > 0 && (
          <div className="mt-2 border-t pt-2">
            <p className="px-1 pb-1 text-[10px] font-medium text-muted-foreground">已从画布移除（设定保留）</p>
            <ul className="space-y-0.5">
              {hiddenEntities.map((entity) => (
                <li className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-muted" key={entity.id}>
                  <span className="truncate">{entity.title}</span>
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
    </aside>
  );
}
