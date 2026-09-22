/*
 * [INPUT]: 依赖 react createPortal、useContextCatalog/useContextRuntime、ContextSearchField/ContextList/ContextPreviewPane、筛选与排序纯函数
 * [OUTPUT]: 对外提供 ContextMentionPanel：720×min(520,vh) 双栏面板，Portal 锚定 composer 上方，支持搜索/一级分组/二级类型/键盘导航/预览/插入；selectedOptions 置顶为「当前引用」分组（与搜索结果去重，便于快速定位）；受控 query + autoFocusSearch=false 时由编辑器驱动（焦点不离开编辑器）；下钻（实体/World → 属性）按进入时的查询前缀剥离父级搜索词，避免父级关键词误杀子项
 * [POS]: web/components/context-panel 的双栏容器（选择面 RFC §6/§16）；由 agent-composer 的 @ 与 AtSign 触发、RichComposer 编辑器内 @ 触发
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkFocusContext, WorkSurfaceContext } from "@/components/agent-panel-types";
import { useContextCatalog } from "@/lib/context-catalog/runtime";
import { buildContextRows, CONTEXT_GROUP_ORDER, dedupeOptions, type ContextRow, type ContextSourceError } from "@/lib/context-catalog/search";
import { contextSourcesForGroup } from "@/lib/context-catalog/registry";
import type { ContextGroupID, ContextOption, ContextPreview, ContextSearchContext } from "@/lib/context-catalog/types";
import { useI18n } from "@/lib/i18n/index";
import { ContextList } from "./context-list";
import { ContextPreviewPane } from "./context-preview";
import { ContextSearchField } from "./context-search-field";

// 编辑器驱动模式（autoFocusSearch=false）下由 window 捕获阶段转发的键；其余按键留给编辑器。
const PANEL_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape", "Tab"]);

/** 同时兼容 React 合成事件与编辑器转发的原生 KeyboardEvent。 */
type PanelKeyEvent = Pick<
  React.KeyboardEvent,
  "key" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey" | "preventDefault" | "stopPropagation"
>;

export function ContextMentionPanel({
  apiBase,
  projectID,
  workSurface,
  workFocus,
  initialQuery,
  query: controlledQuery,
  onQuery,
  autoFocusSearch = true,
  selectedKeys,
  selectedOptions,
  pinnedOptions: pinnedInput,
  onPick,
  onClose,
}: {
  apiBase: string;
  projectID: string | null;
  workSurface: WorkSurfaceContext | null;
  workFocus: WorkFocusContext | null;
  /** 打开时的初始查询（编辑器 @ 后已输入内容） */
  initialQuery?: string;
  /** 受控查询；宿主在编辑器内继续输入时，用它驱动过滤，焦点无需离开编辑器 */
  query?: string;
  onQuery?: (value: string) => void;
  /** 打开时是否聚焦面板搜索框；编辑器驱动模式传 false，避免抢焦点 */
  autoFocusSearch?: boolean;
  selectedKeys: Set<string>;
  /** 已在编辑器中引用的条目：置顶为「当前引用」分组，便于快速定位（与搜索结果去重） */
  selectedOptions?: ContextOption[];
  /** 宿主额外置顶到「当前引用」分组的条目（如生成提案已引用的素材） */
  pinnedOptions?: ContextOption[];
  onPick: (option: ContextOption, keepOpen: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchCtxRef = useRef<ContextSearchContext | null>(null);
  const controlled = controlledQuery !== undefined;
  const [innerQuery, setInnerQuery] = useState(initialQuery ?? "");
  const query: string = controlled ? (controlledQuery as string) : innerQuery;
  const setQuery = useCallback(
    (value: string) => {
      if (controlled) onQuery?.(value);
      else setInnerQuery(value);
    },
    [controlled, onQuery],
  );
  const [group, setGroup] = useState<ContextGroupID | "all">("all");
  const [scopeWorldId, setScopeWorldId] = useState<string | null>(null);
  const [options, setOptions] = useState<ContextOption[]>([]);
  const [errors, setErrors] = useState<ContextSourceError[]>([]);
  const [loading, setLoading] = useState(true);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<ContextPreview | null>(null);
  // 下钻栈：每层记录被展开的选项、其子项（如 entity/asset → 其 attrs）与进入时的查询。
  // 空栈 = 正常搜索列表；进入时的查询用于把父级搜索词从子项过滤中剥离（否则父级关键词会误杀属性）。
  const [drillFrames, setDrillFrames] = useState<Array<{ option: ContextOption; options: ContextOption[]; query: string }>>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  const { runtime, search, record, sourceFor } = useContextCatalog({
    apiBase,
    projectID,
    workSurface,
    workFocus,
    selectedKeys,
  });
  // search 的 identity 随 runtime/目录快照变化；用 ref 固定引用，避免 store 抖动
  // （如全局实体索引落库）反复重置下面的查询 effect，造成搜索风暴。
  const searchRef = useRef(search);
  searchRef.current = search;

  const groups = useMemo<ContextGroupID[]>(() => {
    return CONTEXT_GROUP_ORDER.filter((id) => {
      const sources = contextSourcesForGroup(id);
      return sources.some((source) => source.inlineInsertable || source.insertMode === "attach");
    });
  }, []);

  // enterOption：展开一个有 children 的选项，把子项压入下钻栈。
  const enterOption = useCallback(
    async (option: ContextOption) => {
      const source = sourceFor(option.sourceType);
      const ctx = searchCtxRef.current;
      if (!source?.children || !ctx) return;
      setDrillLoading(true);
      try {
        const children = await Promise.resolve(source.children(option, ctx));
        setDrillFrames((frames) => [...frames, { option, options: children, query }]);
        setHighlightedKey(children.find((child) => !child.disabled)?.key ?? null);
      } finally {
        setDrillLoading(false);
      }
    },
    [query, sourceFor],
  );

  // backOption：弹出一层；index=0 回到根搜索。
  const backOption = useCallback((index: number) => {
    setDrillFrames((frames) => frames.slice(0, index));
  }, []);

  // Entity scope：激活 Entities source 时自动取当前 World（若宿主在世界页）。
  useEffect(() => {
    if (group === "world" && scopeWorldId === null) {
      const surface = workSurface;
      if (surface?.target?.kind === "world") setScopeWorldId(surface.target.worldId);
    }
  }, [group, scopeWorldId, workSurface]);

  useEffect(() => {
    if (autoFocusSearch) inputRef.current?.focus();
  }, [autoFocusSearch]);

  // 查询生命周期：120ms debounce + AbortController 取消上一次。
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      void searchRef.current({
        query,
        group,
        scope: { worldId: scopeWorldId ?? undefined, projectId: projectID ?? undefined },
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
  }, [group, projectID, query, scopeWorldId]);

  // 置顶条目 = 正文已有引用 + 宿主额外注入（如生成提案的参考素材），按 key 去重。
  const pinnedOptions = useMemo(
    () => dedupeOptions([...(pinnedInput ?? []), ...(selectedOptions ?? [])]),
    [pinnedInput, selectedOptions],
  );
  // 已引用条目从搜索结果剔除（避免与置顶的「当前引用」重复）
  const selectedKeySet = useMemo(() => new Set(pinnedOptions.map((option) => option.key)), [pinnedOptions]);
  const visibleOptions = useMemo(
    () => (selectedKeySet.size ? options.filter((option) => !selectedKeySet.has(option.key)) : options),
    [options, selectedKeySet],
  );
  // 下钻时：当前层子项按查询本地过滤，平铺为 option 行（不分组、不置顶当前引用）。
  // 进入下钻时父级搜索词仍留在输入框，但它不该过滤子项——剥离进入时的查询前缀，只用在层内新输入的部分过滤。
  const drillOptions = useMemo(() => {
    if (!drillFrames.length) return [];
    const current = drillFrames[drillFrames.length - 1];
    const base = current.query;
    const needle = (query.startsWith(base) ? query.slice(base.length) : query).trim().toLowerCase();
    if (!needle) return current.options;
    return current.options.filter((option) => `${option.title} ${option.subtitle ?? ""}`.toLowerCase().includes(needle));
  }, [drillFrames, query]);

  const rows = useMemo<ContextRow[]>(() => {
    if (drillFrames.length) {
      return drillOptions.map((option): ContextRow => ({ kind: "option", key: option.key, option }));
    }
    const base = buildContextRows(visibleOptions);
    if (!pinnedOptions.length) return base;
    return [
      { kind: "header", key: "header:selected", group: "current", count: pinnedOptions.length, label: t("agent.context.group.selected") },
      ...pinnedOptions.map((option): ContextRow => ({ kind: "option", key: option.key, option })),
      ...base,
    ];
  }, [drillFrames, drillOptions, pinnedOptions, t, visibleOptions]);
  const optionRows = useMemo(() => rows.filter((row): row is Extract<ContextRow, { kind: "option" }> => row.kind === "option"), [rows]);

  // 下钻层内：查询过滤导致高亮项消失时，自动落到第一个可选项。
  useEffect(() => {
    if (!drillFrames.length) return;
    if (highlightedKey && optionRows.some((row) => row.option.key === highlightedKey)) return;
    setHighlightedKey(optionRows.find((row) => !row.option.disabled)?.option.key ?? null);
  }, [drillFrames.length, highlightedKey, optionRows]);

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
      scope: { worldId: scopeWorldId ?? undefined, projectId: projectID ?? undefined },
      runtime,
      signal: new AbortController().signal,
    };
  }, [apiBase, group, projectID, query, runtime, scopeWorldId]);

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

  function handleKeyDown(event: PanelKeyEvent) {
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
      setDrillFrames([]);
      return;
    }
  }

  // 编辑器驱动模式：焦点留在编辑器，键盘在 window 捕获阶段先于宿主（如全屏编辑器的 ⌘↵ 保存 / Esc 取消）消费。
  const handleKeyDownRef = useRef(handleKeyDown);
  handleKeyDownRef.current = handleKeyDown;
  useEffect(() => {
    if (autoFocusSearch) return;
    function onWindowKeyDown(event: KeyboardEvent) {
      if (event.isComposing || event.keyCode === 229) return;
      if (!PANEL_KEYS.has(event.key)) return;
      handleKeyDownRef.current(event);
      if (event.defaultPrevented) event.stopPropagation();
    }
    window.addEventListener("keydown", onWindowKeyDown, true);
    return () => window.removeEventListener("keydown", onWindowKeyDown, true);
  }, [autoFocusSearch]);

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-md border bg-popover text-foreground shadow-[var(--shadow-overlay)]" onKeyDown={handleKeyDown}>
        <header className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-medium">{t("agent.context.title")}</span>
          <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={onClose} type="button">
            {t("agent.context.close")}
          </button>
        </header>
        <ContextSearchField
          group={group}
          groups={groups}
          inputRef={inputRef}
          onGroup={(next) => {
            setGroup(next);
            setDrillFrames([]);
          }}
          onQuery={setQuery}
          query={query}
        />
        {drillFrames.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto border-b px-3 py-1.5 text-[10px] text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button className="shrink-0 hover:text-foreground" onClick={() => backOption(0)} type="button">
              {t("agent.context.group.all")}
            </button>
            {drillFrames.map((frame, index) => (
              <span className="flex shrink-0 items-center gap-1" key={frame.option.key}>
                <span className="text-muted-foreground/60">/</span>
                <button
                  className="max-w-40 truncate hover:text-foreground disabled:cursor-default disabled:text-foreground"
                  disabled={index === drillFrames.length - 1}
                  onClick={() => backOption(index + 1)}
                  type="button"
                >
                  {frame.option.title}
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-r">
            <ContextList
              apiBase={apiBase}
              drill={drillFrames.length > 0}
              errors={errors}
              highlightedKey={highlightedKey}
              loading={drillFrames.length ? drillLoading : loading}
              onExpand={(option) => void enterOption(option)}
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
