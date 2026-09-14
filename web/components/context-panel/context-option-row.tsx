/*
 * [INPUT]: 依赖 context-catalog/types、ContextSource.icon 与 lucide 图标
 * [OUTPUT]: 对外提供 ContextOptionRow：图标 + 标题 + 副标题 + badge + 已引用勾选；支持禁用态与高亮态
 * [POS]: web/components/context-panel 的单行渲染；纯展示，选择行为由列表容器回传
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Check } from "lucide-react";
import type { ContextOption, ContextSource } from "@/lib/context-catalog/types";

export function ContextOptionRow({
  option,
  source,
  apiBase,
  highlighted,
  onHover,
  onPick,
}: {
  option: ContextOption;
  source: ContextSource | undefined;
  apiBase: string;
  highlighted: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  const attrs = { type: option.subKind ?? "", assetid: option.key.split(":")[1] ?? "", name: option.title };
  return (
    <button
      aria-disabled={option.disabled}
      aria-selected={highlighted}
      className={`flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left ${option.disabled ? "cursor-not-allowed opacity-55" : "hover:bg-muted"} ${highlighted && !option.disabled ? "bg-accent" : ""}`}
      disabled={option.disabled}
      data-context-key={option.key}
      onClick={onPick}
      onMouseEnter={onHover}
      onFocus={onHover}
      role="option"
      type="button"
    >
      <span className="grid size-6 shrink-0 place-items-center rounded-sm border bg-background text-muted-foreground">
        {source?.icon(attrs, { apiBase }) ?? null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{option.title}</span>
        {option.subtitle && <span className="block truncate text-[10px] text-muted-foreground">{option.subtitle}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {option.badges?.map((badge) => (
          <span className="rounded-xs border bg-muted/40 px-1 py-0.5 text-[9px] leading-none text-muted-foreground" key={badge.key}>
            {badge.label ?? badge.key}
          </span>
        ))}
        {option.selected && <Check className="size-3.5 text-primary" />}
      </span>
    </button>
  );
}
