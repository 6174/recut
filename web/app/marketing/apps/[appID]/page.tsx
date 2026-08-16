/*
 * [INPUT]: 依赖 Next 静态参数生成、notFound、lib/marketing-apps 营销应用目录、marketing-site 官网外壳、marketing-apps 详情组件与 Marketing JSON-LD
 * [OUTPUT]: 对外提供每篇 recut.video/apps/:appID 的公开 App SEO 落地页（Worker 从 Marketing Host 映射到 /marketing/apps/:appID/），含逐 App 元数据与 SoftwareApplication/Breadcrumb 结构化数据
 * [POS]: web/app/marketing/apps 的公开应用详情层；App ID 来自独立营销数据源，区别于 app host 的 `/apps/[appID]` 工作台详情
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketingShell } from "@/components/marketing-site";
import { MarketingAppDetailContent } from "@/components/marketing-apps";
import { AppFaqJsonLd, AppSoftwareJsonLd, BreadcrumbJsonLd } from "@/components/marketing-jsonld";
import { getMarketingApp, marketingApps } from "@/lib/marketing-apps";

export function generateStaticParams() {
  return marketingApps.map((app) => ({ appID: app.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ appID: string }> }): Promise<Metadata> {
  const { appID } = await params;
  const app = getMarketingApp(decodeURIComponent(appID));
  if (!app) return {};
  const url = `https://recut.video/apps/${app.id}/`;
  return {
    title: app.name,
    description: app.description,
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      title: `${app.name} — Recut`,
      description: app.tagline,
      siteName: "Recut",
      locale: "zh_CN",
      images: [{ url: "https://recut.video/logo.jpg", width: 404, height: 424, alt: "Recut" }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${app.name} — Recut`,
      description: app.tagline,
      images: ["https://recut.video/logo.jpg"],
    },
  };
}

export default async function MarketingAppDetailPage({ params }: { params: Promise<{ appID: string }> }) {
  const { appID } = await params;
  const app = getMarketingApp(decodeURIComponent(appID));
  if (!app) notFound();
  return <><AppSoftwareJsonLd app={app} /><AppFaqJsonLd app={app} /><BreadcrumbJsonLd items={[{ name: "Recut", path: "/" }, { name: "应用", path: "/apps" }, { name: app.name, path: `/apps/${app.id}` }]} /><MarketingShell><MarketingAppDetailContent app={app} /></MarketingShell></>;
}
