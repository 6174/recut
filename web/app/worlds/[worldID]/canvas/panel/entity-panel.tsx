/*
 * [INPUT]: 依赖 react、canvas-store（saveEntityField/renameEntity/confirmEntity/deleteEntity/select）、
 * recut-worlds-client 类型、panel/field-row、lucide-react
 * [OUTPUT]: 对外提供 EntityPanel（B.8 Entity 态，编辑主场）：标题/简介/正文（content.body）就地编辑、按 type schema 渲染字段
 * （label 映射 + 保存策略 + media 素材字段走 AssetFieldRow + boolean 开关 + [＋ 添加字段] 类型级对话框入口）、
 * Section 折叠 section（+/−）、草稿徽标 → [确认设定]、参考素材统一素材模式（点击 → 全局素材弹框）、
 * 子设定列表（[进入]）、关系列表与 [建立关系…]、[进入内部]/[删除设定…]
 * [POS]: worlds/[worldID]/canvas/panel 的 Entity 态面板；schema 外 content key（body 除外）归入「其他」区
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AssetPreviewDialog, type PreviewAsset } from "@/components/asset-preview-dialog";
import type { WorldEntity, WorldEntityType, WorldEvidencePurpose } from "@/lib/recut-worlds-client";
import { evidencePurposeLabels, evidencePurposeOrder } from "../canvas-media";
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
  const type = entityTypes.find((item) => item.id === entity.kind);
  const schemaKeys = new Set((type?.fields ?? []).map((field) => field.key));
  const extraKeys = Object.entries(entity.content ?? {}).filter(
    ([key, value]) => key !== "body" && !schemaKeys.has(key) && ["string", "number", "boolean"].includes(typeof value),
  );
  const childEntities = (entity.children ?? []).map((child) => store.entities.find((item) => item.id === child.id) ?? null);
  const relations = (entity.relations ?? []).filter((relation) => {
    // 面板关系列表与画布同源：scope 为全局或当前 context
    const contextId = store.context?.entityId ?? "";
    return !relation.scopeEntityId || relation.scopeEntityId === contextId;
  });
  const entities = useWorldCanvasStore((state) => state.entities);
  const titleOf = (id: string) => entities.find((item) => item.id === id)?.title ?? "…";

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

      {/* 标题：与其他字段同一编辑原语（FieldRow 点击进入编辑，blur/⌘↵ 保存 → renameEntity） */}
      <FieldRow label={typeLabelOf(entity, entityTypes)} value={entity.title} onSave={(value) => store.renameEntity(entity, String(value))} readOnly={readOnly} />

      {/* 简介 → 正文（body）：固定顺序，正文紧随简介，存 content.body */}
      <FieldRow label="简介" multiline value={entity.summary ?? ""} placeholder="一句话简介…" onSave={(value) => store.saveEntityField(entity, { summary: String(value) })} />
      <FieldRow
        label="正文"
        multiline
        placeholder="详细内容…"
        value={typeof entity.content?.body === "string" ? entity.content.body : ""}
        onSave={(value) => store.saveEntityField(entity, { contentPatch: { body: value } })}
      />

      {/* 字段（按 type schema；B.9/D9 类型级字段；支持 media 素材 / boolean 开关 / 多行） */}
      <Section
        title={`字段（${(type?.fields ?? []).length}）`}
        action={!readOnly ? (
          <button className="text-[10px] text-primary hover:underline" onClick={() => store.setAddFieldFor(entity.kind)} type="button">
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
                value={entity.content?.[field.key]}
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
                value={entity.content?.[field.key] === true ? "true" : "false"}
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
              value={String(entity.content?.[field.key] ?? "")}
            />
          );
        })}
        {/* schema 外的 content key（body 已提升为正文）：归入「其他」区，同样可编辑 */}
        {extraKeys.length > 0 && (
          <div className="space-y-3 pt-1">
            <p className="text-[11px] font-medium text-muted-foreground/70">其他</p>
            {extraKeys.map(([key, value]) => (
              <FieldRow
                key={key}
                label={key}
                value={String(value)}
                readOnly={readOnly}
                onSave={saveField(entity, key)}
              />
            ))}
          </div>
        )}
      </Section>

      {/* 参考素材（统一素材模式）：所有素材点击 → 全局素材弹框；asset 源走 AssetPreviewDialog，url 源走轻量灯箱；[＋ 添加] 打开源浮层 */}
      <Section
        title={`参考素材（${(entity.references ?? []).length}）`}
        action={!readOnly ? (
          <button className="text-[10px] text-primary hover:underline" onClick={() => store.setMediaSource({ entity })} type="button">
            ＋ 添加
          </button>
        ) : undefined}
      >
        {(entity.references ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">还没有参考素材。把图片拖到卡片上即可。</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {(entity.references ?? []).map((item) => {
              const src = item.source === "url" || (!item.assetId && item.url) ? item.url ?? "" : item.assetId ? `${store.apiBase}/v1/media/assets/${encodeURIComponent(item.assetId)}/content` : "";
              if (!src) return null;
              const isImage = item.modality === "image";
              const isUrlSource = item.source === "url" || (!item.assetId && item.url);
              return (
                <div className="overflow-hidden rounded-md border" key={item.id ?? item.assetId ?? item.url}>
                  <button
                    className="block h-14 w-full"
                    onClick={() => {
                      if (isUrlSource) {
                        store.setMediaPreview({ src, modality: item.modality, name: item.label ?? evidencePurposeLabels[item.purpose] ?? "素材" });
                      } else {
                        setPreviewRef({
                          id: item.assetId ?? "",
                          kind: item.modality === "audio" ? "audio" : item.modality === "video" ? "video" : "image",
                          name: item.label ?? evidencePurposeLabels[item.purpose] ?? "素材",
                          origin: "素材库",
                          status: "completed",
                          createdAt: "",
                          updatedAt: "",
                          metadata: {},
                        });
                      }
                    }}
                    title="点击查看素材详情"
                    type="button"
                  >
                    {isImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt={item.label ?? item.purpose} className="h-14 w-full object-cover" src={src} />
                    ) : (
                      <span className="grid h-14 w-full place-items-center bg-muted text-lg">{item.modality === "video" ? "🎬" : item.modality === "audio" ? "🎵" : "📄"}</span>
                    )}
                  </button>
                  <div className="flex items-center justify-between gap-1 px-1 py-0.5">
                    <span className="truncate text-[9px] text-muted-foreground">
                      {evidencePurposeLabels[item.purpose] ?? item.purpose}
                      {item.status === "primary" ? " · 封面" : ""}
                    </span>
                    {!readOnly && (
                      <span className="flex shrink-0 gap-0.5">
                        <button className="rounded px-1 text-[9px] text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => void store.setEvidenceCover(entity, item.id!)} title="设为封面" type="button">封面</button>
                        <select
                          aria-label="改用途"
                          className="w-4 cursor-pointer text-[9px] text-muted-foreground outline-none"
                          onChange={(event) => void store.updateEvidencePurpose(entity, item.id!, event.target.value as WorldEvidencePurpose)}
                          onClick={(event) => event.stopPropagation()}
                          title="改用途"
                          value={item.purpose}
                        >
                          {evidencePurposeOrder.map((purpose) => (
                            <option key={purpose} value={purpose}>{evidencePurposeLabels[purpose]}</option>
                          ))}
                        </select>
                        <button className="rounded px-1 text-[9px] text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => void store.archiveEvidence(entity, item.id!)} title="归档" type="button">归档</button>
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
                <span className="truncate">⤷ {child?.title ?? "…"}</span>
                {child && (
                  <button
                    className="shrink-0 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => store.setContext({ entityId: child.id, title: child.title })}
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
                  <span className="truncate">{item.title}</span>
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
        onClick={() => store.setContext({ entityId: entity.id, title: entity.title })}
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
