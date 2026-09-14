/*
 * [INPUT]: 依赖 react createPortal、useContextCatalog/useContextRuntime、ContextSearchField/ContextList/ContextPreviewPane、筛选与排序纯函数
 * [OUTPUT]: 对外提供 ContextMentionPanel：720×min(520,vh) 双栏面板，Portal 锚定 composer 上方，支持搜索/一级分组/二级类型/World scope/键盘导航/预览/插入
 * [POS]: web/components/context-panel 的双栏容器（选择面 RFC §6/§16）；由 agent-composer 的 @ 与 AtSign 触发，allowedRefTypes 可裁剪
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkFocusContext, WorkSurfaceContext } from "@/components/agent-panel-types";
import { useContextCatalog } from "@/lib/context-catalog/runtime";
import { buildContextRows, CONTEXT_GROUP_ORDER, type ContextRow, type ContextSourceError } from "@/lib/context-catalog/search";
import { contextSourcesForGroup } from "@/lib/context-catalog/registry";
import type { ContextGroupID, ContextOption, ContextPreview, ContextSearchContext } from "@/lib/context-catalog/types";
import { useI18n } from "@/lib/i18n/index";
import { ContextList } from "./context-list";
import { ContextPreviewPane } from "./context-preview";
import { ContextSearchField } from "./context-search-field";

export function ContextMentionPanel({
  apiBase,
  projectID,
  workSurface,
  workFocus,
  initialQuery,
  selectedKeys,
  allowedRefTypes,
  onPick,
  onClose,
}: {
  apiBase: string;
  projectID: string | null;
  workSurface: WorkSurfaceContext | null;
  workFocus: WorkFocusContext | null;
  /** 打开时的初始查询（编辑器 @ 后已输入内容） */
  initialQuery?: string;
  selectedKeys: Set<string>;
  allowedRefTypes?: string[];
  onPick: (option: ContextOption, keepOpen: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchCtxRef = useRef<ContextSearchContext | null>(null);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [group, setGroup] = useState<ContextGroupID | "all">("all");
  const [subKind, setSubKind] = useState<string | undefined>(undefined);
  const [scopeWorldId, setScopeWorldId] = useState<string | null>(null);
  const [options, setOptions] = useState<ContextOption[]>([]);
  const [errors, setErrors] = useState<ContextSourceError[]>([]);
  const [loading, setLoading] = useState(true);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<ContextPreview | null>(null);

  const { runtime, search, record, sourceFor } = useContextCatalog({
    apiBase,
    projectID,
    workSurface,
    workFocus,
    selectedKeys,
    allowedRefTypes,
  });

  const groups = useMemo<ContextGroupID[]>(() => {
    return CONTEXT_GROUP_ORDER.filter((id) => {
      const sources = contextSourcesForGroup(id);
      if (!allowedRefTypes?.length) return sources.some((source) => source.inlineInsertable || source.insertMode === "attach");
      return sources.some((source) => allowedRefTypes.includes(source.type));
    });
  }, [allowedRefTypes]);

  // Entity scope：激活 Entities source 时自动取当前 World（若宿主在世界页）。
  useEffect(() => {
    if (group === "world" && scopeWorldId === null) {
      const surface = workSurface;
      if (surface?.target?.kind === "world") setScopeWorldId(surface.target.worldId);
    }
  }, [group, scopeWorldId, workSurface]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 查询生命周期：120ms debounce + AbortController 取消上一次。
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      void search({
        query,
        group,
        subKind,
        scope: { worldId: scopeWorldId ?? undefined, projectId: projectID ?? undefined },
        allowedRefTypes,
        signal: controller.signal,
      })
        .then((result) => {
          if (controller.signal.aborted) return;
          setOptions(result.options);
          setErrors(result.errors);
          setHighlightedKey((current) => {
            const exists = result.options.some((option) => option.key === current && !option.disabled);
            if (exists) return current;
            return result.options.find((option) => !option.disabled)?.key ?? null;
          });
        })
        .catch(() => {
          if (!controller.signal.aborted) setErrors([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 120);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [allowedRefTypes, group, projectID, query, scopeWorldId, search, subKind]);

  const rows = useMemo<ContextRow[]>(() => buildContextRows(options), [options]);
  const optionRows = useMemo(() => rows.filter((row): row is Extract<ContextRow, { kind: "option" }> => row.kind === "option"), [rows]);
  const subKinds = useMemo(() => {
    const set = new Set<string>();
    for (const option of options) if (option.subKind) set.add(option.subKind);
    return [...set];
  }, [options]);

  // 预览：高亮项变化时按 descriptor.preview() 懒加载。
  useEffect(() => {
    const option = optionRows.find((row) => row.option.key === highlightedKey)?.option;
    if (!option || option.disabled) {
      setPreview(null);
      return;
    }
    const source = sourceFor(option.sourceType);
    if (!source) {
      setPreview(null);
      return;
    }
    const ctx = searchCtxRef.current;
    if (!ctx) return;
    let cancelled = false;
    void Promise.resolve(source.preview(option, ctx))
      .then((value) => {
        if (!cancelled) setPreview(value);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [highlightedKey, optionRows, sourceFor]);

  // 记录最近一次查询上下文供 preview 使用。
  useEffect(() => {
    searchCtxRef.current = {
      apiBase,
      query,
      group,
      subKind,
      scope: { worldId: scopeWorldId ?? undefined, projectId: projectID ?? undefined },
      runtime,
      allowedRefTypes,
      signal: new AbortController().signal,
      limit: 24,
    };
  }, [allowedRefTypes, apiBase, group, projectID, query, runtime, scopeWorldId, subKind]);

  const commit = useCallback(
    (option: ContextOption | undefined, keepOpen: boolean) => {
      if (!option || option.disabled) return;
      record(option);
      onPick(option, keepOpen);
    },
    [onPick, record],
  );

  const moveHighlight = useCallback(
    (delta: number) => {
      if (optionRows.length === 0) return;
      const currentIndex = optionRows.findIndex((row) => row.option.key === highlightedKey);
      const nextIndex = Math.max(0, Math.min(optionRows.length - 1, (currentIndex < 0 ? 0 : currentIndex) + delta));
      setHighlightedKey(optionRows[nextIndex]?.option.key ?? null);
      document.querySelector(`[data-context-key="${optionRows[nextIndex]?.option.key}"]`)?.scrollIntoView({ block: "nearest" });
    },
    [highlightedKey, optionRows],
  );

  const highlightedOption = optionRows.find((row) => row.option.key === highlightedKey)?.option;
  const highlightedSource = highlightedOption ? sourceFor(highlightedOption.sourceType) : undefined;

  function handleKeyDown(event: React.KeyboardEvent) {
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
    if (event.key === "Home") {
      event.preventDefault();
      setHighlightedKey(optionRows[0]?.option.key ?? null);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setHighlightedKey(optionRows[optionRows.length - 1]?.option.key ?? null);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commit(highlightedOption, event.metaKey || event.ctrlKey);
      return;
    }
    if (event.key === "Tab" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const order: Array<ContextGroupID | "all"> = ["all", ...groups];
      const currentIndex = order.indexOf(group);
      const delta = event.shiftKey || event.key === "ArrowLeft" ? -1 : 1;
      const nextIndex = (currentIndex + delta + order.length) % order.length;
      setGroup(order[nextIndex]);
      setSubKind(undefined);
      return;
    }
    if (event.key === "Backspace" && query === "" && scopeWorldId) {
      setScopeWorldId(null);
    }
  }

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-md border bg-popover text-foreground shadow-[var(--shadow-overlay)]" onKeyDown={handleKeyDown}>
        <header className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-medium">{t("agent.context.title")}</span>
          <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={onClose} type="button">
            {t("agent.context.close")}
          </button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-r">
            <ContextSearchField
              group={group}
              groups={groups}
              inputRef={inputRef}
              onGroup={(next) => {
                setGroup(next);
                setSubKind(undefined);
              }}
              onQuery={setQuery}
              onScopeWorld={setScopeWorldId}
              onSubKind={setSubKind}
              query={query}
              scopeWorldId={scopeWorldId}
              subKind={subKind}
              subKinds={subKinds}
              worlds={runtime.worlds}
            />
            <ContextList
              apiBase={apiBase}
              errors={errors}
              highlightedKey={highlightedKey}
              loading={loading}
              onHighlight={setHighlightedKey}
              onPick={(key) => commit(optionRows.find((row) => row.option.key === key)?.option, false)}
              rows={rows}
              sourceFor={sourceFor}
            />
          </div>
          <ContextPreviewPane
            insertMode={highlightedSource?.insertMode ?? "inline"}
            onInsert={() => commit(highlightedOption, false)}
            preview={preview}
          />
        </div>
    </section>
  );
}
