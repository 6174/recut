/*
 * [INPUT]: 依赖 locales.ts / url.ts / locale-store.ts 与 marketing/workspace 两本字典
 * [OUTPUT]: 全站 i18n 的对外入口：t(scope, locale, key) 纯函数（官网/服务端组件/事件回调可用）与 useI18n() 工作台 client hook；缺 key 回退默认语言，再回退 key 本身
 * [POS]: web/lib/i18n 的统一出口；官网组件用 t("marketing", locale, key)，工作台组件用 useI18n()
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { type Locale, defaultLocale } from "./locales";
import { marketingDictionary } from "./marketing-dict";
import { workspaceDictionary } from "./workspace-dict";
import { useLocaleStore } from "./locale-store";

export * from "./locales";
export * from "./url";
export * from "./locale-store";

export type I18nScope = "marketing" | "workspace";

const dictionaries: Record<I18nScope, Record<Locale, Record<string, string>>> = {
  marketing: marketingDictionary,
  workspace: workspaceDictionary,
};

export function t(scope: I18nScope, locale: Locale, key: string): string {
  const requested = dictionaries[scope][locale];
  const value = requested?.[key];
  if (value !== undefined) return value;
  const fallback = dictionaries[scope][defaultLocale]?.[key];
  return fallback !== undefined ? fallback : key;
}

export function useI18n() {
  const locale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);
  return {
    locale,
    setLocale,
    t: (key: string) => t("workspace", locale, key),
  };
}
