/*
 * [INPUT]: 依赖 lib/marketing-worlds CDN 世界观数据、marketing-site 官网外壳与 marketing-worlds 详情组件
 * [OUTPUT]: 对外提供 /worlds/:worldId 与 /zh/worlds/:worldId 的逐世界观独立详情页（图文 + 实体设定）；Worker/本地 Host 逐语言静态壳；canonical/hreflang/og 逐语言
 * [POS]: web/app/marketing/[locale]/worlds/[worldId] 的公开世界观详情层；generateStaticParams 枚举全部 world id，详情数据构建期从 CDN 抓取
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { MarketingShell } from "@/components/marketing-site";
import { MarketingWorldDetailContent } from "@/components/marketing-worlds";
import { fetchMarketingWorlds } from "@/lib/marketing-worlds";
import { buildAlternates, buildOpenGraph, buildTwitter } from "../../seo";
import { marketingEnabled } from "../../../mode";

export async function generateStaticParams() {
  const worlds = await fetchMarketingWorlds();
  return worlds.map((w) => ({ worldId: w.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; worldId: string }> }): Promise<Metadata> {
  const { locale, worldId } = await params;
  const current = locale as Locale;
  const worlds = await fetchMarketingWorlds();
  const world = worlds.find((w) => w.id === decodeURIComponent(worldId));
  if (!world) return {};
  const path = `/worlds/${world.id}/`;
  return {
    title: `${world.name} — ${t("marketing", current, "meta.worlds.title")}`,
    description: world.description,
    robots: { index: true, follow: true },
    alternates: buildAlternates(path, current),
    openGraph: buildOpenGraph(path, current, `${world.name} — Recut`, world.description),
    twitter: buildTwitter(`${world.name} — Recut`, world.description),
  };
}

export default async function MarketingWorldDetailPage({ params }: { params: Promise<{ locale: string; worldId: string }> }) {
  if (!marketingEnabled()) notFound();
  const { locale, worldId } = await params;
  const current = locale as Locale;
  const worlds = await fetchMarketingWorlds();
  const world = worlds.find((w) => w.id === decodeURIComponent(worldId));
  if (!world) notFound();
  return <MarketingShell locale={current}><MarketingWorldDetailContent world={world} /></MarketingShell>;
}
