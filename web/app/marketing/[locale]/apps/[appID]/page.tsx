/*
 * [INPUT]: 依赖 Next 静态参数生成、notFound、lib/marketing-apps 营销应用目录、marketing-site 官网外壳、marketing-apps 详情组件与 Marketing JSON-LD
 * [OUTPUT]: 对外提供每篇 /apps/:appID 与 /zh/apps/:appID 的逐语言公开 App SEO 落地页，含逐 App 元数据与 SoftwareApplication/Breadcrumb 结构化数据；canonical/hreflang/og 逐语言
 * [POS]: web/app/marketing/[locale]/apps 的公开应用详情层；generateStaticParams 返回全部 appID（与 layout 的 locale 参数组合出 zh/en × 全部 App）；App ID 来自独立营销数据源
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { MarketingShell } from "@/components/marketing-site";
import { MarketingAppDetailContent } from "@/components/marketing-apps";
import { AppFaqJsonLd, AppSoftwareJsonLd, BreadcrumbJsonLd } from "@/components/marketing-jsonld";
import { appDescription, appName, appTagline, getMarketingApp, marketingApps, type MarketingApp } from "@/lib/marketing-apps";
import { buildAlternates, buildOpenGraph, buildTwitter } from "../../seo";

export function generateStaticParams() {
  return marketingApps.map((app) => ({ appID: app.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; appID: string }> }): Promise<Metadata> {
  const { locale, appID } = await params;
  const current = locale as Locale;
  const app = getMarketingApp(decodeURIComponent(appID));
  if (!app) return {};
  const path = `/apps/${app.id}/`;
  const title = appName(app, current);
  const description = appDescription(app, current);
  const tagline = appTagline(app, current);
  return {
    title,
    description,
    robots: { index: true, follow: true },
    alternates: buildAlternates(path, current),
    openGraph: buildOpenGraph(path, current, `${title} — Recut`, tagline),
    twitter: buildTwitter(`${title} — Recut`, tagline),
  };
}

export default async function MarketingAppDetailPage({ params }: { params: Promise<{ locale: string; appID: string }> }) {
  const { locale, appID } = await params;
  const current = locale as Locale;
  const app = getMarketingApp(decodeURIComponent(appID));
  if (!app) notFound();
  const related = app.relatedApps.map((id) => getMarketingApp(id)).filter((item): item is MarketingApp => Boolean(item));
  return <>
    <AppSoftwareJsonLd app={app} locale={current} />
    <AppFaqJsonLd app={app} locale={current} />
    <BreadcrumbJsonLd items={[{ name: "Recut", path: "/" }, { name: t("marketing", current, "nav.apps"), path: "/apps" }, { name: appName(app, current), path: `/apps/${app.id}` }]} locale={current} />
    <MarketingShell locale={current}><MarketingAppDetailContent app={app} related={related} /></MarketingShell>
  </>;
}
