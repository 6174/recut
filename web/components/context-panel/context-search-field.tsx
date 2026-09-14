/*
 * [INPUT]: 依赖 lucide 图标、useI18n、context-catalog 分组与 WorldSummary
 * [OUTPUT]: 对外提供 ContextSearchField：搜索框 + 一级分组 chip + 二级类型 chip + Entity scope 面包屑（World 选择）
 * [POS]: web/components/context-panel 的搜索与过滤控制层；查询由面板受控，继续输入即实时过滤（debounce 在面板）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/index";
import { contextGroupTitleKeys } from "@/lib/context-catalog/registry";
import type { ContextGroupID } from "@/lib/context-catalog/types";
import type { WorldSummary } from "@/lib/recut-worlds-client";

export function ContextSearchField({
  query,
  onQuery,
  inputRef,
  group,
  groups,
  onGroup,
  subKind,
  subKinds,
  onSubKind,
  scopeWorldId,
  worlds,
  onScopeWorld,
}: {
  query: string;
  onQuery: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  group: ContextGroupID | "all";
  groups: ContextGroupID[];
  onGroup: (group: ContextGroupID | "all") => void;
  subKind?: string;
  subKinds: string[];
  onSubKind: (subKind?: string) => void;
  scopeWorldId: string | null;
  worlds: WorldSummary[];
  onScopeWorld: (worldId: string | null) => void;
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
      {group !== "all" && subKinds.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 px-2.5 pb-2">
          <GroupChip active={!subKind} label={t("agent.context.subkind.all")} onClick={() => onSubKind(undefined)} />
          {subKinds.map((kind) => (
            <GroupChip active={subKind === kind} key={kind} label={kind} onClick={() => onSubKind(kind)} />
          ))}
        </div>
      )}
      {group === "world" && (scopeWorldId || worlds.length > 0) && (
        <div className="flex items-center gap-1.5 border-t px-2.5 py-1.5 text-[10px] text-muted-foreground">
          <span>{t("agent.context.scope.worldLabel")}</span>
          <select
            aria-label={t("agent.context.scope.worldLabel")}
            className="min-w-0 flex-1 rounded-xs border bg-background px-1.5 py-1 text-[11px] text-foreground"
            onChange={(event) => onScopeWorld(event.target.value || null)}
            value={scopeWorldId ?? ""}
          >
            <option value="">{t("agent.context.scope.allWorlds")}</option>
            {worlds.map((world) => (
              <option key={world.id} value={world.id}>
                {world.name}
              </option>
            ))}
          </select>
        </div>
      )}
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
