/*
 * [INPUT]: 依赖 context-catalog/types
 * [OUTPUT]: 对外提供纯函数目录内核：matchScore/rankOptions/mergeOptions/buildContextRows/fanOutSearch 与分组顺序、权重、单来源上限；易单测、可缓存
 * [POS]: web/lib/context-catalog 的目录计算层（选择面 RFC §7）；合并、排序、去重、分组全部在此实现，来源只负责产出候选
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { ContextGroupID, ContextOption, ContextSearchContext, ContextSource } from "./types";

export const CONTEXT_GROUP_ORDER: ContextGroupID[] = ["current", "world", "workspace", "media", "capability"];

const GROUP_WEIGHT: Record<ContextGroupID, number> = {
  current: 50,
  world: 40,
  workspace: 30,
  media: 20,
  capability: 10,
};

export const SOURCE_TIMEOUT_MS = 4000;

// 标题匹配分：精确 200 / 前缀 120 / 词边界 80 / 子串 60 / 子序列 40；无命中 -1。
export function matchScore(text: string, query: string): number {
  const haystack = text.toLowerCase();
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  if (haystack === needle) return 200;
  if (haystack.startsWith(needle)) return 120;
  if (wordBoundaryMatch(haystack, needle)) return 80;
  if (haystack.includes(needle)) return 60;
  if (subsequenceMatch(haystack, needle)) return 40;
  return -1;
}

function wordBoundaryMatch(haystack: string, needle: string): boolean {
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    const before = index === 0 ? " " : haystack[index - 1];
    if (/[\s\p{P}]/u.test(before)) return true;
    index = haystack.indexOf(needle, index + 1);
  }
  return false;
}

function subsequenceMatch(haystack: string, needle: string): boolean {
  let cursor = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found < 0) return false;
    cursor = found + 1;
  }
  return true;
}

export function optionHaystack(option: ContextOption): string {
  return `${option.title} ${option.subtitle ?? ""}`;
}

// rankOptions 计算最终分并稳定排序（RFC §7.3）。
export function rankOptions(
  options: ContextOption[],
  query: string,
  recentKeys: readonly string[],
): ContextOption[] {
  const recentIndex = new Map(recentKeys.map((key, index) => [key, index]));
  const scored = options.map((option) => {
    let score = option.score;
    if (option.pinned) score += 1000;
    const recent = recentIndex.get(option.key);
    if (recent !== undefined) score += Math.max(0, 300 - recent * 30);
    if (query.trim()) {
      const match = matchScore(optionHaystack(option), query);
      if (match > 0) score += match;
    }
    score += GROUP_WEIGHT[option.group] ?? 0;
    return { ...option, score };
  });
  return scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.title.localeCompare(right.title);
  });
}

export function markSelected(options: ContextOption[], selectedKeys: ReadonlySet<string>): ContextOption[] {
  return options.map((option) => ({ ...option, selected: selectedKeys.has(option.key) }));
}

export function dedupeOptions(options: ContextOption[]): ContextOption[] {
  const seen = new Set<string>();
  const out: ContextOption[] = [];
  for (const option of options) {
    if (seen.has(option.key)) continue;
    seen.add(option.key);
    out.push(option);
  }
  return out;
}

export type ContextRow =
  | { kind: "header"; key: string; group: ContextGroupID; count: number; label?: string }
  | { kind: "option"; key: string; option: ContextOption };

// buildContextRows 把选项扁平化为虚拟列表行（header + option），列内保留组顺序。
export function buildContextRows(
  options: ContextOption[],
  options_?: { includeEmptyHeaders?: boolean },
): ContextRow[] {
  const byGroup = new Map<ContextGroupID, ContextOption[]>();
  for (const option of options) {
    const list = byGroup.get(option.group) ?? [];
    list.push(option);
    byGroup.set(option.group, list);
  }
  const rows: ContextRow[] = [];
  for (const group of CONTEXT_GROUP_ORDER) {
    const list = byGroup.get(group);
    if (!list || list.length === 0) continue;
    rows.push({ kind: "header", key: `header:${group}`, group, count: list.length });
    for (const option of list) rows.push({ kind: "option", key: option.key, option });
  }
  return rows;
}

export function groupCounts(options: ContextOption[]): Record<ContextGroupID, number> {
  const counts = { current: 0, world: 0, workspace: 0, media: 0, capability: 0 } as Record<ContextGroupID, number>;
  for (const option of options) counts[option.group] += 1;
  return counts;
}

export type ContextSourceError = { sourceType: string; timedOut: boolean; message: string };

export type FanOutResult = {
  options: ContextOption[];
  errors: ContextSourceError[];
};

// fanOutSearch 并发所有（或允许的）来源，单来源超时降级但不影响其他来源（RFC §7.1/§15）。
export async function fanOutSearch(sources: ContextSource[], ctx: ContextSearchContext): Promise<FanOutResult> {
  const allowed = ctx.allowedRefTypes?.length
    ? sources.filter((source) => ctx.allowedRefTypes!.includes(source.type))
    : sources;
  const results = await Promise.all(
    allowed.map(async (source): Promise<{ options: ContextOption[]; error?: ContextSourceError }> => {
      try {
        const options = await withTimeout(source.search({ ...ctx, query: ctx.query, signal: ctx.signal }), SOURCE_TIMEOUT_MS);
        return { options };
      } catch (cause) {
        const timedOut = cause instanceof TimeoutError;
        return {
          options: [],
          error: {
            sourceType: source.type,
            timedOut,
            message: cause instanceof Error ? cause.message : String(cause),
          },
        };
      }
    }),
  );
  const options: ContextOption[] = [];
  const errors: ContextSourceError[] = [];
  for (const result of results) {
    options.push(...result.options);
    if (result.error) errors.push(result.error);
  }
  return { options, errors };
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError("context source timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

// 每个来源在不同模式下的返回上限（RFC §6.2）。
export function sourceLimit(query: string, group: ContextSearchContext["group"], limit: number): number {
  const scoped = Boolean(query.trim()) || group !== "all";
  return Math.min(limit, scoped ? 12 : 8);
}
