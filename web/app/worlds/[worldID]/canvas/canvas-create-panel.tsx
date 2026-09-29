// File: web/app/worlds/[worldID]/canvas/canvas-create-panel.tsx (tsx)
/*
 * [INPUT]: 依赖 react、lucide-react（Search）
 * [OUTPUT]: 对外提供创建类面板共用外壳 CreatePanel（顶部可选标题 + 搜索框，左侧分组列表，右侧 hover/高亮详情
 * 预览 + 「创建」按钮，键盘 ↑↓/Enter/Esc），以及 CreateItem / CreateGroup / CreatePreview 类型与
 * CREATE_PANEL_W / CREATE_PANEL_H 尺寸常量
 * [POS]: worlds/[worldID]/canvas 的创建类弹层共用结构层——创建菜单（canvas-create-menu.tsx）与
 * 「+」生成引导面板（canvas-pomelo.tsx AttrCreatorPanel）共用同一套交互结构，避免多套交互模式；
 * 锚点 = 调用方给的屏幕坐标（缺省视口居中），点击面板外部关闭
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Search } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

// 面板尺寸（用于锚点夹取；与 JSX 里的 w/h 保持一致）
export const CREATE_PANEL_W = 600;
export const CREATE_PANEL_H = 460;

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
  hint?: string;
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
        .map((group) => ({ ...group, items: group.items.filter((item) => `${item.label} ${item.hint ?? ""}`.toLowerCase().includes(needle)) }))
        .filter((group) => group.items.length > 0)
    : groups;
  const flatItems = visibleGroups.flatMap((group) => group.items);
  const activeItem = flatItems.find((item) => item.key === activeKey) ?? flatItems[0] ?? null;

  const moveHighlight = (delta: number) => {
    if (flatItems.length === 0) return;
    const currentIndex = Math.max(0, flatItems.findIndex((item) => item.key === activeItem?.key));
    const nextIndex = Math.max(0, Math.min(flatItems.length - 1, currentIndex + delta));
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
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
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
        className="absolute flex h-[min(460px,calc(100vh-5rem))] w-[min(600px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-popover text-sm text-popover-foreground shadow-[var(--shadow-overlay)]"
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
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
          <div className="min-h-0 overflow-y-auto border-r p-1.5" ref={listRef} role="listbox">
            {visibleGroups.length === 0 ? (
              <p className="px-3 py-8 text-center text-[11px] text-muted-foreground">没有匹配的项</p>
            ) : (
              visibleGroups.map((group) => (
                <div key={group.key} role="group">
                  <p className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</p>
                  {group.items.map((item) => (
                    <button
                      aria-selected={activeItem?.key === item.key}
                      className={`flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left ${activeItem?.key === item.key ? "bg-accent" : "hover:bg-muted"}`}
                      data-create-key={item.key}
                      key={item.key}
                      onClick={item.run}
                      onFocus={() => setActiveKey(item.key)}
                      onMouseEnter={() => setActiveKey(item.key)}
                      role="option"
                      type="button"
                    >
                      <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-sm border bg-background text-xs">
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{item.label}</span>
                        {item.hint && <span className="block truncate text-[10px] text-muted-foreground">{item.hint}</span>}
                      </span>
                    </button>
                  ))}
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
