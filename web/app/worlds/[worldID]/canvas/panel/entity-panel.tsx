/*
 * [INPUT]: 依赖 react、canvas-store（renameEntity/confirmEntity/deleteEntity/select/setContext/
 * setPendingRelation/setAddFieldFor）、recut-worlds-client 类型、shared world-entity/field-row、
 * lucide-react
 * [OUTPUT]: 对外提供 EntityPanel（B.8 Entity 态）：共享 EntityEditor 的画布宿主薄壳 —— 名称
 * 走 renameEntity（元素投影同步），字段/属性（media 属性同一路径）/关系全部由共享编辑器渲染；
 * 画布特有部分仅保留：子设定列表（[进入]）、[进入内部]/[删除设定…]（CanvasDetailPanel 页脚）
 * [POS]: worlds/[worldID]/canvas/panel 的 Entity 态面板；编辑 UI 真相在 web/components/world-entity
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ChevronRight, Trash2 } from "lucide-react";
import type { WorldEntity, WorldEntityType } from "@/lib/recut-worlds-client";
import { EntityEditor, type RelationItem } from "@/components/world-entity/entity-editor";
import { typeLabelOf } from "@/components/world-entity/field-row";
import { useWorldCanvasStore } from "../canvas-store";

export function EntityPanel({ entity, entityTypes }: { entity: WorldEntity; entityTypes: WorldEntityType[] }) {
  const store = useWorldCanvasStore();
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const type = entityTypes.find((item) => item.id === entity.typeId);
  const childEntities = (entity.children ?? []).map((child) => store.entities.find((item) => item.id === child.id) ?? null);
  const entities = useWorldCanvasStore((state) => state.entities);
  const relationScope = store.context?.entityId ?? "";
  const relations: RelationItem[] = (entity.relations ?? [])
    .filter((relation) => !relation.scopeEntityId || relation.scopeEntityId === relationScope)
    .map((relation) => ({
      id: relation.id,
      type: relation.type,
      otherId: relation.fromEntityId === entity.id ? relation.toEntityId : relation.fromEntityId,
      out: relation.fromEntityId === entity.id,
      scoped: Boolean(relation.scopeEntityId),
    }));
  const candidates = entities.map((item) => ({ id: item.id, name: item.name, typeId: item.typeId }));

  return (
    <EntityEditor
      apiBase={store.apiBase}
      candidates={candidates}
      entity={entity}
      entityTypes={entityTypes}
      fields={type?.fields ?? []}
      readOnly={readOnly}
      relationTypes={store.relationTypes}
      relations={relations}
      saveField={(patch) => store.saveEntityField(entity, patch)}
      typeLabel={typeLabelOf(entity, entityTypes)}
      onAddTypeField={() => store.setAddFieldFor(entity.typeId)}
      onCreateRelation={async (toEntityId, relationType) => {
        await store.createRelation(entity.id, toEntityId, relationType);
      }}
      onRenameField={(value) => store.renameEntity(entity, value)}
      tail={
        <>
          {/* 子设定（画布特有：进入上下文导航） */}
          {(childEntities.length > 0 || !readOnly) && (
            <div className="border-t pt-3">
              <p className="text-[11px] font-medium text-muted-foreground">子设定（{childEntities.length}）</p>
              <ul className="mt-1 space-y-1">
                {childEntities.map((child, index) => (
                  <li className="flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1.5 text-xs" key={child?.id ?? index}>
                    <span className="truncate">⤷ {child?.name ?? "…"}</span>
                    {child && (
                      <button
                        className="shrink-0 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => store.setContext({ entityId: child.id, title: child.name })}
                        type="button"
                      >
                        进入
                      </button>
                    )}
                  </li>
                ))}
                {!childEntities.length && <li className="text-xs text-muted-foreground">暂无子设定</li>}
              </ul>
            </div>
          )}
        </>
      }
    />
  );
}

// 草稿确认条（B.5）仅画布侧使用（草稿实体由画布创建流程产生）
export function EntityDraftBanner({ entity, readOnly }: { entity: WorldEntity; readOnly: boolean }) {
  const confirmEntity = useWorldCanvasStore((state) => state.confirmEntity);
  if (!entity.isProvisional || readOnly) return null;
  return (
    <div className="flex items-center justify-between rounded-md bg-warning/10 px-3 py-2">
      <span className="text-xs text-warning">草稿 · 尚未进入世界设定</span>
      <button
        className="rounded-md bg-warning/20 px-2 py-1 text-xs font-medium text-warning hover:bg-warning/30"
        onClick={() => void confirmEntity(entity.id)}
        type="button"
      >
        确认设定
      </button>
    </div>
  );
}

// 面板底部操作区由 CanvasDetailPanel 渲染（进入内部 / 在画布定位 / 删除设定）
export function EntityPanelFooter({ entity }: { entity: WorldEntity }) {
  const store = useWorldCanvasStore();
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  if (readOnly) return null;
  return (
    <div className="flex gap-2">
      <button
        className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md border text-xs hover:bg-muted"
        onClick={() => store.setContext({ entityId: entity.id, title: entity.name })}
        type="button"
      >
        <ChevronRight className="size-3.5" /> 进入内部
      </button>
      <button
        className="flex h-7 items-center justify-center gap-1 rounded-md border border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive/10"
        onClick={() => store.setDeleteTarget(entity)}
        type="button"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}
