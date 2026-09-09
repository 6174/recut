/*
 * [INPUT]: 依赖 react、canvas-store（saveEntityField 动作）、lucide-react
 * [OUTPUT]: 对外提供 FieldRow（单行/多行/开关字段就地编辑：blur 或 ⌘↵ 保存，行内「已保存」轻提示）、
 * AssetFieldRow（type=media 素材字段：槽位 + 全局素材选择浮层选填 + 点击已填素材走全局素材弹框 AssetPreviewDialog，
 * content 统一存 {assetId,name,kind}）、parseAssetValue 与 typeLabelOf（type 目录 name → 面板/卡片统一类型文案，目录缺失回退 entityKindLabels）
 * [POS]: worlds/[worldID]/canvas/panel 的共享编辑原语（B.8 保存策略：单行 blur 即存、多行三通道）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { AssetPreviewDialog, type PreviewAsset } from "@/components/asset-preview-dialog";
import { AssetReferenceDialog, type MediaPickerKind } from "@/components/asset-reference-picker";
import type { WorldEntity } from "@/lib/recut-worlds-client";
import { entityKindLabels } from "@/lib/recut-worlds-client";
import { useWorldCanvasStore } from "../canvas-store";

// 素材字段的 content 值：统一存 {assetId, name, kind}，kind 驱动缩略图与预览弹框
export type AssetValue = { assetId: string; name?: string; kind?: "image" | "video" | "audio" };

export function parseAssetValue(value: unknown): AssetValue | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const assetId = typeof record.assetId === "string" ? record.assetId : "";
  if (!assetId) return null;
  const kind = record.kind === "video" || record.kind === "audio" ? record.kind : "image";
  return { assetId, name: typeof record.name === "string" ? record.name : undefined, kind };
}

// 类型标签：type 目录的 name 优先（B.2 用户语言），目录缺失回退静态 label
export function typeLabelOf(entity: Pick<WorldEntity, "kind">, entityTypes: { id: string; name: string }[]): string {
  return entityTypes.find((item) => item.id === entity.kind)?.name ?? entityKindLabels[entity.kind as keyof typeof entityKindLabels] ?? entity.kind;
}

export function FieldRow({
  label,
  value,
  placeholder,
  multiline,
  boolean,
  readOnly,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  boolean?: boolean;
  readOnly?: boolean;
  onSave: (value: string | boolean) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const initialRef = useRef(value);

  // 外部数据变化（如实体被服务端合并回来）同步进草稿
  useEffect(() => {
    if (!editing) setDraft(value);
    initialRef.current = value;
  }, [value, editing]);

  const commit = async () => {
    setEditing(false);
    if (draft === initialRef.current) return;
    setState("saving");
    try {
      await onSave(draft);
      setState("saved");
      initialRef.current = draft;
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
    }
  };

  if (boolean) {
    const on = value === "true";
    if (readOnly) {
      return (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-sm">{on ? "是" : "否"}</p>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <button
          aria-label={`切换${label}`}
          aria-pressed={on}
          className={`relative h-5 w-9 rounded-full border transition-colors ${on ? "border-primary bg-primary" : "bg-muted"}`}
          onClick={() => void onSave(!on)}
          type="button"
        >
          <span className={`absolute top-0.5 size-3.5 rounded-full bg-background transition-transform ${on ? "translate-x-4.5" : "translate-x-0.5"}`} />
        </button>
      </div>
    );
  }

  if (readOnly) {
    return (
      <div>
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-6">{value || "—"}</p>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="group/field">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
          <button
            aria-label={`编辑${label}`}
            className="text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover/field:opacity-100"
            onClick={() => setEditing(true)}
            type="button"
          >
            ✎
          </button>
        </div>
        <button
          className={`mt-0.5 block w-full whitespace-pre-wrap break-words rounded px-1 py-0.5 text-left text-sm leading-6 ${value ? "" : "text-muted-foreground/60"} hover:bg-muted/60`}
          onClick={() => setEditing(true)}
          type="button"
        >
          {value || (placeholder ?? "点击填写")}
        </button>
        {state === "saved" && <p className="text-[10px] text-primary">已保存</p>}
        {state === "saving" && <p className="text-[10px] text-muted-foreground">保存中…</p>}
        {state === "error" && <p className="text-[10px] text-destructive">保存失败，请重试</p>}
      </div>
    );
  }

  return multiline ? (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <textarea
        autoFocus
        className="mt-1 min-h-16 w-full resize-y rounded-md border bg-background p-2 text-xs leading-5 outline-none focus:border-primary"
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(initialRef.current);
            setEditing(false);
          }
        }}
        placeholder={placeholder}
        value={draft}
      />
      <p className="mt-0.5 text-[10px] text-muted-foreground">⌘↵ 保存 · Esc 取消</p>
    </div>
  ) : (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <input
        autoFocus
        className="mt-1 w-full rounded-md border bg-background p-1.5 text-sm outline-none focus:border-primary"
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void commit();
          else if (event.key === "Escape") {
            setDraft(initialRef.current);
            setEditing(false);
          }
        }}
        placeholder={placeholder}
        value={draft}
      />
    </div>
  );
}

// 面板字段保存的统一入口：一次 contentPatch 写库（store 负责冲突重试与自动确认）
export function useEntityFieldSaver() {
  const saveEntityField = useWorldCanvasStore((state) => state.saveEntityField);
  return (entity: WorldEntity, key: string) => (value: unknown) =>
    saveEntityField(entity, { contentPatch: { [key]: value } });
}

// 素材字段（type=media）：槽位展示缩略图；点击已填素材 → 全局统一素材弹框（AssetPreviewDialog）；
// 空/更换 → 全局素材选择浮层（AssetReferenceDialog），按 schema options 限定图片/视频/音频
export function AssetFieldRow({
  label,
  value,
  kinds,
  readOnly,
  onSave,
}: {
  label: string;
  value: unknown;
  kinds?: ("image" | "video" | "audio")[];
  readOnly?: boolean;
  onSave: (value: unknown) => Promise<void> | void;
}) {
  const apiBase = useWorldCanvasStore((state) => state.apiBase);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const asset = parseAssetValue(value);
  const source = asset ? `${apiBase}/v1/media/assets/${encodeURIComponent(asset.assetId)}/content` : "";
  const preview: PreviewAsset | null = asset
    ? {
        id: asset.assetId,
        kind: asset.kind ?? "image",
        name: asset.name ?? label,
        origin: "素材库",
        status: "completed",
        createdAt: "",
        updatedAt: "",
        metadata: {},
      }
    : null;
  const save = (assetId: string, name: string, kind: AssetValue["kind"]) => {
    void onSave({ assetId, name, kind });
    setPickerOpen(false);
  };
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        {asset && !readOnly && (
          <span className="flex gap-1">
            <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setPickerOpen(true)} type="button">更换</button>
            <button className="text-[10px] text-muted-foreground hover:text-destructive" onClick={() => void onSave(null)} type="button">清除</button>
          </span>
        )}
      </div>
      {asset ? (
        <button className="group relative mt-1 block h-20 w-full overflow-hidden rounded-md border" onClick={() => setPreviewOpen(true)} title={`${asset.name ?? label} · 点击查看详情`} type="button">
          {asset.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={asset.name ?? label} className="h-20 w-full object-cover" src={source} />
          ) : (
            <span className="grid h-20 w-full place-items-center bg-muted text-lg">{asset.kind === "video" ? "🎬" : "🎵"}</span>
          )}
        </button>
      ) : readOnly ? (
        <p className="mt-0.5 text-sm text-muted-foreground">—</p>
      ) : (
        <button className="mt-1 grid h-14 w-full place-items-center rounded-md border border-dashed text-[11px] text-muted-foreground hover:border-primary hover:text-foreground" onClick={() => setPickerOpen(true)} type="button">
          ＋ 选择素材
        </button>
      )}
      <AssetReferenceDialog
        apiBase={apiBase}
        description="选择后会以稳定 assetId 引用到该字段。"
        kinds={kinds?.length ? (kinds as MediaPickerKind[]) : undefined}
        onClose={() => setPickerOpen(false)}
        onPick={(picked) => save(picked.id, picked.name, picked.kind === "video" || picked.kind === "audio" ? picked.kind : "image")}
        open={pickerOpen}
        projectID={null}
        selectedIDs={asset ? [asset.assetId] : []}
        title={`选择「${label}」素材`}
      />
      {preview && previewOpen && <AssetPreviewDialog apiBase={apiBase} asset={preview} onClose={() => setPreviewOpen(false)} />}
    </div>
  );
}
