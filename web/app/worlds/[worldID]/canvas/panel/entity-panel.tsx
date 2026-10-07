/*
 * [INPUT]: 依赖 react、canvas-store（renameEntity/confirmEntity/deleteEntity/select/setContext/
 * setPendingRelation/setAddFieldFor）、recut-worlds-client 类型、shared world-entity/field-row
 * [OUTPUT]: 对外提供 EntityPanel（B.8 Entity 态）：共享 EntityEditor 的画布宿主薄壳 —— 名称
 * 走 renameEntity（元素投影同步），字段/属性（media 属性同一路径）由共享编辑器渲染；
 * 画布侧不展示「关系」「子设定」（细节导航交给画布与大纲，降低详情复杂度）
 * [POS]: worlds/[worldID]/canvas/panel 的 Entity 态面板；编辑 UI 真相在 web/components/world-entity
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import type { WorldEntity, WorldEntityType } from "@/lib/recut-worlds-client";
import { EntityEditor } from "@/components/world-entity/entity-editor";
import { typeLabelOf } from "@/components/world-entity/field-row";
import { useWorldCanvasStore } from "../canvas-store";

export function EntityPanel({ entity, entityTypes }: { entity: WorldEntity; entityTypes: WorldEntityType[] }) {
  const store = useWorldCanvasStore();
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const type = entityTypes.find((item) => item.id === entity.typeId);

  return (
    <EntityEditor
      apiBase={store.apiBase}
      entity={entity}
      entityTypes={entityTypes}
      fields={type?.fields ?? []}
      readOnly={readOnly}
      hideRelations
      // 取当前 store 快照的实体（而非渲染期 prop）：连续字段编辑间 prop 可能仍指向旧快照，
      // 全量 attrs 替换语义下会丢掉上一步的改动；字段管理（改名/删除/重置）同样依赖最新 attrs。
      saveField={(patch) => store.saveEntityField(useWorldCanvasStore.getState().entities.find((item) => item.id === entity.id) ?? entity, patch)}
      typeLabel={typeLabelOf(entity, entityTypes)}
      onAddTypeField={() => store.setAddFieldFor(entity.typeId)}
      onRenameTypeField={(fieldKey, label) => store.renameTypeField(entity.typeId, fieldKey, label)}
      onRemoveTypeField={(fieldKey) => store.removeTypeField(entity.typeId, fieldKey)}
      onRenameField={(value) => store.renameEntity(entity, value)}
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
