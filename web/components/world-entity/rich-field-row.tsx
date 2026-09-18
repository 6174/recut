/*
 * [INPUT]: 依赖 RichComposer、createPortal、stripRefs/contextProtocolRegistry、field-row（needsClamp）与 i18n
 * [OUTPUT]: 对外提供 RichFieldRow：FieldRow 的富文本版（referencing/field），展示态剥离标签、长文本 line-clamp-4 折叠 +
 * 展开/收起、编辑态 RichComposer，带「放大」全屏富文本编辑（⌘↵ 保存 / Esc 取消），⌘↵ 保存 / Esc 取消
 * [POS]: web/components/world-entity 的复用验证原语（协议 RFC §4.5/§8.2）；只把 value.text 存回实体字段，不产生 contexts
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Maximize2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RichComposer } from "@/components/rich-composer/rich-composer";
import type { ContextOption } from "@/lib/context-catalog/types";
import { contextProtocolRegistry } from "@/lib/context-catalog/registry";
import { referenceDisplayText } from "@/lib/rich-composer/protocol/parse";
import type { RichComposerValue } from "@/lib/rich-composer/value";
import { needsClamp } from "./field-row";

export function RichFieldRow({
  label,
  value,
  placeholder,
  minRows,
  pinnedOptions,
  readOnly,
  apiBase,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  minRows?: number;
  pinnedOptions?: ContextOption[];
  readOnly?: boolean;
  apiBase: string;
  onSave: (value: string) => Promise<void> | void;
}) {
  const registry = useMemo(() => contextProtocolRegistry(), []);
  const [editing, setEditing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<RichComposerValue>(() => ({ text: value, refs: [], isEmpty: !value }));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const initialRef = useRef(value);

  useEffect(() => {
    if (!editing) setDraft({ text: value, refs: [], isEmpty: !value });
    initialRef.current = value;
  }, [value, editing]);

  const commit = async () => {
    setEditing(false);
    setFullscreen(false);
    if (draft.text === initialRef.current) return;
    setState("saving");
    try {
      await onSave(draft.text);
      setState("saved");
      initialRef.current = draft.text;
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
    }
  };

  const cancel = () => {
    setDraft({ text: initialRef.current, refs: [], isEmpty: !initialRef.current });
    setEditing(false);
    setFullscreen(false);
  };

  const display = referenceDisplayText(value, registry).trim();
  const clamped = needsClamp(display) && !expanded;
  const clampable = needsClamp(display);

  if (readOnly) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
          {clampable && (
            <button className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setExpanded(!expanded)} type="button">
              {expanded ? "收起" : "展开"}
            </button>
          )}
        </div>
        <p className={`mt-0.5 break-words whitespace-pre-wrap text-sm leading-6 ${clamped ? "line-clamp-4 text-muted-foreground/80" : expanded ? "max-h-[48vh] overflow-y-auto" : ""}`}>{display || "—"}</p>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="group/field">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
          <span className="flex shrink-0 gap-2">
            {clampable && (
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
          className={`mt-0.5 w-full break-words whitespace-pre-wrap rounded px-1 py-0.5 text-left text-sm leading-6 hover:bg-muted/60 ${display ? "" : "text-muted-foreground/60"} ${clamped ? "line-clamp-4" : expanded ? "max-h-[48vh] overflow-y-auto" : ""}`}
          onClick={() => setEditing(true)}
          title={clampable ? "点击编辑（放大编辑可看全文）" : undefined}
          type="button"
        >
          {display || (placeholder ?? "点击填写")}
        </button>
        {state === "saved" && <p className="text-[10px] text-primary">已保存</p>}
        {state === "saving" && <p className="text-[10px] text-muted-foreground">保存中…</p>}
        {state === "error" && <p className="text-[10px] text-destructive">保存失败，请重试</p>}
      </div>
    );
  }

  return (
    <div
      onKeyDownCapture={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <span className="flex gap-2">
          <button aria-label={`放大编辑${label}`} className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setFullscreen(true)} title="放大编辑" type="button">
            <Maximize2 className="size-3" /> 放大
          </button>
          <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={cancel} type="button">
            取消
          </button>
          <button className="text-[10px] text-primary hover:underline" onClick={() => void commit()} type="button">
            保存
          </button>
        </span>
      </div>
      <div className="mt-1 rounded-md border bg-background p-2 focus-within:border-primary">
        <RichComposer
          apiBase={apiBase}
          autoFocus
          maxRows={10}
          minRows={minRows}
          mode="referencing"
          onChange={setDraft}
          pinnedOptions={pinnedOptions}
          placeholder={placeholder}
          value={draft}
          variant="field"
        />
      </div>
      <p className="mt-0.5 text-[10px] text-muted-foreground">⌘↵ 保存 · Esc 取消 · 输入 @ 引用实体</p>
      {fullscreen && (
        <RichFullscreenEditor
          apiBase={apiBase}
          label={label}
          onCancel={cancel}
          onCommit={() => void commit()}
          onDraft={setDraft}
          pinnedOptions={pinnedOptions}
          placeholder={placeholder}
          value={draft}
        />
      )}
    </div>
  );
}

// RichFullscreenEditor：与 FieldRow 的 FullscreenTextEditor 同入口，但正文为 RichComposer（可 @ 引用实体）。
export function RichFullscreenEditor({
  label,
  value,
  placeholder,
  pinnedOptions,
  apiBase,
  onDraft,
  onCommit,
  onCancel,
}: {
  label: string;
  value: RichComposerValue;
  placeholder?: string;
  pinnedOptions?: ContextOption[];
  apiBase: string;
  onDraft: (value: RichComposerValue) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return createPortal(
    <div aria-modal="true" className="fixed inset-0 z-[80] grid place-items-center bg-foreground/40 p-6 backdrop-blur-[1px]" onMouseDown={onCancel} role="dialog">
      <section className="flex h-[80vh] w-full max-w-3xl flex-col rounded-xl border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
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
        <div
          className="min-h-0 flex-1 overflow-y-auto p-4"
          onKeyDownCapture={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onCommit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        >
          <RichComposer
            apiBase={apiBase}
            autoFocus
            minRows={12}
            mode="referencing"
            onChange={onDraft}
            pinnedOptions={pinnedOptions}
            placeholder={placeholder ?? "输入内容，@ 引用实体"}
            value={value}
            variant="field"
          />
        </div>
        <footer className="shrink-0 border-t px-4 py-1.5 text-[10px] text-muted-foreground">⌘↵ 保存 · Esc 取消 · 输入 @ 引用实体</footer>
      </section>
    </div>,
    document.body,
  );
}
