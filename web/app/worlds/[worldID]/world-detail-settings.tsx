/*
 * [INPUT]: 依赖统一 Entity 模型（attrs 自带 schema）、Worlds HTTP client、shared
 * world-entity/{entity-editor,field-row}、lucide-react
 * [OUTPUT]: 对外提供设定视图的右侧实体面板宿主 EntitySettingsPanel（RFC 统一 Entity 模型 P2：
 * 与画布共用一套编辑器；查看与编辑共享同一面板，readOnly 世界渲染静态 FieldRow）——名称/简介/正文
 * + 字段 + 添加属性（媒体拍平 素材（图片/视频/音频），通用「素材」选项已移除）+ 参考素材（media 属性网格）
 * + 关系（词表建立/删除）；统一保存器 useEntityEditorSaver（局部 patch，revision 冲突刷新重试）；
 * 另导出 attrs 驱动的卡片投影助手（非空文本条目 / 完整度 / 媒体值）
 * [POS]: worlds/[worldID] 的表单边界；字段真相 = 实体 attrs（locked 属性锁 label/type、值可改），
 * 不再有 kind 硬编码字段定义与整表单对话框
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useCallback, useRef, useState } from "react";
import { X } from "lucide-react";
import { createRecutWorldsClient, entityKindLabel, type EntityAttr, type EntityAttrMediaValue, type EntityKind, type WorldEntityType, type WorldEntity, type WorldRelationType } from "@/lib/recut-worlds-client";
import { EntityEditor, useEntityEditorSaver, type RelationItem } from "@/components/world-entity/entity-editor";

export function isMediaAttrValue(value: unknown): value is EntityAttrMediaValue {
  return typeof value === "object" && value !== null && typeof (value as EntityAttrMediaValue).assetId === "string";
}

// 卡片投影：非 media、值非空的文本属性条目（key → 可读文本）
export function contentEntries(entity: WorldEntity): Array<{ key: string; label: string; value: string }> {
  return (entity.attrs ?? [])
    .filter((attr) => attr.type !== "media" && !isMediaAttrValue(attr.value))
    .map((attr) => ({ key: attr.key, label: attr.label, value: attrValueText(attr.value) }))
    .filter((entry) => entry.value.trim().length > 0);
}

export function attrValueText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function mediaAttrs(entity: WorldEntity): Array<EntityAttr & { value: EntityAttrMediaValue }> {
  return (entity.attrs ?? []).filter(
    (attr): attr is EntityAttr & { value: EntityAttrMediaValue } => attr.type === "media" && isMediaAttrValue(attr.value),
  );
}

export function mediaAssetUrl(apiBase: string, assetId: string): string {
  return `${apiBase}/v1/media/assets/${encodeURIComponent(assetId)}/content`;
}

export function hasUsefulContent(entity: WorldEntity) {
  return contentEntries(entity).length > 0 || mediaAttrs(entity).length > 0;
}

// 完整度：非空属性数 / 属性总数（readiness 投影的轻量客户端近似）
export function attrsCompleteness(entity: WorldEntity): { filled: number; total: number } {
  const attrs = entity.attrs ?? [];
  const filled = attrs.filter((attr) => attr.type === "media" ? isMediaAttrValue(attr.value) : attrValueText(attr.value).trim().length > 0).length;
  return { filled, total: attrs.length };
}

// EntitySettingsPanel：设定视图的右侧实体面板（与画布 EntityPanel 共用 EntityEditor）。
// 保存 = 局部 patch（useEntityEditorSaver：attrs 全量替换 + revision 冲突刷新重试）；新建态首个
// patch 落地实体后回传 onChanged；关系走 relations.create（词表）与双向列表；删除单步武装确认。
export function EntitySettingsPanel({
  apiBase,
  worldId,
  typeId,
  typeName,
  entityType,
  entityTypes,
  entity,
  candidates,
  relationTypes,
  readOnly = false,
  onClose,
  onChanged,
}: {
  apiBase: string;
  worldId: string;
  /** 当前 tab 的类型 id（新建态落地用） */
  typeId: EntityKind;
  /** 当前类型的用户语言名（目录缺失回退 entityKindLabel） */
  typeName: string;
  /** 当前类型的 schema 字段表 */
  entityType?: WorldEntityType;
  entityTypes: WorldEntityType[];
  /** null = 新建态（首个 patch 创建实体） */
  entity: WorldEntity | null;
  /** 全部类型实体（关系候选；含类型名用于投影） */
  candidates: WorldEntity[];
  relationTypes: WorldRelationType[];
  readOnly?: boolean;
  onClose: () => void;
  /** 每次成功写后回传最新实体，宿主做本地合并（upsert）；deleted=true 表示实体已删除 */
  onChanged: (saved: WorldEntity | null, created: boolean) => void;
}) {
  // 本地 live 实体：保存响应直接回填父组件已加载的完整实体，无需逐次全量刷新
  const liveRef = useRef(entity);
  liveRef.current = entity;
  const [live, setLive] = useState<WorldEntity | null>(entity);
  const [notice, setNotice] = useState("");
  const client = createRecutWorldsClient(apiBase);

  // revision 加载：每次语义写后 revision 推进，统一在写前取新鲜值（1 次 GET detail）
  const loadRevision = useCallback(async () => {
    const detail = await client.get({ worldId });
    return detail.revision.id;
  }, [apiBase, client, worldId]);

  const applySaved = useCallback((saved: WorldEntity) => {
    setLive(saved);
    onChanged(saved, false);
  }, [onChanged]);

  const saver = useEntityEditorSaver({
    apiBase,
    getEntity: () => liveRef.current,
    loadRevision,
    onSaved: applySaved,
    onError: (message) => setNotice(message),
    typeId,
    worldId,
  });

  const refreshEntity = useCallback(async () => {
    if (!liveRef.current?.id) return;
    try {
      const fresh = await client.entities.get({ worldId, entityId: liveRef.current.id });
      liveRef.current = fresh;
      setLive(fresh);
      onChanged(fresh, false);
    } catch {
      // 刷新失败不阻塞编辑
    }
  }, [apiBase, onChanged, worldId]);

  const relations: RelationItem[] = (live?.relations ?? []).map((relation) => ({
    id: relation.id,
    type: relation.type,
    out: relation.fromEntityId === live?.id,
    otherId: relation.fromEntityId === live?.id ? relation.toEntityId : relation.fromEntityId,
    scoped: Boolean(relation.scopeEntityId),
  }));

  async function createRelation(toEntityId: string, relationType: string) {
    if (!liveRef.current?.id) return;
    const expectedRevisionId = await saver.revision();
    try {
      await client.relations.create({ worldId, fromEntityId: liveRef.current.id, toEntityId, relationType, expectedRevisionId });
      saver.invalidateRevision();
      await refreshEntity();
    } catch (cause) {
      saver.invalidateRevision();
      setNotice(cause instanceof Error ? cause.message : "建立关系失败");
    }
  }

  async function removeEntity() {
    if (!liveRef.current?.id) return;
    const expectedRevisionId = await saver.revision();
    try {
      await client.entities.remove({ worldId, entityId: liveRef.current.id, expectedRevisionId });
      saver.invalidateRevision();
      onChanged(null, false);
      onClose();
    } catch (cause) {
      saver.invalidateRevision();
      setNotice(cause instanceof Error ? cause.message : "删除失败");
    }
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-[60] flex w-80 flex-col overflow-hidden border-l bg-card shadow-2xl" role="dialog" aria-label="设定详情">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-primary">{typeName}</p>
          <h3 className="mt-0.5 truncate text-base font-semibold">{live?.name || "新建设定"}</h3>
        </div>
        <button aria-label="关闭设定详情" className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted" onClick={onClose} type="button">
          <X className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <EntityEditor
          apiBase={apiBase}
          candidates={candidates.map((item) => ({ id: item.id, name: item.name, typeId: item.typeId }))}
          entity={live}
          entityTypes={entityTypes.map((item) => ({ id: item.id, name: item.name }))}
          fields={entityType?.fields ?? []}
          readOnly={readOnly}
          relationTypes={relationTypes}
          relations={relations}
          saveField={saver.saveField}
          typeLabel={typeName || entityKindLabel(typeId)}
          onCreateRelation={createRelation}
        />
      </div>
      {notice && <p className="shrink-0 px-4 pb-2 text-xs text-warning">{notice}</p>}
      <footer className="shrink-0 border-t p-3">
        {live?.id && !readOnly && (
          <button
            className="flex h-7 w-full items-center justify-center rounded-md border border-destructive/40 text-xs text-destructive hover:bg-destructive/10"
            onClick={() => {
              if (window.confirm(`删除「${live.name}」？`)) void removeEntity();
            }}
            type="button"
          >
            删除设定
          </button>
        )}
      </footer>
    </aside>
  );
}
