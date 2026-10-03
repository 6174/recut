// File: web/app/worlds/[worldID]/canvas/canvas-create-panel.tsx (tsx)
/*
 * [INPUT]: 依赖 react、lucide-react（Search）
 * [OUTPUT]: 对外提供创建类面板共用外壳 CreatePanel（顶部可选标题 + 搜索框，左侧**分组卡片网格**——少量
 * 粗分组标题 + 紧凑卡片，卡片右上角 badge 角标区分类别；右侧 hover/高亮详情预览 + 「创建」按钮，
 * 键盘 ↑↓←→/Enter/Esc），以及 CreateItem / CreateGroup / CreatePreview 类型与 CREATE_PANEL_W /
 * CREATE_PANEL_H 尺寸常量
 * [POS]: worlds/[worldID]/canvas 的创建类弹层共用结构层——创建菜单（canvas-create-menu.tsx）与
 * 「+」生成引导面板（canvas-pomelo.tsx AttrCreatorPanel）共用同一套交互结构，避免多套交互模式；
 * 锚点 = 调用方给的屏幕坐标（缺省视口居中），点击面板外部关闭
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Search } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

// 面板尺寸（用于锚点夹取；与 JSX 里的 w/h 保持一致）
export const CREATE_PANEL_W = 680;
export const CREATE_PANEL_H = 460;

// 左侧卡片网格列数（键盘 ↑/↓ 按整行移动）
const GRID_COLS = 3;

// 预览 = 右侧详情栏渲染所需的最小数据
export type CreatePreview = {
  icon: string;
  title: string;
  subtitle?: string;
  body?: string;
  facts?: Array<{ label: string; value: string }>;
};

export type CreateItem = {
  key: string;
  label: string;
  icon: string;
  // hint 仅供搜索（不再显示在卡面）
  hint?: string;
  // 卡片右上角类别角标（预设 / 自定义 / 最近 / 元素 …）
  badge?: string;
  preview: CreatePreview;
  run: () => void;
};

export type CreateGroup = { key: string; title: string; items: CreateItem[] };

export function CreatePanel({
  anchor,
  onClose,
  placeholder,
  title,
  groups,
}: {
  anchor: { screenX: number; screenY: number } | null;
  onClose: () => void;
  placeholder: string;
  title?: ReactNode;
  groups: CreateGroup[];
}) {
  const [query, setQuery] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const needle = query.trim().toLowerCase();
  const visibleGroups = needle
    ? groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => `${item.label} ${item.hint ?? ""} ${item.badge ?? ""}`.toLowerCase().includes(needle)),
        }))
        .filter((group) => group.items.length > 0)
    : groups;
  const flatItems = visibleGroups.flatMap((group) => group.items);
  const activeItem = flatItems.find((item) => item.key === activeKey) ?? flatItems[0] ?? null;

  const moveHighlight = (targetIndex: number) => {
    if (flatItems.length === 0) return;
    const nextIndex = Math.max(0, Math.min(flatItems.length - 1, targetIndex));
    const next = flatItems[nextIndex];
    setActiveKey(next.key);
    listRef.current?.querySelector(`[data-create-key="${next.key}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    const currentIndex = Math.max(0, flatItems.findIndex((item) => item.key === activeItem?.key));
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(currentIndex + GRID_COLS);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(currentIndex - GRID_COLS);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveHighlight(currentIndex + 1);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveHighlight(currentIndex - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activeItem?.run();
    }
  };

  const winW = typeof window !== "undefined" ? window.innerWidth : 1280;
  const winH = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = anchor
    ? Math.min(Math.max(16, anchor.screenX), Math.max(16, winW - CREATE_PANEL_W - 16))
    : Math.max(16, winW / 2 - CREATE_PANEL_W / 2);
  const top = anchor
    ? Math.min(Math.max(60, anchor.screenY), Math.max(60, winH - CREATE_PANEL_H - 16))
    : Math.max(60, winH / 2 - CREATE_PANEL_H / 2);

  return (
    <div className="fixed inset-0 z-[70]" onPointerDown={onClose}>
      <div
        className="absolute flex h-[min(460px,calc(100vh-5rem))] w-[min(680px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-popover text-sm text-popover-foreground shadow-[var(--shadow-overlay)]"
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        style={{ left, top }}
      >
        <div className="border-b p-2.5">
          {title && <p className="mb-1.5 truncate px-1 text-[11px] text-muted-foreground">{title}</p>}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              className="h-8 w-full rounded-sm border bg-background pl-8 pr-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              type="search"
              value={query}
            />
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(200px,240px)]">
          <div className="min-h-0 overflow-y-auto border-r p-2.5" ref={listRef} role="listbox">
            {visibleGroups.length === 0 ? (
              <p className="px-3 py-8 text-center text-[11px] text-muted-foreground">没有匹配的项</p>
            ) : (
              visibleGroups.map((group) => (
                <div className="mb-2.5 last:mb-0" key={group.key} role="group">
                  <p className="px-0.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {group.items.map((item) => (
                      <button
                        aria-selected={activeItem?.key === item.key}
                        className={`relative flex w-full flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-center transition-colors ${activeItem?.key === item.key ? "border-primary/50 bg-accent" : "border-border/60 bg-background/40 hover:bg-muted"}`}
                        data-create-key={item.key}
                        key={item.key}
                        onClick={item.run}
                        onFocus={() => setActiveKey(item.key)}
                        onMouseEnter={() => setActiveKey(item.key)}
                        role="option"
                        type="button"
                      >
                        {item.badge && (
                          <span className="absolute right-1 top-0.5 max-w-[calc(100%-0.5rem)] truncate text-[8px] leading-none text-muted-foreground/80">
                            {item.badge}
                          </span>
                        )}
                        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md border bg-background text-sm">
                          {item.icon}
                        </span>
                        <span className="w-full truncate text-[10.5px] font-medium leading-tight">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          <PreviewPane item={activeItem} />
        </div>
      </div>
    </div>
  );
}

function PreviewPane({ item }: { item: CreateItem | null }) {
  if (!item) {
    return <div className="grid h-full place-items-center px-6 text-center text-xs text-muted-foreground">悬停或选择一项查看详情</div>;
  }
  const { preview } = item;
  return (
    <div aria-live="polite" className="flex h-full min-h-0 flex-col overflow-y-auto p-4 text-xs">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-md border bg-background text-lg">
          {preview.icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{preview.title}</p>
          {preview.subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{preview.subtitle}</p>}
        </div>
      </div>
      {preview.body && <p className="mt-3 whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">{preview.body}</p>}
      {preview.facts && preview.facts.length > 0 && (
        <dl className="mt-3 space-y-2">
          {preview.facts.map((fact) => (
            <div className="flex items-start justify-between gap-3" key={fact.label}>
              <dt className="shrink-0 pt-0.5 text-muted-foreground">{fact.label}</dt>
              <dd className="min-w-0 text-right font-medium break-words">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-auto border-t pt-3">
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          onClick={item.run}
          type="button"
        >
          创建
        </button>
      </div>
    </div>
  );
}
