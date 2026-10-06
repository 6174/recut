/*
 * [INPUT]: 依赖 react、canvas-store（contextMenu 与 copy/cut/paste/delete、rename/inline-edit/setContext/
 * startRelating/setDeleteTarget/removeElement/removeRelation/setDeleteSelectionIds/selectMany/editor 动作）、
 * canvas-clipboard（readCanvasClipboard 判定粘贴可用）、viewport-plugin（centerContent 适应视图）
 * [OUTPUT]: 对外提供 CanvasContextMenu（T3 右键菜单）：复制 / 剪切 / 粘贴 + 末尾删除（对当前选中集合，多选走批量确认弹框）；
 * 实体 = 重命名 / 进入内部 / 建立关系…；便签/文本 = 就地编辑 / 提升为设定…；关系 = 删除；
 * kind="canvas"（空白/世界节点）= 画布级菜单：粘贴到此处 / 全选 / 适应视图（RFC 2026-10-06）
 * [POS]: worlds/[worldID]/canvas 的右键菜单层（锚点与动作用 store，组件只做投影）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useState } from "react";
import { useWorldCanvasStore, WORLD_ELEMENT_ID } from "./canvas-store";
import { relationCandidatesOf } from "./canvas-relation-candidates";
import { readCanvasClipboard } from "./canvas-clipboard";
import { centerContent } from "@/lib/pomelo/world-canvas/plugins/viewport-plugin";

export function CanvasContextMenu() {
  const menu = useWorldCanvasStore((state) => state.contextMenu);
  const setContextMenu = useWorldCanvasStore((state) => state.setContextMenu);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const selectedIds = useWorldCanvasStore((state) => state.selectedIds);
  if (!menu) return null;
  const close = () => setContextMenu(null);
  const run = (action: () => void) => {
    close();
    action();
  };
  const anchor = menu.worldX != null && menu.worldY != null ? { x: menu.worldX, y: menu.worldY } : undefined;
  const pasteItem = {
    label: "粘贴",
    disabled: readOnly || !readCanvasClipboard(),
    action: () => run(() => void useWorldCanvasStore.getState().pasteClipboard(anchor)),
  };
  let items: Array<{ label: string; danger?: boolean; disabled?: boolean; action: () => void }>;
  if (menu.kind === "canvas") {
    // 画布级菜单（空白/世界节点右键）：粘贴到此处 + 全选 + 适应视图（RFC 2026-10-06）。
    items = [
      pasteItem,
      {
        label: "全选",
        action: () =>
          run(() => {
            const state = useWorldCanvasStore.getState();
            const ids = [
              ...state.entities.map((entity) => `entity:${entity.id}`),
              ...state.elements.filter((element) => element.kind !== "entity" && element.id !== WORLD_ELEMENT_ID).map((element) => element.id),
              ...state.relations.map((relation) => `arrow:${relation.id}`),
            ];
            state.selectMany(ids);
          }),
      },
      {
        label: "适应视图",
        disabled: !useWorldCanvasStore.getState().editor,
        action: () =>
          run(() => {
            const editor = useWorldCanvasStore.getState().editor;
            if (editor) centerContent(editor);
          }),
      },
    ];
  } else {
    const entity = menu.kind === "entity" && menu.entityId ? useWorldCanvasStore.getState().entities.find((item) => item.id === menu.entityId) : null;
    const element = menu.kind === "element" && menu.elementId ? useWorldCanvasStore.getState().elements.find((item) => item.id === menu.elementId) : null;
    const relation = menu.kind === "relation" && menu.relationId ? useWorldCanvasStore.getState().relations.find((item) => item.id === menu.relationId) : null;
    const multi = selectedIds.length > 1;
    items = [
      { label: "复制", disabled: selectedIds.length === 0, action: () => run(() => useWorldCanvasStore.getState().copySelection()) },
      { label: "剪切", disabled: readOnly || selectedIds.length === 0, action: () => run(() => void useWorldCanvasStore.getState().cutSelection()) },
      pasteItem,
    ];
    if (entity && !multi) {
      items.push(
        { label: "重命名", action: () => run(() => startRename(entity.id)) },
        { label: "进入内部", disabled: readOnly, action: () => run(() => useWorldCanvasStore.getState().setContext({ entityId: entity.id, title: entity.name })) },
        { label: "建立关系…", disabled: readOnly, action: () => run(() => useWorldCanvasStore.getState().startRelating(entity.id)) },
      );
    } else if (element && !multi && (element.kind === "note" || element.kind === "text")) {
      items.push(
        { label: "就地编辑", action: () => run(() => startElementEdit(element.id, element.kind === "note" ? "note-body" : "text-body")) },
        { label: "提升为设定…", disabled: readOnly, action: () => run(() => useWorldCanvasStore.getState().setPromoting(element.id)) },
      );
    }
    if (!entity && !relation && selectedIds.length > 1) {
      items.push({ label: "编组", disabled: readOnly, action: () => run(() => void useWorldCanvasStore.getState().groupSelection()) });
    }
    if (multi) {
      items.push({
        label: `删除 ${selectedIds.length} 项…`,
        danger: true,
        disabled: readOnly,
        action: () => run(() => useWorldCanvasStore.getState().setDeleteSelectionIds([...selectedIds])),
      });
    } else if (entity) {
      items.push({ label: "删除…", danger: true, disabled: readOnly, action: () => run(() => useWorldCanvasStore.getState().setDeleteTarget(entity)) });
    } else if (element && element.kind === "group") {
      items.push(
        { label: "解散分组", disabled: readOnly, action: () => run(() => void useWorldCanvasStore.getState().ungroup(element.id)) },
        { label: "删除分组…", danger: true, disabled: readOnly, action: () => run(() => void useWorldCanvasStore.getState().deleteGroup(element.id)) },
      );
    } else if (element) {
      items.push({ label: "删除", danger: true, disabled: readOnly, action: () => run(() => void useWorldCanvasStore.getState().removeElement(element.id)) });
    } else if (relation) {
      items.push({ label: "删除", danger: true, disabled: readOnly, action: () => run(() => void useWorldCanvasStore.getState().removeRelation(relation.id)) });
    }
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
          top: Math.min(menu.screenY, (typeof window !== "undefined" ? window.innerHeight - (items.length * 30 + 20) : 400)),
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

// 关系类型就地切换 popover（T15）：双击关系线/标签弹出；Top4 候选 + 全量词表 → changeRelationRole；
// 末尾「＋ 自定义关系…」就地输入任意关系名（relation_type 对自由扩展开放，服务端不校验词表）
export function RelationTypePopover() {
  const popover = useWorldCanvasStore((state) => state.relationTypePopover);
  const setRelationTypePopover = useWorldCanvasStore((state) => state.setRelationTypePopover);
  const relationTypes = useWorldCanvasStore((state) => state.relationTypes);
  const entityTypes = useWorldCanvasStore((state) => state.entityTypes);
  const changeRelationRole = useWorldCanvasStore((state) => state.changeRelationRole);
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
            className={`block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted ${relation.fromRole === id ? "text-primary" : ""}`}
            key={id}
            onClick={() => {
              close();
              void changeRelationRole(relation, id);
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
                className={`block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted ${relation.fromRole === item.id ? "text-primary" : ""}`}
                key={item.id}
                onClick={() => {
                  close();
                  void changeRelationRole(relation, item.id);
                }}
                type="button"
              >
                {item.labelZh}
              </button>
            ))}
        </div>
        <CustomRelationRow current={relation.fromRole} onConfirm={(fromRole) => { close(); void changeRelationRole(relation, fromRole); }} />
      </div>
    </div>
  );
}

// 自定义关系类型（RFC：relation_type 对自由扩展开放）：就地输入关系名，提交 changeRelationRole
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
