/*
 * [INPUT]: 无运行时依赖
 * [OUTPUT]: 对外提供内容目录的 locale 枚举与默认值；与 rfc/2026-08-16-i18n-zh-en.md 的 Locale 枚举一致（en 为 default 无前缀面，zh 走 /zh/）
 * [POS]: web/lib 的纯常量模块；blog 与 App 的 MDX 加载器共用，多语言接入时在此扩展
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export const DEFAULT_CONTENT_LOCALE = "zh";
export const CONTENT_LOCALES = ["zh", "en"] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];
