/*
 * [INPUT]: 依赖 react 与 demo-store（模式/写动作）
 * [OUTPUT]: 对外提供 Toolbar：demo 画布顶部工具栏——实体新建（按 kind）、便签、连线模式切换、
 * undo/redo、缩放与内容居中（loomic 交互结构锚定：工具栏常驻顶部覆盖层）
 * [POS]: lib/pomelo/world-canvas 的顶部工具栏（index.tsx 组合）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import type { RefObject } from "react";
import type { PomeloEditor } from "../pomelo-core/pomelo-editor";
import { useWorldDemoStore, kindLabel } from "./demo-store";
import { MEDIA_META } from "./blocks/media-node-block";

type ToolbarProps = {
  kinds: string[];
  editor: RefObject<PomeloEditor | null>;
  editorReady: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenter: () => void;
};

const kindColors: Record<string, string> = {
  character: "#e879f9",
  location: "#60a5fa",
  story: "#f59e0b",
  style: "#34d399",
  rule: "#a78bfa",
  reference: "#94a3b8",
};

export function Toolbar({ kinds, editor, editorReady, onZoomIn, onZoomOut, onCenter }: ToolbarProps) {
  const mode = useWorldDemoStore((state) => state.mode);
  const setMode = useWorldDemoStore((state) => state.setMode);
  const addEntity = useWorldDemoStore((state) => state.addEntity);
  const addNote = useWorldDemoStore((state) => state.addNote);
  const addMediaNode = useWorldDemoStore((state) => state.addMediaNode);
  const worldName = useWorldDemoStore((state) => state.worldName);
  const setNotice = useWorldDemoStore((state) => state.setNotice);

  const undo = () => {
    if (!editor.current) return;
    editor.current.state.undo();
    setNotice("undo：结构变化由 renderer 增量应用（demo 未触发 store 重建）");
  };
  const redo = () => {
    if (!editor.current) return;
    editor.current.state.redo();
  };

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-sm">
      <span className="flex min-w-0 items-center gap-1.5 font-semibold">
        <span className="text-primary">◍</span>
        <span className="truncate">{worldName}</span>
        <span className="shrink-0 text-xs font-normal text-muted-foreground">· pomelo 画布 demo</span>
      </span>
      <span className="mx-2 h-5 w-px bg-border" />
      <span className="flex shrink-0 items-center gap-1">
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            className="flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs hover:bg-muted"
            onClick={() => addEntity(kind)}
            title={`新建${kindLabel(kind)}`}
          >
            <span className="size-2 rounded-full" style={{ backgroundColor: kindColors[kind] ?? "#94a3b8" }} />
            {kindLabel(kind)}
          </button>
        ))}
        <button className="flex h-7 items-center rounded-md border px-2 text-xs hover:bg-muted" onClick={addNote} type="button">
          便签
        </button>
        {Object.entries(MEDIA_META).map(([media, meta]) => (
          <button
            key={media}
            className="flex h-7 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => addMediaNode(media as Parameters<typeof addMediaNode>[0])}
            type="button"
            title={`新建基础${meta.label}节点`}
          >
            <span>{meta.icon}</span>
            {meta.label}
          </button>
        ))}
      </span>
      <span className="mx-2 h-5 w-px bg-border" />
      <button
        className={`flex h-7 items-center rounded-md border px-2.5 text-xs ${mode === "connect" ? "border-primary bg-primary/15 text-primary" : "hover:bg-muted"}`}
        onClick={() => setMode(mode === "connect" ? "select" : "connect")}
        type="button"
        title="连线模式：从实体卡拖到另一张卡"
      >
        连线
      </button>
      <span className="mx-2 h-5 w-px bg-border" />
      <button className="flex h-7 items-center rounded-md border px-2 text-xs hover:bg-muted disabled:opacity-50" disabled={!editorReady} onClick={undo} type="button">
        撤销
      </button>
      <button className="flex h-7 items-center rounded-md border px-2 text-xs hover:bg-muted disabled:opacity-50" disabled={!editorReady} onClick={redo} type="button">
        重做
      </button>
      <span className="flex-1" />
      <button className="flex h-7 items-center rounded-md border px-2 text-xs hover:bg-muted" onClick={onZoomOut} type="button">
        −
      </button>
      <button className="flex h-7 items-center rounded-md border px-2 text-xs hover:bg-muted" onClick={onZoomIn} type="button">
        ＋
      </button>
      <button className="flex h-7 items-center rounded-md border px-2 text-xs hover:bg-muted" onClick={onCenter} type="button">
        居中
      </button>
    </div>
  );
}
