/*
 * [INPUT]: 全站 i18n 的语言枚举与探测口径
 * [OUTPUT]: 唯一 Locale 类型、语言列表、默认语言与浏览器探测映射（zh* → zh，其余 → en）
 * [POS]: web/lib/i18n 的底座；官网（URL 驱动）与工作台/Service/App（偏好驱动）都收敛到同一个 Locale
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export type Locale = "zh" | "en";

export const locales: readonly Locale[] = ["zh", "en"] as const;

// 无语言前缀的 `/` 恒为默认语言（英文）；中文固定 `/zh/` 前缀。
export const defaultLocale: Locale = "en";

export function isDefaultLocale(locale: Locale): boolean {
  return locale === defaultLocale;
}

// 浏览器语言探测：与官网 Worker 的 Accept-Language 判定、service/locale.go 同口径。
export function detectLocale(value: string | null | undefined): Locale {
  if (!value) return defaultLocale;
  return value.toLowerCase().startsWith("zh") ? "zh" : defaultLocale;
}
