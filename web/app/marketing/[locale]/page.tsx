/*
 * [INPUT]: 依赖 marketing-site 的完整官网 Landing 编排与 Marketing JSON-LD、lib/i18n 字典
 * [OUTPUT]: 对外提供 / 与 /zh/ 的逐语言 Landing（Hero、核心应用、创作底座、文章与 CTA）及 Organization/WebSite/SoftwareApplication 结构化数据；canonical/hreflang/og 逐语言
 * [POS]: web/app/marketing/[locale] 的官网首页；经 Cloudflare Worker / server.cjs 的 Host 路由对外暴露为无前缀或 /zh/ 前缀
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { MarketingLanding, MarketingShell } from "@/components/marketing-site";
import { HomeFaqJsonLd, MarketingAppsItemListJsonLd, OrganizationJsonLd, SoftwareApplicationJsonLd, WebSiteJsonLd } from "@/components/marketing-jsonld";
import { marketingPosts } from "@/lib/marketing-posts";
import { buildAlternates, buildOpenGraph, buildTwitter } from "./seo";
import { marketingEnabled } from "../mode";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const current = locale as Locale;
  const path = "/";
  const title = t("marketing", current, "meta.landing.title");
  const description = t("marketing", current, "meta.landing.description");
  const ogTitle = t("marketing", current, "meta.landing.ogTitle");
  const ogDescription = t("marketing", current, "meta.landing.ogDescription");
  const twitterDescription = t("marketing", current, "meta.landing.twitterDescription");
  return {
    title,
    description,
    robots: { index: true, follow: true },
    alternates: buildAlternates(path, current),
    openGraph: buildOpenGraph(path, current, ogTitle, ogDescription),
    twitter: buildTwitter(ogTitle, twitterDescription),
  };
}

export default async function MarketingHomePage({ params }: { params: Promise<{ locale: string }> }) {
  if (!marketingEnabled()) notFound();
  const { locale } = await params;
  const current = locale as Locale;
  return <>
    <OrganizationJsonLd />
    <WebSiteJsonLd locale={current} />
    <SoftwareApplicationJsonLd locale={current} />
    <MarketingAppsItemListJsonLd locale={current} />
    <HomeFaqJsonLd locale={current} />
    <MarketingShell locale={current}><MarketingLanding posts={marketingPosts} /></MarketingShell>
  </>;
}
