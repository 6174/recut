/*
 * [INPUT]: 依赖 marketing-site 的官网外壳、marketing-apps 的应用目录内容、marketing-jsonld 与 lib/i18n 字典
 * [OUTPUT]: 对外提供 /apps 与 /zh/apps 的逐语言公开应用市场目录（Worker/本地 Host 从无前缀或 /zh 前缀映射到静态壳）；canonical/hreflang/og 逐语言
 * [POS]: web/app/marketing/[locale]/apps 的公开应用目录；区别于 app host 的 `/apps` 工作台目录，只读静态营销数据
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata } from "next";
import { t, type Locale } from "@/lib/i18n";
import { MarketingShell } from "@/components/marketing-site";
import { MarketingAppsContent } from "@/components/marketing-apps";
import { MarketingAppsItemListJsonLd } from "@/components/marketing-jsonld";
import { marketingApps } from "@/lib/marketing-apps";
import { buildAlternates, buildOpenGraph, buildTwitter } from "../seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const current = locale as Locale;
  const path = "/apps/";
  const title = t("marketing", current, "meta.apps.title");
  const description = t("marketing", current, "meta.apps.description");
  const ogTitle = t("marketing", current, "meta.apps.ogTitle");
  const ogDescription = t("marketing", current, "meta.apps.ogDescription");
  const twitterDescription = t("marketing", current, "meta.apps.twitterDescription");
  return {
    title,
    description,
    robots: { index: true, follow: true },
    alternates: buildAlternates(path, current),
    openGraph: buildOpenGraph(path, current, ogTitle, ogDescription),
    twitter: buildTwitter(ogTitle, twitterDescription),
  };
}

export default async function MarketingAppsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const current = locale as Locale;
  return <>
    <MarketingAppsItemListJsonLd locale={current} />
    <MarketingShell locale={current}><MarketingAppsContent apps={marketingApps} /></MarketingShell>
  </>;
}
