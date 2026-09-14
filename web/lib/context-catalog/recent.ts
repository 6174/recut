/*
 * [INPUT]: 依赖浏览器 localStorage
 * [OUTPUT]: 对外提供最近使用上下文的读写（按 scope 隔离、去重、LRU 截断）与 useRecentContextKeys hook
 * [POS]: web/lib/context-catalog 的最近使用持久化；只影响排序，不参与身份与去重
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "recut.context.recent.v1";
const MAX_KEYS = 24;

type RecentMap = Record<string, string[]>;

function readMap(): RecentMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RecentMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: RecentMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 隐私模式 / 配额不足时静默降级：最近使用只是排序优化。
  }
}

export function readRecentKeys(scope: string): string[] {
  const map = readMap();
  return Array.isArray(map[scope]) ? map[scope] : [];
}

export function pushRecentKey(scope: string, key: string): void {
  const map = readMap();
  const current = Array.isArray(map[scope]) ? map[scope] : [];
  const next = [key, ...current.filter((item) => item !== key)].slice(0, MAX_KEYS);
  map[scope] = next;
  writeMap(map);
}

export function useRecentContextKeys(scope: string) {
  const [keys, setKeys] = useState<string[]>([]);
  useEffect(() => {
    setKeys(readRecentKeys(scope));
  }, [scope]);
  const record = useCallback(
    (key: string) => {
      pushRecentKey(scope, key);
      setKeys(readRecentKeys(scope));
    },
    [scope],
  );
  return { recentKeys: keys, record };
}
