/*
 * [INPUT]: 依赖 react、canvas-store（saveEntityField/renameEntity/confirmEntity/deleteEntity/select/
 * setMediaCover/removeMediaAttr）、recut-worlds-client 类型、canvas/entity-attrs、panel/field-row、
 * lucide-react
 * [OUTPUT]: 对外提供 EntityPanel（B.8 Entity 态，编辑主场）：名称/简介/正文（detail）就地编辑、按
 * type schema 渲染字段（label 映射 + 保存策略 + media 素材字段走 AssetFieldRow + boolean 开关 +
 * [＋ 添加字段] 类型级对话框入口）、Section 折叠 section（+/−）、草稿徽标 → [确认设定]、
 * 素材区（统一 Entity 模型：media 属性列表，[封面]=写入显式 background 属性 / [删除]=删属性，
 * label 即属性 label）、子设定列表（[进入]）、关系列表与 [建立关系…]、[进入内部]/[删除设定…]
 * [POS]: worlds/[worldID]/canvas/panel 的 Entity 态面板；schema 外属性归入「其他」区
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AssetPreviewDialog, type PreviewAsset } from "@/components/asset-preview-dialog";
import type { WorldEntity, WorldEntityType } from "@/lib/recut-worlds-client";
import { parseAssetValue } from "./field-row";
import { attrListOf, attrMediaValueOf, attrTextOf, attrValueOf, entityMediaAttrs } from "../entity-attrs";
import { useWorldCanvasStore } from "../canvas-store";
import { AssetFieldRow, FieldRow, typeLabelOf, useEntityFieldSaver } from "./field-row";

// 面板通用折叠 section：标题行带 +/− 开关，收起后隐藏内容但保留 action 入口隐藏
function Section({ title, action, children, defaultOpen = true }: { title: ReactNode; action?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t pt-3">
      <div className="flex items-center justify-between">
        <button className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)} type="button">
          <span aria-hidden className="grid size-4 shrink-0 place-items-center rounded border text-[10px] leading-none">{open ? "−" : "+"}</span>
          {title}
        </button>
        {action}
      </div>
      {open && <div className="mt-2 space-y-3">{children}</div>}
    </div>
  );
}

export function EntityPanel({ entity, entityTypes }: { entity: WorldEntity; entityTypes: WorldEntityType[] }) {
  const store = useWorldCanvasStore();
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const saveField = useEntityFieldSaver();
  const [pickingTarget, setPickingTarget] = useState(false);
  const [previewRef, setPreviewRef] = useState<PreviewAsset | null>(null);
  const type = entityTypes.find((item) => item.id === entity.typeId);
  const schemaKeys = new Set((type?.fields ?? []).map((field) => field.key));
  // schema 外属性（统一 Entity 模型：attrs 为属性列表；非 media 的原始值归入「其他」区，同样可编辑）
  const extraAttrs = attrListOf(entity).filter((attr) => !schemaKeys.has(attr.key) && attr.type !== "media");
  const mediaAttrs = entityMediaAttrs(entity);
  const childEntities = (entity.children ?? []).map((child) => store.entities.find((item) => item.id === child.id) ?? null);
  const relations = (entity.relations ?? []).filter((relation) => {
    // 面板关系列表与画布同源：scope 为全局或当前 context
    const contextId = store.context?.entityId ?? "";
    return !relation.scopeEntityId || relation.scopeEntityId === contextId;
  });
  const entities = useWorldCanvasStore((state) => state.entities);
  const titleOf = (id: string) => entities.find((item) => item.id === id)?.name ?? "…";

  return (
    <div className="space-y-4 text-sm">
      {/* 草稿徽标 → 确认设定（B.5） */}
      {entity.isProvisional && !readOnly && (
        <div className="flex items-center justify-between rounded-md bg-warning/10 px-3 py-2">
          <span className="text-xs text-warning">草稿 · 尚未进入世界设定</span>
          <button
            className="rounded-md bg-warning/20 px-2 py-1 text-xs font-medium text-warning hover:bg-warning/30"
            onClick={() => void store.confirmEntity(entity.id)}
            type="button"
          >
            确认设定
          </button>
        </div>
      )}

      {/* 名称：与其他字段同一编辑原语（FieldRow 点击进入编辑，blur/⌘↵ 保存 → renameEntity） */}
      <FieldRow label={typeLabelOf(entity, entityTypes)} value={entity.name} onSave={(value) => store.renameEntity(entity, String(value))} readOnly={readOnly} />

      {/* 简介 → 正文（detail）：固定顺序，正文紧随简介（统一 Entity 模型：detail 为一等字段） */}
      <FieldRow label="简介" multiline value={entity.intro ?? ""} placeholder="一句话简介…" onSave={(value) => store.saveEntityField(entity, { intro: String(value) })} />
      <FieldRow
        label="正文"
        multiline
        placeholder="详细内容…"
        value={entity.detail ?? ""}
        onSave={(value) => store.saveEntityField(entity, { detail: String(value) })}
      />

      {/* 字段（按 type schema；B.9/D9 类型级字段；支持 media 素材 / boolean 开关 / 多行） */}
      <Section
        title={`字段（${(type?.fields ?? []).length}）`}
        action={!readOnly ? (
          <button className="text-[10px] text-primary hover:underline" onClick={() => store.setAddFieldFor(entity.typeId)} type="button">
            ＋ 添加字段
          </button>
        ) : undefined}
      >
        {(type?.fields ?? []).map((field) => {
          if (field.type === "media") {
            const kinds = (field.options ?? []).filter((option): option is "image" | "video" | "audio" => option === "image" || option === "video" || option === "audio");
            return (
              <AssetFieldRow
                key={field.key}
                kinds={kinds.length ? kinds : undefined}
                label={field.label ?? field.key}
                onSave={saveField(entity, field.key)}
                readOnly={readOnly}
                value={attrValueOf(entity, field.key)}
              />
            );
          }
          if (field.type === "boolean") {
            return (
              <FieldRow
                boolean
                key={field.key}
                label={field.label ?? field.key}
                readOnly={readOnly}
                onSave={saveField(entity, field.key)}
                value={attrValueOf(entity, field.key) === true ? "true" : "false"}
              />
            );
          }
          return (
            <FieldRow
              key={field.key}
              label={field.label ?? field.key}
              multiline={field.type !== "text" && field.type !== "number"}
              placeholder={field.placeholder}
              readOnly={readOnly}
              onSave={saveField(entity, field.key)}
              value={attrTextOf(entity, field.key)}
            />
          );
        })}
        {/* schema 外的属性（detail 已提升为正文）：归入「其他」区，同样可编辑 */}
        {extraAttrs.length > 0 && (
          <div className="space-y-3 pt-1">
            <p className="text-[11px] font-medium text-muted-foreground/70">其他</p>
            {extraAttrs.map((attr) => (
              <FieldRow
                key={attr.key}
                label={attr.label ?? attr.key}
                value={attrTextOf(entity, attr.key)}
                readOnly={readOnly}
                onSave={saveField(entity, attr.key)}
              />
            ))}
          </div>
        )}
      </Section>

      {/* 素材（统一 Entity 模型）：media 属性列表，label 即属性 label；asset 源点击 → 全局素材弹框；
      [封面] = 写入显式 background media 属性；[删除] = 删除该属性；[＋ 添加] 打开源浮层 */}
      <Section
        title={`参考素材（${mediaAttrs.length}）`}
        action={!readOnly ? (
          <button className="text-[10px] text-primary hover:underline" onClick={() => store.setMediaSource({ entity })} type="button">
            ＋ 添加
          </button>
        ) : undefined}
      >
        {mediaAttrs.length === 0 ? (
          <p className="text-xs text-muted-foreground">还没有参考素材。把图片拖到卡片上即可。</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {mediaAttrs.map((attr) => {
              const media = attrMediaValueOf(entity, attr.key);
              if (!media) return null;
              const asset = parseAssetValue(media);
              const kind = asset?.kind ?? "image";
              const label = attr.label ?? attr.key;
              return (
                <div className="overflow-hidden rounded-md border" key={attr.key}>
                  <button
                    className="block h-14 w-full"
                    onClick={() => {
                      setPreviewRef({
                        id: media.assetId,
                        kind,
                        name: media.name ?? label,
                        origin: "素材库",
                        status: "completed",
                        createdAt: "",
                        updatedAt: "",
                        metadata: {},
                      });
                    }}
                    title="点击查看素材详情"
                    type="button"
                  >
                    {kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt={media.name ?? label} className="h-14 w-full object-cover" src={`${store.apiBase}/v1/media/assets/${encodeURIComponent(media.assetId)}/content`} />
                    ) : (
                      <span className="grid h-14 w-full place-items-center bg-muted text-lg">{kind === "video" ? "🎬" : kind === "audio" ? "🎵" : "📄"}</span>
                    )}
                  </button>
                  <div className="flex items-center justify-between gap-1 px-1 py-0.5">
                    <span className="truncate text-[9px] text-muted-foreground">
                      {label}
                      {attr.key === "background" ? " · 封面" : ""}
                    </span>
                    {!readOnly && (
                      <span className="flex shrink-0 gap-0.5">
                        <button className="rounded px-1 text-[9px] text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => void store.setMediaCover(entity, attr.key)} title="设为封面" type="button">封面</button>
                        <button className="rounded px-1 text-[9px] text-muted-foreground hover:bg-muted hover:text-destructive" onClick={() => void store.removeMediaAttr(entity.id, attr.key)} title="删除素材" type="button">删除</button>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
      {previewRef && <AssetPreviewDialog apiBase={store.apiBase} asset={previewRef} onClose={() => setPreviewRef(null)} />}

      {/* 子设定 */}
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

      {/* 关系 */}
      <div className="border-t pt-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium text-muted-foreground">关系（{relations.length}）</p>
          {!readOnly && (
            <button className="text-[10px] text-primary hover:underline" onClick={() => setPickingTarget(true)} type="button">
              ＋ 建立关系…
            </button>
          )}
        </div>
        {pickingTarget ? (
          <div className="mt-1 max-h-40 space-y-1 overflow-y-auto">
            {entities
              .filter((item) => item.id !== entity.id)
              .map((item) => (
                <button
                  className="flex w-full items-center justify-between rounded bg-muted/50 px-2 py-1.5 text-left text-xs hover:bg-muted"
                  key={item.id}
                  onClick={() => {
                    store.setPendingRelation({ fromEntityId: entity.id, toEntityId: item.id });
                    setPickingTarget(false);
                  }}
                  type="button"
                >
                  <span className="truncate">{item.name}</span>
                  <span className="text-muted-foreground">{typeLabelOf(item, entityTypes)}</span>
                </button>
              ))}
            <button className="w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted" onClick={() => setPickingTarget(false)} type="button">
              取消
            </button>
          </div>
        ) : (
          <ul className="mt-1 space-y-1">
            {relations.map((relation) => (
              <li className="truncate rounded bg-muted/50 px-2 py-1.5 text-xs" key={relation.id}>
                {relation.fromEntityId === entity.id ? "→" : "←"} {relation.type} ·{" "}
                {titleOf(relation.fromEntityId === entity.id ? relation.toEntityId : relation.fromEntityId)}
                {relation.scopeEntityId ? " · 局部" : ""}
              </li>
            ))}
            {!relations.length && <li className="text-xs text-muted-foreground">暂无关系</li>}
          </ul>
        )}
      </div>
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
