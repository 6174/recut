/*
 * [INPUT]: 依赖 react、canvas-store（contextMenu 与 rename/inline-edit/setContext/startRelating/
 * setDeleteTarget/removeElement/promoting 动作）
 * [OUTPUT]: 对外提供 CanvasContextMenu（T3 右键菜单）：实体 = 重命名 / 进入内部 / 建立关系… / 删除…；
 * 便签/文本 = 就地编辑 / 提升为设定… / 删除
 * [POS]: worlds/[worldID]/canvas 的右键菜单层（锚点与动作用 store，组件只做投影）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useState } from "react";
import { useWorldCanvasStore } from "./canvas-store";
import { relationCandidatesOf } from "./canvas-relation-candidates";

export function CanvasContextMenu() {
  const menu = useWorldCanvasStore((state) => state.contextMenu);
  const setContextMenu = useWorldCanvasStore((state) => state.setContextMenu);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  if (!menu) return null;
  const close = () => setContextMenu(null);
  const run = (action: () => void) => {
    close();
    action();
  };
  const entity = menu.kind === "entity" && menu.entityId ? useWorldCanvasStore.getState().entities.find((item) => item.id === menu.entityId) : null;
  const element = menu.kind === "element" && menu.elementId ? useWorldCanvasStore.getState().elements.find((item) => item.id === menu.elementId) : null;
  const items: Array<{ label: string; danger?: boolean; disabled?: boolean; action: () => void }> = [];
  if (entity) {
    items.push(
      { label: "重命名", action: () => run(() => startRename(entity.id)) },
      { label: "进入内部", disabled: readOnly, action: () => run(() => useWorldCanvasStore.getState().setContext({ entityId: entity.id, title: entity.name })) },
      { label: "建立关系…", disabled: readOnly, action: () => run(() => useWorldCanvasStore.getState().startRelating(entity.id)) },
      { label: "删除…", danger: true, disabled: readOnly, action: () => run(() => useWorldCanvasStore.getState().setDeleteTarget(entity)) },
    );
  } else if (element && (element.kind === "note" || element.kind === "text")) {
    items.push(
      { label: "就地编辑", action: () => run(() => startElementEdit(element.id, element.kind === "note" ? "note-body" : "text-body")) },
      { label: "提升为设定…", disabled: readOnly, action: () => run(() => useWorldCanvasStore.getState().setPromoting(element.id)) },
      { label: "删除", danger: true, disabled: readOnly, action: () => run(() => void useWorldCanvasStore.getState().removeElement(element.id)) },
    );
  }
  if (!items.length) return null;
  return (
    <div className="fixed inset-0 z-[70]" onPointerDown={close} onContextMenu={(event) => event.preventDefault()}>
      <div
        className="absolute w-44 overflow-hidden rounded-lg border border-border bg-card py-1 text-sm shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          left: Math.min(menu.screenX, (typeof window !== "undefined" ? window.innerWidth - 190 : 600)),
          top: Math.min(menu.screenY, (typeof window !== "undefined" ? window.innerHeight - 160 : 400)),
        }}
      >
        {items.map((item) => (
          <button
            className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-muted ${item.danger ? "text-destructive" : ""} disabled:opacity-40`}
            disabled={item.disabled}
            key={item.label}
            onClick={() => run(item.action)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// 重命名 = 命名态复用（inline entity-title）：rect 由 store 元素几何计算，提交走 renameEntity
function startRename(entityId: string) {
  useWorldCanvasStore.getState().startEntityRename(entityId);
}

// 就地编辑入口（store 依元素几何计算卡位）
function startElementEdit(elementId: string, kind: "note-body" | "text-body") {
  useWorldCanvasStore.getState().startElementBodyEdit(elementId, kind);
}

// 关系类型就地切换 popover（T15）：双击关系线/标签弹出；Top4 候选 + 全量词表 → changeRelationType；
// 末尾「＋ 自定义关系…」就地输入任意关系名（relation_type 对自由扩展开放，服务端不校验词表）
export function RelationTypePopover() {
  const popover = useWorldCanvasStore((state) => state.relationTypePopover);
  const setRelationTypePopover = useWorldCanvasStore((state) => state.setRelationTypePopover);
  const relationTypes = useWorldCanvasStore((state) => state.relationTypes);
  const entityTypes = useWorldCanvasStore((state) => state.entityTypes);
  const changeRelationType = useWorldCanvasStore((state) => state.changeRelationType);
  const relations = useWorldCanvasStore((state) => state.relations);
  const entities = useWorldCanvasStore((state) => state.entities);
  if (!popover) return null;
  const relation = relations.find((item) => item.id === popover.relationId);
  if (!relation) return null;
  const close = () => setRelationTypePopover(null);
  const from = entities.find((entity) => entity.id === relation.fromEntityId);
  const to = entities.find((entity) => entity.id === relation.toEntityId);
  const fromKind = entityTypes.find((item) => item.id === from?.typeId)?.baseKind || from?.typeId || "";
  const toKind = entityTypes.find((item) => item.id === to?.typeId)?.baseKind || to?.typeId || "";
  const top4 = relationCandidatesOf(fromKind, toKind).filter((id) => relationTypes.some((item) => item.id === id));
  return (
    <div className="fixed inset-0 z-[70]" onPointerDown={close}>
      <div
        className="absolute w-52 rounded-lg border border-border bg-card p-1.5 shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          left: Math.min(popover.screenX, (typeof window !== "undefined" ? window.innerWidth - 220 : 500)),
          top: Math.min(popover.screenY, (typeof window !== "undefined" ? window.innerHeight - 260 : 300)),
        }}
      >
        {top4.map((id) => (
          <button
            className={`block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted ${relation.type === id ? "text-primary" : ""}`}
            key={id}
            onClick={() => {
              close();
              void changeRelationType(relation, id);
            }}
            type="button"
          >
            {relationTypes.find((item) => item.id === id)?.labelZh ?? id}
          </button>
        ))}
        <div className="my-1 h-px bg-border" />
        <div className="max-h-32 overflow-y-auto">
          {relationTypes
            .filter((item) => !top4.includes(item.id))
            .map((item) => (
              <button
                className={`block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted ${relation.type === item.id ? "text-primary" : ""}`}
                key={item.id}
                onClick={() => {
                  close();
                  void changeRelationType(relation, item.id);
                }}
                type="button"
              >
                {item.labelZh}
              </button>
            ))}
        </div>
        <CustomRelationRow current={relation.type} onConfirm={(relationType) => { close(); void changeRelationType(relation, relationType); }} />
      </div>
    </div>
  );
}

// 自定义关系类型（RFC：relation_type 对自由扩展开放）：就地输入关系名，提交 changeRelationType
function CustomRelationRow({ current, onConfirm }: { current: string; onConfirm: (relationType: string) => void }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customType, setCustomType] = useState("");
  if (!customOpen) {
    return (
      <button className="mt-1 block w-full rounded px-2 py-1 text-left text-xs text-primary hover:bg-muted" onClick={() => setCustomOpen(true)} type="button">
        ＋ 自定义关系…
      </button>
    );
  }
  return (
    <div className="mt-1 flex gap-1">
      <input
        autoFocus
        className="min-w-0 flex-1 rounded border bg-background px-1.5 py-0.5 text-xs outline-none focus:border-primary"
        onBlur={() => setCustomOpen(false)}
        onChange={(event) => setCustomType(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && customType.trim()) onConfirm(customType.trim());
          if (event.key === "Escape") setCustomOpen(false);
        }}
        placeholder={`自定义（当前：${current}）`}
        value={customType}
      />
    </div>
  );
}
