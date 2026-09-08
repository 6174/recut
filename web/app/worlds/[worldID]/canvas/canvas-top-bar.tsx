/*
 * [INPUT]: 依赖 canvas-store（context/worldName/readOnly/notice/relating 状态与 setContext/setCreating/addNote 动作）与 lucide-react
 * [OUTPUT]: 对外提供 useWorldCanvasTopBarStore（画布激活时向全局 Header 注册自己）与 WorldCanvasTopBar：
 * 世界画布工具栏（返回设定视图 / 上下文面包屑 / +实体 / +便签 / 关系引导与 notice），
 * 由 Workspace 顶层 Header 左侧空间渲染（全局导航保留，用 | 分隔全局与 world 局部操作）
 * [POS]: worlds/[worldID]/canvas 的顶层工具栏；替代 canvas-pomelo 内嵌的 CanvasTopPanel 覆盖层
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowLeft, Box, ChevronLeft, Globe2, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { create } from "zustand";
import { useWorldCanvasStore } from "./canvas-store";

type WorldCanvasTopBarState = {
  active: boolean;
  onClose: (() => void) | null;
  setActive: (active: boolean, onClose?: (() => void) | null) => void;
};

export const useWorldCanvasTopBarStore = create<WorldCanvasTopBarState>((set) => ({
  active: false,
  onClose: null,
  setActive: (active, onClose = null) => set({ active, onClose }),
}));

export function WorldCanvasTopBar() {
  const router = useRouter();
  const context = useWorldCanvasStore((state) => state.context);
  const worldName = useWorldCanvasStore((state) => state.worldName);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const notice = useWorldCanvasStore((state) => state.notice);
  const relatingFrom = useWorldCanvasStore((state) => state.relatingFrom);
  const relatingTo = useWorldCanvasStore((state) => state.relatingTo);
  const setContext = useWorldCanvasStore((state) => state.setContext);
  const setCreating = useWorldCanvasStore((state) => state.setCreating);
  return (
    <div className="flex h-11 min-w-0 items-center gap-2 text-sm">
      <button
        aria-label="返回 Worlds 列表"
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => router.push("/worlds")}
        type="button"
      >
        <ArrowLeft className="size-4" />
      </button>
      {context ? (
        <>
          <button className="flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted" onClick={() => setContext(null)} type="button">
            <ChevronLeft className="size-3" /> 全局画布
          </button>
          <span className="flex min-w-0 items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground">
            <Box className="size-3 shrink-0" />
            <span className="truncate">{context.title}</span>
          </span>
        </>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 font-semibold">
          <Globe2 aria-hidden className="size-4 shrink-0 text-primary" />
          <span className="truncate">{worldName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">· 世界画布</span>
        </span>
      )}
      {!readOnly && (
        <span className="flex shrink-0 items-center gap-1.5">
          <button className="flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted" onClick={() => setCreating(true)} type="button">
            <Plus className="size-3" /> 实体
          </button>
          <button className="flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted" onClick={() => void useWorldCanvasStore.getState().addNote()} type="button">
            <Pencil className="size-3" /> 便签
          </button>
        </span>
      )}
      {relatingFrom && !relatingTo && <span className="shrink-0 text-xs text-primary">已选起点：点击目标实体建立关系</span>}
      {notice && <span className="truncate text-xs text-warning">{notice}</span>}
    </div>
  );
}

// 画布右上角的「设定视图」切换（渲染在全局 Header 右侧、HeaderActions 之前），点击退回世界设定表单。
export function WorldCanvasShareButton() {
  const onClose = useWorldCanvasTopBarStore((state) => state.onClose);
  if (!onClose) return null;
  return (
    <button className="flex h-7 items-center gap-1.5 rounded-md border bg-card px-2.5 text-xs font-medium hover:bg-muted" onClick={onClose} type="button">
      <Globe2 aria-hidden className="size-3.5" /> 设定视图
    </button>
  );
}
