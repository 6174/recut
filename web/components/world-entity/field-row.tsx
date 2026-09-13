/*
 * [INPUT]: 依赖 react、lucide-react、recut-worlds-client 类型、asset-preview-dialog、asset-reference-picker
 * [OUTPUT]: 共享实体编辑原语（RFC 统一 Entity 模型 P1，供画布 EntityPanel 与设定视图 EntitySettingsPanel 复用）：
 * FieldRow（单行/多行/开关字段就地编辑，blur 或 ⌘↵ 保存；展示态长文本 line-clamp-4 折叠 + 展开/收起；
 * 编辑态多行限高 + 放大全屏编辑器 FullscreenTextEditor）、AssetFieldRow（type=media 素材字段：槽位 +
 * 全局素材选择浮层 + 点击已填素材走 AssetPreviewDialog，值统一存 {assetId,name,kind}）、
 * parseAssetValue / typeLabelOf（type 目录 name → 统一类型文案）；FullscreenTextEditor 亦供画布就地编辑器复用
 * [POS]: web/components/world-entity 的字段级编辑原语（保存策略：单行 blur 即存、多行三通道）；
 * 不依赖任何 store，宿主以 apiBase / onSave 注入数据面
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Maximize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AssetPreviewDialog, type PreviewAsset } from "@/components/asset-preview-dialog";
import { AssetReferenceDialog, type MediaPickerKind } from "@/components/asset-reference-picker";
import { entityKindLabel, type WorldEntity, type WorldEntitySummary } from "@/lib/recut-worlds-client";

// 素材字段的值：统一存 {assetId, name, kind}，kind 驱动缩略图与预览弹框
export type AssetValue = { assetId: string; name?: string; kind?: "image" | "video" | "audio" };

// 长文本展示钳制（3）：超过该长度/行数默认折叠，避免长文本吃掉面板高度
const CLAMP_CHARS = 140;
const CLAMP_LINES = 4;

function needsClamp(value: string): boolean {
  return value.length > CLAMP_CHARS || value.split("\n").length > CLAMP_LINES;
}

export function parseAssetValue(value: unknown): AssetValue | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const assetId = typeof record.assetId === "string" ? record.assetId : "";
  if (!assetId) return null;
  const kind = record.kind === "video" || record.kind === "audio" ? record.kind : "image";
  return { assetId, name: typeof record.name === "string" ? record.name : undefined, kind };
}

// 类型标签：type 目录的 name 优先（B.2 用户语言），目录缺失回退静态 label
export function typeLabelOf(entity: Pick<WorldEntitySummary, "typeId">, entityTypes: { id: string; name: string }[]): string {
  return entityTypes.find((item) => item.id === entity.typeId)?.name ?? entityKindLabel(entity.typeId);
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
  const [fullscreen, setFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
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
    setFullscreen(false);
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

  const cancel = () => {
    setDraft(initialRef.current);
    setEditing(false);
    setFullscreen(false);
  };

  // blur 分流：焦点移到本字段行内的其他控件（如「放大」按钮）时不提交；全屏编辑器打开期间
  // 行内 textarea 的失焦也忽略（它的 autoFocus 会反复触发行内 blur）
  const blurGuard = (event: React.FocusEvent) => {
    if (fullscreen) return;
    if (event.relatedTarget instanceof Node && event.currentTarget.parentElement?.contains(event.relatedTarget)) return;
    void commit();
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

  const clamped = needsClamp(value) && !expanded;
  if (readOnly) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
          {needsClamp(value) && (
            <button className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setExpanded(!expanded)} type="button">
              {expanded ? "收起" : "展开"}
            </button>
          )}
        </div>
        <p className={`mt-0.5 break-words whitespace-pre-wrap text-sm leading-6 ${clamped ? "line-clamp-4 text-muted-foreground/80" : needsClamp(value) ? "max-h-[48vh] overflow-y-auto" : ""}`}>{value || "—"}</p>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="group/field">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
          <span className="flex shrink-0 gap-2">
            {needsClamp(value) && (
              <button className="text-[10px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/field:opacity-100" onClick={() => setExpanded(!expanded)} type="button">
                {expanded ? "收起" : "展开"}
              </button>
            )}
            <button
              aria-label={`编辑${label}`}
              className="text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover/field:opacity-100"
              onClick={() => setEditing(true)}
              type="button"
            >
              ✎
            </button>
          </span>
        </div>
        <button
          className={`mt-0.5 w-full break-words whitespace-pre-wrap rounded px-1 py-0.5 text-left text-sm leading-6 hover:bg-muted/60 ${value ? "" : "text-muted-foreground/60"} ${clamped ? "line-clamp-4" : `${expanded ? "max-h-[48vh] overflow-y-auto" : ""} block`}`}
          onClick={() => setEditing(true)}
          type="button"
          title={needsClamp(value) ? "点击编辑（放大编辑可看全文）" : undefined}
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
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <button aria-label={`放大编辑${label}`} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setFullscreen(true)} title="放大编辑" type="button">
          <Maximize2 className="size-3" /> 放大
        </button>
      </div>
      <textarea
        autoFocus
        className="mt-1 h-28 max-h-44 w-full resize-none overflow-y-auto rounded-md border bg-background p-2 text-xs leading-5 outline-none focus:border-primary"
        onBlur={blurGuard}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        placeholder={placeholder}
        value={draft}
      />
      <p className="mt-0.5 text-[10px] text-muted-foreground">⌘↵ 保存 · Esc 取消</p>
      {fullscreen && <FullscreenTextEditor label={label} draft={draft} onDraft={setDraft} onCommit={commit} onCancel={cancel} />}
    </div>
  ) : (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <input
        autoFocus
        className="mt-1 w-full rounded-md border bg-background p-1.5 text-sm outline-none focus:border-primary"
        onBlur={blurGuard}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void commit();
          else if (event.key === "Escape") cancel();
        }}
        placeholder={placeholder}
        value={draft}
      />
    </div>
  );
}

// 放大编辑（2）：全屏对话框，长文本/复杂 markdown 的主编辑场；⌘↵ 保存并关闭。
// 画布就地编辑器复用同一组件，保证「画布内编辑 = 属性面板编辑」的一致体验。
export function FullscreenTextEditor({ label, draft, onDraft, onCommit, onCancel }: { label: string; draft: string; onDraft: (value: string) => void; onCommit: () => void; onCancel: () => void }) {
  return createPortal(
    <div aria-modal="true" className="fixed inset-0 z-[80] grid place-items-center bg-foreground/40 p-6 backdrop-blur-[1px]" onMouseDown={onCancel} role="dialog">
      <section
        className="flex h-[80vh] w-full max-w-3xl flex-col rounded-xl border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">{label} · 放大编辑</p>
          <div className="flex gap-2">
            <button className="rounded-md border px-3 py-1 text-xs hover:bg-muted" onClick={onCancel} type="button">
              取消
            </button>
            <button className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90" onClick={onCommit} type="button">
              保存（⌘↵）
            </button>
          </div>
        </header>
        <textarea
          autoFocus
          className="min-h-0 w-full flex-1 resize-none bg-background p-4 text-sm leading-6 outline-none"
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onCommit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          placeholder={draft ? undefined : "输入内容…"}
          value={draft}
        />
        <footer className="shrink-0 border-t px-4 py-1.5 text-[10px] text-muted-foreground">⌘↵ 保存 · Esc 取消 · 原文完整保留</footer>
      </section>
    </div>,
    document.body,
  );
}

// 素材字段（type=media）：槽位展示缩略图；点击已填素材 → 全局统一素材弹框（AssetPreviewDialog）；
// 空/更换 → 全局素材选择浮层（AssetReferenceDialog），按 options 限定图片/视频/音频
export function AssetFieldRow({
  apiBase,
  label,
  value,
  kinds,
  readOnly,
  onSave,
}: {
  apiBase: string;
  label: string;
  value: unknown;
  kinds?: ("image" | "video" | "audio")[];
  readOnly?: boolean;
  onSave: (value: unknown) => Promise<void> | void;
}) {
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
