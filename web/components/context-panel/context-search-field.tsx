/*
 * [INPUT]: 依赖 lucide 图标、useI18n、context-catalog 分组
 * [OUTPUT]: 对外提供 ContextSearchField：搜索框 + 一级分组 chip + 二级类型 chip；查询由面板受控，继续输入即实时过滤（debounce 在面板）
 * [POS]: web/components/context-panel 的搜索与过滤控制层
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/index";
import { contextGroupTitleKeys } from "@/lib/context-catalog/registry";
import type { ContextGroupID } from "@/lib/context-catalog/types";

export function ContextSearchField({
  query,
  onQuery,
  inputRef,
  group,
  groups,
  onGroup,
}: {
  query: string;
  onQuery: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  group: ContextGroupID | "all";
  groups: ContextGroupID[];
  onGroup: (group: ContextGroupID | "all") => void;
}) {
  const { t } = useI18n();
  return (
    <div className="border-b">
      <div className="relative p-2.5">
        <Search className="pointer-events-none absolute left-4.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          aria-label={t("agent.context.search.placeholder")}
          className="h-8 w-full rounded-sm border bg-background pl-8 pr-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t("agent.context.search.placeholder")}
          ref={inputRef}
          type="search"
          value={query}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1 px-2.5 pb-2">
        <GroupChip active={group === "all"} label={t("agent.context.group.all")} onClick={() => onGroup("all")} />
        {groups.map((id) => (
          <GroupChip
            active={group === id}
            key={id}
            label={t(contextGroupTitleKeys[id] ?? `agent.context.group.${id}`)}
            onClick={() => onGroup(id)}
          />
        ))}
      </div>
    </div>
  );
}

function GroupChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      aria-pressed={active}
      className={`rounded-full border px-2 py-0.5 text-[10px] ${active ? "border-primary/30 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
