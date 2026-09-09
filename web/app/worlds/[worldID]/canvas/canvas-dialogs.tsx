/*
 * [INPUT]: 依赖 canvas-store（creating/pendingRelation/promotingId 状态与 create/createRelation/promote 动作）
 * 与 lucide-react
 * [OUTPUT]: 对外提供画布对话框层：受控关系确认 RelateDialog（T5 重设计：Top4 候选映射 + 搜索 +
 * 分组全量 + 新建关系类型）、Promote 确认（便签→设定 / 箭头→关系）、删除设定确认（影响范围）、
 * 添加字段（类型级）与创建菜单/右键菜单的组合挂载（T2/T3）
 * [POS]: worlds/[worldID]/canvas 的对话框层；只读快照 + store 动作，语义写全部产出 revision
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useMemo, useState } from "react";
import type { WorldRelationType } from "@/lib/recut-worlds-client";
import { relationCandidatesOf } from "./canvas-relation-candidates";
import { MediaPreviewDialog, MediaSourceDialog } from "./canvas-media-dialogs";
import { AiEntityDialog } from "./canvas-ai-dialog";
import { useWorldCanvasStore } from "./canvas-store";
import { CanvasContextMenu, RelationTypePopover } from "./canvas-context-menu";
import { CreateMenu } from "./canvas-create-menu";

export function CanvasDialogs() {
  const pendingRelation = useWorldCanvasStore((state) => state.pendingRelation);
  const promotingId = useWorldCanvasStore((state) => state.promotingId);
  const promotingElement = useWorldCanvasStore((state) => state.elements.find((element) => element.id === promotingId));
  const deleteTarget = useWorldCanvasStore((state) => state.deleteTarget);
  const addFieldFor = useWorldCanvasStore((state) => state.addFieldFor);
  return (
    <>
      <CreateMenu />
      <CanvasContextMenu />
      <RelationTypePopover />
      {pendingRelation && <RelateDialog />}
      {promotingElement && <PromoteDialog elementKind={promotingElement.kind} />}
      {deleteTarget && <DeleteConfirmDialog />}
      {addFieldFor && <AddFieldDialog />}
      <MediaSourceDialog />
      <AiEntityDialog />
      <MediaPreviewDialog />
    </>
  );
}

// 删除设定确认（B.6/D7）：展示影响范围（子设定/关系/素材，本地可推导部分），单击强确认；
// 次选项「从画布移除」（T16）：设定保留，仅移除投影（大纲面板可放回）
function DeleteConfirmDialog() {
  const target = useWorldCanvasStore((state) => state.deleteTarget);
  const setDeleteTarget = useWorldCanvasStore((state) => state.setDeleteTarget);
  const deleteEntity = useWorldCanvasStore((state) => state.deleteEntity);
  const hideEntityFromCanvas = useWorldCanvasStore((state) => state.hideEntityFromCanvas);
  const entities = useWorldCanvasStore((state) => state.entities);
  const relations = useWorldCanvasStore((state) => state.relations);
  if (!target) return null;
  const children = target.children?.length ?? 0;
  const relationCount = relations.filter((relation) => relation.fromEntityId === target.id || relation.toEntityId === target.id).length;
  const evidenceCount = (target.references ?? []).length;
  const impacts = [
    children > 0 ? `${children} 个子设定` : "",
    relationCount > 0 ? `${relationCount} 条关系` : "",
    evidenceCount > 0 ? `${evidenceCount} 份参考素材` : "",
  ].filter(Boolean);
  return (
    <div aria-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={() => setDeleteTarget(null)} role="dialog">
      <div className="w-full max-w-sm rounded-md border bg-card p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <h3 className="text-base font-semibold">删除「{target.title}」？</h3>
        <p className="mt-2 text-sm text-muted-foreground">{impacts.length ? `将一并删除：${impacts.join(" · ")}` : "该设定没有关联的子设定、关系或素材。"}</p>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            className="mr-auto text-xs text-muted-foreground hover:underline"
            onClick={() => {
              const id = target.id;
              setDeleteTarget(null);
              void hideEntityFromCanvas(id);
            }}
            type="button"
          >
            仅从画布移除（设定保留）
          </button>
          <button className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => setDeleteTarget(null)} type="button">取消</button>
          <button
            className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              const id = target.id;
              setDeleteTarget(null);
              void deleteEntity(id);
            }}
            type="button"
          >
            删除设定
          </button>
        </div>
      </div>
    </div>
  );
}

// 添加字段（D9：类型级字段）——字段加到该 type 的 schema，作用于该类型所有设定；UI 明示作用范围。
// 类型含 media（素材），拍平为 素材（图片）/素材（视频）/素材（音频），assetKind 经 options 携带（无需后端改动）
function AddFieldDialog() {
  const kind = useWorldCanvasStore((state) => state.addFieldFor);
  const setAddFieldFor = useWorldCanvasStore((state) => state.setAddFieldFor);
  const entityTypes = useWorldCanvasStore((state) => state.entityTypes);
  const entities = useWorldCanvasStore((state) => state.entities);
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<"text" | "textarea" | "number" | "boolean" | "media_image" | "media_video" | "media_audio">("text");
  const [busy, setBusy] = useState(false);
  const fieldKind = () => (fieldType === "media_image" ? "image" : fieldType === "media_video" ? "video" : fieldType === "media_audio" ? "audio" : "") as "" | "image" | "video" | "audio";
  if (!kind) return null;
  const type = entityTypes.find((item) => item.id === kind);
  const typeName = type?.name ?? kind;
  const sample = entities.find((entity) => entity.kind === kind);
  const keyFromLabel = () => {
    const existing = new Set((type?.fields ?? []).map((field) => field.key));
    const base = label.trim() || `field_${Date.now()}`;
    let key = base;
    let index = 2;
    while (existing.has(key)) key = `${base}_${index++}`;
    return key;
  };
  const submit = async () => {
    if (!label.trim() || busy || !type) return;
    setBusy(true);
    try {
      const { createRecutWorldsClient } = await import("@/lib/recut-worlds-client");
      const apiBase = useWorldCanvasStore.getState().apiBase;
      const worldId = useWorldCanvasStore.getState().worldId;
      await createRecutWorldsClient(apiBase).entityTypes.upsert({
        worldId,
        id: type.id,
        name: type.name,
        icon: type.icon,
        color: type.color,
        baseKind: type.baseKind,
        fields: [...type.fields, { key: keyFromLabel(), label: label.trim(), type: "media", ...(fieldKind() ? { options: [fieldKind()] } : {}) }],
      });
      await useWorldCanvasStore.getState().load(true);
      setAddFieldFor(null);
    } catch (cause) {
      useWorldCanvasStore.setState({ notice: cause instanceof Error ? cause.message : "添加字段失败" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div aria-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={() => setAddFieldFor(null)} role="dialog">
      <div className="w-full max-w-sm rounded-md border bg-card p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <h3 className="text-base font-semibold">添加字段「{typeName}」</h3>
        <p className="mt-1 text-xs text-warning">该字段将出现在所有「{typeName}」设定上{sample ? `（如「${sample.title}」）` : ""}。</p>
        <div className="mt-3 space-y-3">
          <input autoFocus className="w-full rounded-md border bg-background p-2 text-sm outline-none focus:border-primary" onChange={(event) => setLabel(event.target.value)} placeholder="字段名（如：职业）" value={label} />
          <select className="w-full rounded-md border bg-background p-2 text-sm" onChange={(event) => setFieldType(event.target.value as typeof fieldType)} value={fieldType}>
            <option value="text">单行文本</option>
            <option value="textarea">多行文本</option>
            <option value="number">数字</option>
            <option value="boolean">开关</option>
            <option value="media_image">素材（图片）</option>
            <option value="media_video">素材（视频）</option>
            <option value="media_audio">素材（音频）</option>
          </select>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => setAddFieldFor(null)} type="button">取消</button>
          <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50" disabled={!label.trim() || busy} onClick={() => void submit()} type="button">
            添加字段
          </button>
        </div>
      </div>
    </div>
  );
}

function RelateDialog() {
  const pendingRelation = useWorldCanvasStore((state) => state.pendingRelation);
  const relationTypes = useWorldCanvasStore((state) => state.relationTypes);
  const entityTypes = useWorldCanvasStore((state) => state.entityTypes);
  const createRelation = useWorldCanvasStore((state) => state.createRelation);
  const setPendingRelation = useWorldCanvasStore((state) => state.setPendingRelation);
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [customType, setCustomType] = useState("");
  if (!pendingRelation) return null;
  const store = useWorldCanvasStore.getState();
  const from = store.entities.find((entity) => entity.id === pendingRelation.fromEntityId);
  const to = store.entities.find((entity) => entity.id === pendingRelation.toEntityId);
  const titleOf = (id: string) => store.entities.find((entity) => entity.id === id)?.title ?? id.slice(0, 10);
  const typeLabel = (id: string) => relationTypes.find((item) => item.id === id)?.labelZh ?? id;
  // Top4 候选（B.10 映射表；自定义类型按 base_kind 查表）
  const fromKind = entityTypes.find((item) => item.id === from?.kind)?.baseKind || from?.kind || "";
  const toKind = entityTypes.find((item) => item.id === to?.kind)?.baseKind || to?.kind || "";
  const top4 = relationCandidatesOf(fromKind, toKind).filter((id) => relationTypes.some((item) => item.id === id));
  // 全量分组（搜索过滤）
  const groups = new Map<string, WorldRelationType[]>();
  for (const item of relationTypes) {
    if (query.trim() && !(item.labelZh.includes(query.trim()) || item.id.includes(query.trim()))) continue;
    const list = groups.get(item.group) ?? [];
    list.push(item);
    groups.set(item.group, list);
  }
  const confirm = (relationType: string) => {
    if (!relationType) return;
    setType(relationType);
    void createRelation(pendingRelation.fromEntityId, pendingRelation.toEntityId, relationType);
  };
  const groupLabels: Record<string, string> = { people: "人际", world: "世界", story: "故事", video: "视频" };
  return (
    <div aria-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={() => setPendingRelation(null)} role="dialog">
      <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-md border bg-card p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <h3 className="text-base font-semibold">建立语义关系</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {titleOf(pendingRelation.fromEntityId)} → {titleOf(pendingRelation.toEntityId)}
        </p>
        {top4.length > 0 && (
          <>
            <p className="mt-3 mb-1 text-[10px] text-muted-foreground">推荐</p>
            <div className="grid grid-cols-4 gap-1.5">
              {top4.map((id) => (
                <button
                  className={`flex flex-col items-center gap-0.5 rounded-lg border px-1 py-2 text-xs ${type === id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}
                  key={id}
                  onClick={() => confirm(id)}
                  type="button"
                >
                  <span className="font-medium">{typeLabel(id)}</span>
                  <span className="text-[9px] text-muted-foreground">{id}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <input
          className="mt-3 w-full rounded-md border bg-background p-2 text-sm outline-none focus:border-primary"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索关系类型…"
          value={query}
        />
        <div className="mt-2 space-y-2">
          {[...groups.entries()].map(([group, items]) => (
            <div key={group}>
              <p className="text-[10px] text-muted-foreground">{groupLabels[group] ?? group}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {items.map((item) => (
                  <button
                    className={`rounded-md border px-2 py-1 text-xs ${type === item.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}
                    key={item.id}
                    onClick={() => confirm(item.id)}
                    type="button"
                  >
                    {item.labelZh}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!groups.size && <p className="text-xs text-muted-foreground">没有匹配的关系类型</p>}
        </div>
        {customOpen ? (
          <div className="mt-3 flex gap-2">
            <input
              autoFocus
              className="min-w-0 flex-1 rounded-md border bg-background p-1.5 text-xs outline-none focus:border-primary"
              onChange={(event) => setCustomType(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") confirm(customType.trim());
              }}
              placeholder="自定义关系类型（如：师徒）"
              value={customType}
            />
            <button className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground" onClick={() => confirm(customType.trim())} type="button">
              建立
            </button>
          </div>
        ) : (
          <button className="mt-3 text-xs text-primary hover:underline" onClick={() => setCustomOpen(true)} type="button">
            ＋ 新建关系类型
          </button>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => setPendingRelation(null)} type="button">取消</button>
          <button
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            disabled={!type}
            onClick={() => confirm(type)}
            type="button"
          >
            建立关系
          </button>
        </div>
      </div>
    </div>
  );
}

function PromoteDialog({ elementKind }: { elementKind: string }) {
  const promotingId = useWorldCanvasStore((state) => state.promotingId);
  const setPromoting = useWorldCanvasStore((state) => state.setPromoting);
  const promote = useWorldCanvasStore((state) => state.promote);
  const entityTypes = useWorldCanvasStore((state) => state.entityTypes);
  const relationTypes = useWorldCanvasStore((state) => state.relationTypes);
  const [kind, setKind] = useState(elementKind === "note" ? "reference" : "references");
  const isNote = elementKind === "note";
  return (
    <div aria-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-foreground/30 p-6 backdrop-blur-[1px]" onMouseDown={() => setPromoting(null)} role="dialog">
      <div className="w-full max-w-md rounded-md border bg-card p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <h3 className="text-base font-semibold">{isNote ? "提升为设定" : "提升为语义关系"}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {isNote ? "便签将转为草稿设定；原画布元素保留为投影。" : "箭头将写入 world_relations 并产出 revision；原画布元素保留为草稿投影。"}
        </p>
        {isNote ? (
          <select className="mt-3 w-full rounded-md border bg-background p-2 text-sm" onChange={(event) => setKind(event.target.value)} value={kind}>
            {entityTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}（{type.id}）
              </option>
            ))}
          </select>
        ) : (
          <select className="mt-3 w-full rounded-md border bg-background p-2 text-sm" onChange={(event) => setKind(event.target.value)} value={kind}>
            {relationTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.labelZh}（{type.id}）
              </option>
            ))}
          </select>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => setPromoting(null)} type="button">取消</button>
          <button
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            onClick={() => {
              if (!promotingId) return;
              void (isNote ? promote(promotingId, { kind }) : promote(promotingId, { relationType: kind }));
            }}
            type="button"
          >
            Promote
          </button>
        </div>
      </div>
    </div>
  );
}
