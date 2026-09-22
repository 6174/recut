/*
 * [INPUT]: 依赖 @tanstack/react-virtual、context-catalog/search 的行模型与 context-option-row
 * [OUTPUT]: 对外提供 ContextList：虚拟化的分组列表（header + option 行），表头支持 label 覆盖，含空态与错误行；drill 时空态文案切换为「无可引用属性」
 * [POS]: web/components/context-panel 的虚拟列表；行高固定避免抖动，键盘高亮由容器回传
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { useI18n } from "@/lib/i18n/index";
import { CONTEXT_GROUP_ORDER, contextGroupTitleKeys } from "@/lib/context-catalog/registry";
import type { ContextRow, ContextSourceError } from "@/lib/context-catalog/search";
import type { ContextGroupID, ContextOption, ContextSource } from "@/lib/context-catalog/types";
import { ContextOptionRow } from "./context-option-row";

const HEADER_HEIGHT = 28;
const ROW_HEIGHT = 52;

export function ContextList({
  rows,
  errors,
  loading,
  drill = false,
  highlightedKey,
  sourceFor,
  apiBase,
  onHighlight,
  onPick,
  onExpand,
}: {
  rows: ContextRow[];
  errors: ContextSourceError[];
  loading: boolean;
  /** 下钻层（如实体 → 属性）：空态文案换成「无可引用属性」，与顶层搜索区分 */
  drill?: boolean;
  highlightedKey: string | null;
  sourceFor: (type: string) => ContextSource | undefined;
  apiBase: string;
  onHighlight: (key: string) => void;
  onPick: (key: string) => void;
  onExpand: (option: ContextOption) => void;
}) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === "header" ? HEADER_HEIGHT : ROW_HEIGHT),
    overscan: 8,
    getItemKey: (index) => rows[index]?.key ?? index,
    useFlushSync: false,
  });
  const groupTitle = (group: ContextGroupID) => t(contextGroupTitleKeys[group] ?? `agent.context.group.${group}`);
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      {loading && rows.length === 0 ? (
        <div className="space-y-2 p-3">
          {[0, 1, 2, 3, 4].map((index) => (
            <div className="h-9 animate-pulse rounded-sm bg-muted" key={index} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="grid h-full place-items-center px-6 text-center">
          <div>
            <p className="text-xs text-muted-foreground">{t(drill ? "agent.context.drill.empty" : "agent.context.empty")}</p>
            <p className="mt-1 text-[10px] text-muted-foreground/70">{t(drill ? "agent.context.drill.emptyHint" : "agent.context.emptyHint")}</p>
          </div>
        </div>
      ) : (
        <div className="h-full overflow-y-auto" ref={scrollRef}>
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              return (
                <div
                  className="absolute left-0 top-0 w-full"
                  data-index={item.index}
                  key={item.key}
                  ref={virtualizer.measureElement}
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {row.kind === "header" ? (
                    <div
                      aria-label={row.label ?? groupTitle(row.group)}
                      className="flex items-center justify-between px-2.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                      role="group"
                    >
                      <span>{row.label ?? groupTitle(row.group)}</span>
                      <span>{row.count}</span>
                    </div>
                  ) : (
                    <ContextOptionRow
                      apiBase={apiBase}
                      expandable={sourceFor(row.option.sourceType)?.expandable?.(row.option) ?? false}
                      highlighted={highlightedKey === row.option.key}
                      onExpand={() => onExpand(row.option)}
                      onHover={() => onHighlight(row.option.key)}
                      onPick={() => onPick(row.option.key)}
                      option={row.option}
                      source={sourceFor(row.option.sourceType)}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {errors.length > 0 && (
            <div className="border-t px-3 py-2">
              {errors.map((error) => (
                <p className="text-[10px] text-destructive" key={error.sourceType}>
                  {t("agent.context.sourceError")} · {error.sourceType}
                  {error.timedOut ? ` · ${t("agent.context.timeout")}` : ""}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { CONTEXT_GROUP_ORDER };
