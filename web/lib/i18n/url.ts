/*
 * [INPUT]: 依赖 locales.ts 的 Locale 与 defaultLocale
 * [OUTPUT]: 官网 URL 的唯一派生：default(en) 无前缀、zh 加 /zh/ 前缀；canonical、og:url、hreflang、分享链接与内部 Link 全部经它，杜绝两套 URL 拼写
 * [POS]: web/lib/i18n 的官网 URL 边界；与 web/worker.ts 的静态壳重写映射保持一致
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

import { type Locale, defaultLocale } from "./locales";

export function localizeURL(path: string, locale: Locale): string {
  if (locale === defaultLocale) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `/zh${normalized}`;
}
