/*
 * [INPUT]: 依赖 marketing-site 的官网外壳、marketing-worlds 的世界观展示层、lib/marketing-worlds 构建期 CDN 数据与 lib/i18n 字典
 * [OUTPUT]: 对外提供 /worlds 与 /zh/worlds 的逐语言世界观公开页（CDN 目录的逐世界图文详情）；Worker/本地 Host 从无前缀或 /zh 前缀映射到静态壳；canonical/hreflang/og 逐语言
 * [POS]: web/app/marketing/[locale]/worlds 的公开世界观页；区别于 app host 的 /worlds 工作台页面，只读 CDN 发布目录的静态营销数据
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { MarketingShell } from "@/components/marketing-site";
import { MarketingWorldsContent } from "@/components/marketing-worlds";
import { fetchMarketingWorlds } from "@/lib/marketing-worlds";
import { buildAlternates, buildOpenGraph, buildTwitter } from "../seo";
import { marketingEnabled } from "../../mode";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const current = locale as Locale;
  const path = "/worlds/";
  const title = t("marketing", current, "meta.worlds.title");
  const description = t("marketing", current, "meta.worlds.description");
  const ogTitle = t("marketing", current, "meta.worlds.ogTitle");
  const ogDescription = t("marketing", current, "meta.worlds.ogDescription");
  const twitterDescription = t("marketing", current, "meta.worlds.twitterDescription");
  return {
    title,
    description,
    robots: { index: true, follow: true },
    alternates: buildAlternates(path, current),
    openGraph: buildOpenGraph(path, current, ogTitle, ogDescription),
    twitter: buildTwitter(ogTitle, twitterDescription),
  };
}

export default async function MarketingWorldsPage({ params }: { params: Promise<{ locale: string }> }) {
  if (!marketingEnabled()) notFound();
  const { locale } = await params;
  const current = locale as Locale;
  const worlds = await fetchMarketingWorlds();
  return <MarketingShell locale={current}><MarketingWorldsContent worlds={worlds} /></MarketingShell>;
}
