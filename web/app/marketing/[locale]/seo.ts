/*
 * [INPUT]: 依赖 lib/i18n（Locality/localizeURL）
 * [OUTPUT]: [locale] 各页 generateMetadata 的共享 SEO 构造：canonical、hreflang 三元组、og 本地化与 twitter；URL 一律经 localizeURL 派生（default(en) 无前缀、zh 加 /zh/）
 * [POS]: web/app/marketing/[locale] 的 metadata 边界；非路由文件，仅供 [locale] 下的 page 导入
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata } from "next";
import { type Locale, localizeURL } from "@/lib/i18n";

export const SITE_URL = "https://recut.video";
export const SITE_LOGO = `${SITE_URL}/logo.jpg`;

export function localizedURL(path: string, locale: Locale): string {
  return `${SITE_URL}${localizeURL(path, locale)}`;
}

export function ogLocale(locale: Locale): string {
  return locale === "zh" ? "zh_CN" : "en_US";
}

type Alternates = NonNullable<Metadata["alternates"]>;

export function buildAlternates(path: string, locale: Locale): Alternates {
  return {
    canonical: localizedURL(path, locale),
    languages: {
      en: localizedURL(path, "en"),
      zh: localizedURL(path, "zh"),
      "x-default": localizedURL(path, "en"),
    },
  };
}

type OpenGraph = NonNullable<Metadata["openGraph"]>;

export function buildOpenGraph(path: string, locale: Locale, title: string, description: string, type: "website" | "article" = "website", publishedTime?: string): OpenGraph {
  const other = locale === "zh" ? "en" : "zh";
  const og: OpenGraph = {
    type,
    url: localizedURL(path, locale),
    title,
    description,
    siteName: "Recut",
    locale: ogLocale(locale),
    alternateLocale: [ogLocale(other)],
    images: [{ url: SITE_LOGO, width: 404, height: 424, alt: "Recut" }],
  } as OpenGraph;
  if (type === "article" && publishedTime) {
    (og as { publishedTime?: string }).publishedTime = publishedTime;
  }
  return og;
}

type Twitter = NonNullable<Metadata["twitter"]>;

export function buildTwitter(title: string, description: string): Twitter {
  return { card: "summary_large_image", title, description, images: [SITE_LOGO] };
}
