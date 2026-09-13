/*
 * [INPUT]: 依赖 canvas-store（context/worldName/notice/relating 状态与 setContext 动作）、
 * canvas-toolbar（CanvasToolbarItems 工具组）与 lucide-react
 * [OUTPUT]: 对外提供 useWorldCanvasTopBarStore（画布/设定两种视图都向全局 Header 注册同一条工具栏行，
 * variant 区分）、WorldCanvasTopBar（左侧返回 / 上下文面包屑 / notice）、WorldCanvasToolbar（画布工具组，
 * 由 Workspace 顶层 Header 居中渲染，仅 canvas variant；只读徽标与关系引导随行）与
 * WorldCanvasShareButton（右侧视图切换：canvas→设定视图，form→画布视图），切换按钮位置在两种视图下保持一致
 * [POS]: worlds/[worldID]/canvas 的顶层工具栏；画布工具（模式/连线/插入/undo/缩放）由 CanvasToolbarItems 承载
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { ArrowLeft, Box, ChevronLeft, Globe2, Info, Network } from "lucide-react";
import { useRouter } from "next/navigation";
import { create } from "zustand";
import { useWorldCanvasStore } from "./canvas-store";
import { CanvasToolbarItems } from "./canvas-toolbar";

type WorldCanvasTopBarState = {
  active: boolean;
  // canvas=画布视图（含工具组）；form=设定视图（同一行结构，无画布工具）
  variant: "canvas" | "form";
  onClose: (() => void) | null;
  onOpenCanvas: (() => void) | null;
  setActive: (active: boolean, onClose?: (() => void) | null) => void;
  setFormMode: (active: boolean, onOpenCanvas?: (() => void) | null) => void;
};

export const useWorldCanvasTopBarStore = create<WorldCanvasTopBarState>((set) => ({
  active: false,
  variant: "canvas",
  onClose: null,
  onOpenCanvas: null,
  setActive: (active, onClose = null) =>
    set(active ? { active: true, variant: "canvas", onClose, onOpenCanvas: null } : { active: false, variant: "canvas", onClose: null }),
  // 设定视图注册：只在当前 variant 仍是 form 时才允许关闭（避免覆盖刚挂载的 canvas 注册）
  setFormMode: (active, onOpenCanvas = null) =>
    set((state) => {
      if (!active) return state.variant === "form" ? { active: false, variant: "canvas", onOpenCanvas: null } : {};
      return { active: true, variant: "form", onOpenCanvas, onClose: null };
    }),
}));

export function WorldCanvasTopBar() {
  const router = useRouter();
  const variant = useWorldCanvasTopBarStore((state) => state.variant);
  const context = useWorldCanvasStore((state) => state.context);
  const contextTrail = useWorldCanvasStore((state) => state.contextTrail);
  const worldName = useWorldCanvasStore((state) => state.worldName);
  const notice = useWorldCanvasStore((state) => state.notice);
  const setContext = useWorldCanvasStore((state) => state.setContext);
  const exitContext = useWorldCanvasStore((state) => state.exitContext);
  // 面包屑（B.11/D6 唯一导航真相）：全局画布 ▸ 实体 ▸ …；>3 级折叠「…」，
  // 点任意一级回到该层（截断 trail）
  const collapsed = contextTrail.length > 3;
  const visibleTrail = collapsed ? contextTrail.slice(-2) : contextTrail;
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
      {context && variant === "canvas" ? (
        <nav aria-label="容器导航" className="flex min-w-0 items-center gap-1">
          <button className="flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted" onClick={() => setContext(null)} type="button">
            <ChevronLeft className="size-3" /> 全局画布
          </button>
          {collapsed && <span className="px-0.5 text-xs text-muted-foreground">…</span>}
          {visibleTrail.map((item, index) => {
            const isLast = item.entityId === context.entityId;
            return (
              <span className="flex min-w-0 items-center gap-1" key={item.entityId}>
                <span className="text-xs text-muted-foreground">▸</span>
                {isLast ? (
                  <span className="flex min-w-0 items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground">
                    <Box className="size-3 shrink-0" />
                    <span className="truncate">{item.title}</span>
                  </span>
                ) : (
                  <button className="flex h-7 min-w-0 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted" onClick={() => setContext(item)} type="button">
                    <span className="truncate">{item.title}</span>
                  </button>
                )}
              </span>
            );
          })}
          {contextTrail.length > 1 && (
            <button aria-label="上一层" className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" onClick={exitContext} title="上一层（⌘[）" type="button">
              <ChevronLeft className="size-4" />
            </button>
          )}
        </nav>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 font-semibold">
          <Globe2 aria-hidden className="size-4 shrink-0 text-primary" />
          <span className="truncate">{worldName}</span>
        </span>
      )}
      {notice && variant === "canvas" && <span className="truncate text-xs text-warning">{notice}</span>}
      {/* 属性面板开关（T17 重构）：空选 = 全局上下文属性（名称/简介/Skill），选中 = 实体/关系/元素详情 */}
      {variant === "canvas" && <PanelToggleButton />}
    </div>
  );
}

// 画布工具组（居中于全局 Header）：与左侧面包屑/notice、右侧全局操作解耦；
// 只读徽标与关系引导随工具组同行居中，仅 canvas variant 显示。
export function WorldCanvasToolbar() {
  const active = useWorldCanvasTopBarStore((state) => state.active);
  const variant = useWorldCanvasTopBarStore((state) => state.variant);
  const readOnly = useWorldCanvasStore((state) => state.readOnly);
  const relatingFrom = useWorldCanvasStore((state) => state.relatingFrom);
  const relatingTo = useWorldCanvasStore((state) => state.relatingTo);
  if (!active || variant !== "canvas") return null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      {readOnly && <span className="shrink-0 rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">只读</span>}
      <CanvasToolbarItems />
      {relatingFrom && !relatingTo && <span className="shrink-0 text-xs text-primary">已选起点：点击目标实体建立关系</span>}
    </div>
  );
}

function PanelToggleButton() {
  const panelOpen = useWorldCanvasStore((state) => state.panelOpen);
  const setPanelOpen = useWorldCanvasStore((state) => state.setPanelOpen);
  return (
    <button
      aria-label={panelOpen ? "收起属性面板" : "打开属性面板"}
      title={panelOpen ? "收起属性面板" : "属性面板（空选 = 世界属性）"}
      aria-pressed={panelOpen}
      className={`grid size-7 shrink-0 place-items-center rounded-md hover:bg-muted ${panelOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
      onClick={() => setPanelOpen(!panelOpen)}
      type="button"
    >
      <Info className="size-4" />
    </button>
  );
}

// 全局 Header 右侧的视图切换（HeaderActions 之前）：
// 画布视图 → 「设定视图」（退回设定表单）；设定视图 → 「画布视图」（进入画布）。位置保持一致。
export function WorldCanvasShareButton() {
  const variant = useWorldCanvasTopBarStore((state) => state.variant);
  const onClose = useWorldCanvasTopBarStore((state) => state.onClose);
  const onOpenCanvas = useWorldCanvasTopBarStore((state) => state.onOpenCanvas);
  if (variant === "canvas" && onClose) {
    return (
      <button className="flex h-7 items-center gap-1.5 rounded-md border bg-card px-2.5 text-xs font-medium hover:bg-muted" onClick={onClose} type="button">
        <Globe2 aria-hidden className="size-3.5" /> 设定视图
      </button>
    );
  }
  if (variant === "form" && onOpenCanvas) {
    return (
      <button className="flex h-7 items-center gap-1.5 rounded-md border bg-card px-2.5 text-xs font-medium hover:bg-muted" onClick={onOpenCanvas} type="button">
        <Network aria-hidden className="size-3.5" /> 画布视图
      </button>
    );
  }
  return null;
}
