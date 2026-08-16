/*
 * [INPUT]: 依赖 zustand 与 locales.ts
 * [OUTPUT]: 工作台语言偏好的前端真相：locale 状态、localStorage 兜底、首启浏览器探测；服务端持久化（/v1/preferences）由工作台集成方接线
 * [POS]: web/lib/i18n 的工作台偏好边界；设置面板与 useI18n 共同消费，<html lang> 动态化依赖它
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { create } from "zustand";
import { type Locale, detectLocale, defaultLocale } from "./locales";

const STORAGE_KEY = "recut_locale";

export type LocaleStore = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
};

export function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "zh" || raw === "en" ? raw : null;
}

export function persistStoredLocale(locale: Locale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // 隐私模式等场景忽略
  }
}

// 工作台首启探测：先读本地偏好，再读浏览器语言，最后回退默认语言。
export function resolveInitialLocale(detectedBrowserLanguage?: string): Locale {
  return readStoredLocale() ?? detectLocale(detectedBrowserLanguage) ?? defaultLocale;
}

export const useLocaleStore = create<LocaleStore>((set) => ({
  locale: defaultLocale,
  setLocale: (locale) => {
    persistStoredLocale(locale);
    set({ locale });
  },
}));
