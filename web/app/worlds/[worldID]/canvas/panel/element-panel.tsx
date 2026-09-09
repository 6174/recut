/*
 * [INPUT]: 依赖 react、canvas-store（promote/removeElement/setPromoting）、lucide-react
 * [OUTPUT]: 对外提供 ElementPanel（B.8 Canvas 元素态）：便签/文本正文就地编辑（T4 面板侧）、
 * 提升为设定 / 提升为语义关系、删除；媒体元素态（预览/挂接）随 T8 扩展
 * [POS]: worlds/[worldID]/canvas/panel 的自由画布元素面板
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useWorldCanvasStore } from "../canvas-store";

export function ElementPanel({ fromEntityId, toEntityId }: { fromEntityId?: string; toEntityId?: string }) {
  const element = useWorldCanvasStore((state) => (state.selection?.type === "canvas" ? state.selection.element : null));
  const entities = useWorldCanvasStore((state) => state.entities);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const removeElement = useWorldCanvasStore((state) => state.removeElement);
  const setPromoting = useWorldCanvasStore((state) => state.setPromoting);
  const titleOf = (id?: string) => (id ? entities.find((item) => item.id === id)?.title ?? "…" : "—");
  if (!element) return null;
  const isArrow = element.kind === "arrow";
  const isNote = element.kind === "note";
  const isText = element.kind === "text";
  const connectable = Boolean(fromEntityId && toEntityId && fromEntityId !== toEntityId);
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-[11px] font-medium text-muted-foreground">元素类型</p>
        <p className="mt-0.5 text-sm">{isNote ? "便签" : isText ? "文本" : isArrow ? "箭头（草稿）" : element.kind === "shape" ? "形状" : element.kind}</p>
      </div>
      {(isNote || isText) && <ElementBodyEditor elementId={element.id} initialText={String(element.props?.text ?? "")} />}
      {isArrow && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">连接</p>
          <p className="mt-0.5 text-sm">
            {titleOf(fromEntityId)} → {titleOf(toEntityId)}
          </p>
        </div>
      )}
      {isArrow && connectable && (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
          该箭头连接两个实体。提升后将写入语义关系（产出 revision），画布草稿保留为投影。
        </p>
      )}
      {!readOnly && (
        <div className="space-y-2">
          {isNote && (
            <button
              className="flex h-8 w-full items-center justify-center rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => setPromoting(element.id)}
              type="button"
            >
              ↑ 提升为设定…
            </button>
          )}
          {isArrow && connectable && (
            <button
              className="flex h-8 w-full items-center justify-center rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => setPromoting(element.id)}
              type="button"
            >
              ↑ 提升为语义关系…
            </button>
          )}
          <button
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-destructive/40 text-xs text-destructive hover:bg-destructive/10"
            onClick={() => void removeElement(element.id)}
            type="button"
          >
            <Trash2 className="size-3.5" /> 删除
          </button>
        </div>
      )}
    </div>
  );
}

// 便签/文本正文编辑（T4 面板侧）：与画布就地编辑同一保存通道（persistGeometry props.text）
function ElementBodyEditor({ elementId, initialText }: { elementId: string; initialText: string }) {
  const [value, setValue] = useState(initialText);
  const [saved, setSaved] = useState(false);
  const save = () => {
    if (value === initialText) return;
    void useWorldCanvasStore
      .getState()
      .persistGeometry(elementId, undefined, { text: value })
      .then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      });
  };
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground">内容</p>
      <textarea
        className="mt-1 min-h-20 w-full resize-y rounded-md border bg-background p-2 text-xs leading-5 outline-none focus:border-primary"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            save();
          }
        }}
        value={value}
      />
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">⌘↵ 保存</span>
        {saved ? (
          <span className="text-[10px] text-primary">已保存</span>
        ) : (
          <button className="rounded-md border px-2 py-0.5 text-[10px] hover:bg-muted" onClick={save} type="button">
            保存
          </button>
        )}
      </div>
    </div>
  );
}
