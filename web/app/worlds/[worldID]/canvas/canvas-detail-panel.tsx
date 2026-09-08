/*
 * [INPUT]: 依赖 canvas-store（selection/entities/relations 动作）、worlds-store（World 详情统一缓存）、
 * recut-worlds-client 类型与 lucide-react
 * [OUTPUT]: 对外提供画布右侧详情面板：World 核心节点（名称/描述/类型/实体计数/开放设定数）、实体节点
 * （字段、子实体、关系、进入容器）、语义关系边（类型与删除）与自由画布元素（便签/箭头 Promote 入口）
 * [POS]: worlds/[worldID]/canvas 的详情层（统一架构：选中即面板，替代弹窗）；只读快照 + store 动作
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { entityKindLabels, type WorldDetail, type WorldEntity, type WorldEntityRelation } from "@/lib/recut-worlds-client";
import { useWorldsStore } from "@/lib/worlds-store";
import { useWorldCanvasStore } from "./canvas-store";

export function CanvasDetailPanel() {
  const selection = useWorldCanvasStore((state) => state.selection);
  const select = useWorldCanvasStore((state) => state.select);
  const context = useWorldCanvasStore((state) => state.context);
  const setContext = useWorldCanvasStore((state) => state.setContext);
  const setPendingRelation = useWorldCanvasStore((state) => state.setPendingRelation);
  const entities = useWorldCanvasStore((state) => state.entities);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const [pickingTarget, setPickingTarget] = useState(false);

  if (!selection) return null;
  return (
    <aside className="absolute right-0 top-0 z-20 flex h-full w-80 flex-col overflow-hidden border-l bg-card">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-primary">
            {selection.type === "world" ? "World 核心节点" : selection.type === "entity" ? entityKindLabels[selection.entity.kind] ?? selection.entity.kind : selection.type === "relation" ? "语义关系" : "画布草稿"}
          </p>
          <h3 className="mt-0.5 truncate text-base font-semibold">
            {selection.type === "world" ? useWorldCanvasStore.getState().worldName : selection.type === "entity" ? selection.entity.title : selection.type === "relation" ? selection.relation.type : selection.element.name || "画布元素"}
          </h3>
        </div>
        <button aria-label="关闭详情" className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted" onClick={() => select(null)} type="button">
          <X className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {selection.type === "world" ? <WorldSelectionBody /> : null}
        {selection.type === "entity" ? (
          <EntitySelectionBody entity={selection.entity} />
        ) : null}
        {selection.type === "relation" ? <RelationSelectionBody relation={selection.relation} /> : null}
        {selection.type === "canvas" ? <CanvasSelectionBody fromEntityId={selection.fromEntityId} toEntityId={selection.toEntityId} /> : null}
      </div>
      {/* 实体操作区（全局画布 + 可写时） */}
      {selection.type === "entity" && !readOnly && (
        <footer className="shrink-0 border-t p-3">
          {pickingTarget ? (
            <div className="max-h-40 space-y-1 overflow-y-auto">
              <p className="mb-1 text-[11px] text-muted-foreground">选择目标实体：</p>
              {entities
                .filter((item) => item.id !== selection.entity.id)
                .map((item) => (
                  <button
                    className="flex w-full items-center justify-between rounded bg-muted/50 px-2 py-1.5 text-left text-xs hover:bg-muted"
                    key={item.id}
                    onClick={() => {
                      setPendingRelation({ fromEntityId: selection.entity.id, toEntityId: item.id });
                      setPickingTarget(false);
                    }}
                    type="button"
                  >
                    <span className="truncate">{item.title}</span>
                    <span className="text-muted-foreground">{entityKindLabels[item.kind] ?? item.kind}</span>
                  </button>
                ))}
              <button className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted" onClick={() => setPickingTarget(false)} type="button">
                取消
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              {(selection.entity.children?.length ?? 0) > 0 && !context && (
                <button className="flex h-7 flex-1 items-center justify-center rounded-md border text-xs hover:bg-muted" onClick={() => setContext({ entityId: selection.entity.id, title: selection.entity.title })} type="button">
                  进入容器
                </button>
              )}
              <button className="flex h-7 flex-1 items-center justify-center rounded-md border text-xs hover:bg-muted" onClick={() => setPickingTarget(true)} type="button">
                建立关系…
              </button>
            </div>
          )}
        </footer>
      )}
    </aside>
  );
}

function WorldSelectionBody() {
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  const worldId = useWorldCanvasStore((state) => state.worldId);
  const detail = useWorldsStore((state) => state.detailsByID[worldId]);
  const loadDetail = useWorldsStore((state) => state.loadDetail);
  const entities = useWorldCanvasStore((state) => state.entities);
  const relations = useWorldCanvasStore((state) => state.relations);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!apiBase || !worldId || detail) return;
    setLoading(true);
    void loadDetail(apiBase, worldId)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiBase, detail, loadDetail, worldId]);

  const view: WorldDetail | undefined = detail;
  const counts = view?.entityCounts;
  return (
    <div className="space-y-4 text-sm">
      <Field label="定位">{view ? view.type : loading ? "…" : "—"}</Field>
      <Field label="描述">{view?.description || "（尚未填写描述）"}</Field>
      <Field label="Canon 状态">
        {view ? `${view.revision.canonicalHash.slice(0, 12)} · rev ${view.revision.id.slice(0, 8)}` : "…"}
      </Field>
      <Field label="实体（当前上下文）">{entities.length}</Field>
      <Field label="语义关系（当前上下文）">{relations.length}</Field>
      {counts && (
        <Field label="全部分类">
          {Object.entries(counts)
            .filter(([, count]) => count > 0)
            .map(([kind, count]) => `${entityKindLabels[kind as WorldEntity["kind"]] ?? kind} ×${count}`)
            .join("、") || "（空）"}
        </Field>
      )}
      <p className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
        World 节点是最外层画布的核心；实体卡围绕它摆放，语义关系连向各实体。
      </p>
    </div>
  );
}

function EntitySelectionBody({ entity }: { entity: WorldEntity }) {
  const entities = useWorldCanvasStore((state) => state.entities);
  const titleOf = (id: string) => entities.find((item) => item.id === id)?.title ?? "…";
  const fields = Object.entries(entity.content ?? {}).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value));
  return (
    <div className="space-y-4 text-sm">
      <Field label="简述">{entity.summary || "（无简述）"}</Field>
      {entity.isProvisional && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">探索草稿：确认后请在面板操作中 Promote 转为正式设定。</p>
      )}
      {fields.length > 0 && (
        <div className="space-y-2.5">
          {fields.map(([key, value]) => (
            <Field key={key} label={key}>
              {String(value)}
            </Field>
          ))}
        </div>
      )}
      {(entity.children?.length ?? 0) > 0 && (
        <Field label="子实体">
          <ul className="mt-1 space-y-1">
            {entity.children!.map((child) => (
              <li className="truncate rounded bg-muted/50 px-2 py-1 text-xs" key={child.id}>
                {child.title}
              </li>
            ))}
          </ul>
        </Field>
      )}
      <Field label="语义关系">
        {(entity.relations ?? []).length ? (
          <ul className="mt-1 space-y-1">
            {entity.relations!.map((relation: WorldEntityRelation) => (
              <li className="truncate rounded bg-muted/50 px-2 py-1 text-xs" key={relation.id}>
                {relation.fromEntityId === entity.id ? "→" : "←"} {relation.type} ·{" "}
                {titleOf(relation.fromEntityId === entity.id ? relation.toEntityId : relation.fromEntityId)}
              </li>
            ))}
          </ul>
        ) : (
          "（暂无关系）"
        )}
      </Field>
      <Field label="证据">{(entity.references ?? []).length ? `${entity.references!.length} 条参考` : "（暂无证据）"}</Field>
    </div>
  );
}

function RelationSelectionBody({ relation }: { relation: WorldEntityRelation }) {
  const entities = useWorldCanvasStore((state) => state.entities);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const removeRelation = useWorldCanvasStore((state) => state.removeRelation);
  const titleOf = (id: string) => entities.find((item) => item.id === id)?.title ?? "…";
  return (
    <div className="space-y-4 text-sm">
      <Field label="类型">{relation.type}</Field>
      <Field label="方向">{titleOf(relation.fromEntityId)} → {titleOf(relation.toEntityId)}</Field>
      <Field label="作用域">{relation.scopeEntityId ? "局部（实体容器内，不进全局 Canon）" : "全局（进入 Canon）"}</Field>
      {!readOnly && (
        <button
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-destructive/40 text-xs text-destructive hover:bg-destructive/10"
          onClick={() => void removeRelation(relation.id)}
          type="button"
        >
          <Trash2 className="size-3.5" /> 删除此关系
        </button>
      )}
    </div>
  );
}

function CanvasSelectionBody({ fromEntityId, toEntityId }: { fromEntityId?: string; toEntityId?: string }) {
  const element = useWorldCanvasStore((state) => (state.selection?.type === "canvas" ? state.selection.element : null));
  const entities = useWorldCanvasStore((state) => state.entities);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const promote = useWorldCanvasStore((state) => state.promote);
  const removeElement = useWorldCanvasStore((state) => state.removeElement);
  const setPromoting = useWorldCanvasStore((state) => state.setPromoting);
  const titleOf = (id?: string) => (id ? entities.find((item) => item.id === id)?.title ?? "…" : "—");
  if (!element) return null;
  const isArrow = element.kind === "arrow";
  const connectable = Boolean(fromEntityId && toEntityId && fromEntityId !== toEntityId);
  return (
    <div className="space-y-4 text-sm">
      <Field label="元素类型">{element.kind === "note" ? "便签" : element.kind === "text" ? "文本" : element.kind === "arrow" ? "箭头（草稿）" : element.kind === "shape" ? "形状" : element.kind}</Field>
      {element.props?.text ? <Field label="内容">{String(element.props.text)}</Field> : null}
      {isArrow && <Field label="连接">{titleOf(fromEntityId)} → {titleOf(toEntityId)}</Field>}
      {isArrow && connectable && (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
          该箭头连接两个实体。Promote 后将写入 world_relations 成为语义关系（产出 revision），画布草稿保留为投影。
        </p>
      )}
      {!readOnly && (
        <div className="space-y-2">
          {element.kind === "note" && (
            <button className="flex h-8 w-full items-center justify-center rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90" onClick={() => setPromoting(element.id)} type="button">
              ↑ Promote 为实体
            </button>
          )}
          {isArrow && connectable && (
            <button className="flex h-8 w-full items-center justify-center rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90" onClick={() => setPromoting(element.id)} type="button">
              ↑ Promote 为语义关系
            </button>
          )}
          <button className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-destructive/40 text-xs text-destructive hover:bg-destructive/10" onClick={() => void removeElement(element.id)} type="button">
            <Trash2 className="size-3.5" /> 删除草稿
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words leading-6">{children}</dd>
    </div>
  );
}
