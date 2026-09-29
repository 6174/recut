/*
 * [INPUT]: 依赖 ReactNode 与 lucide-react 的可选图标类型
 * [OUTPUT]: 对外提供 WorkspacePageHeader（工作台一级页面的标题 + 说明 + 可选右侧操作）与 FilterTabs（同款胶囊筛选 tab 行），供项目页与素材页共用
 * [POS]: web/components 的工作台页面骨架原子；统一 Projects / Media 等一级页面的标题层级、宽度与筛选择一视觉，避免各页自造 Header
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function WorkspacePageHeader({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-5">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>
      {action ? (
        <div className="flex shrink-0 items-center gap-3">{action}</div>
      ) : null}
    </div>
  );
}

export function FilterTabs<T extends string>({
  items,
  onChange,
  value,
}: {
  items: { icon?: LucideIcon; id: T; label: string }[];
  onChange: (id: T) => void;
  value: T;
}) {
  return (
    <nav className="mb-5 flex flex-wrap gap-2">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.id === value;
        return (
          <button
            aria-current={active ? "page" : undefined}
            className={`flex h-8 items-center gap-1.5 rounded-xs border px-2.5 text-xs ${active ? "bg-secondary font-medium" : "bg-card text-muted-foreground hover:bg-muted"}`}
            key={item.id}
            onClick={() => onChange(item.id)}
            type="button"
          >
            {Icon ? <Icon className="size-3.5" /> : null}
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
