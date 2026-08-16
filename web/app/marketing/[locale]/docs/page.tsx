/*
 * [INPUT]: 依赖 marketing-site 的官网外壳与文档导航内容，以及 Marketing JSON-LD
 * [OUTPUT]: 对外提供 /docs 与 /zh/docs 的逐语言静态 Docs 页面及面包屑结构化数据；canonical/hreflang/og 逐语言
 * [POS]: web/app/marketing/[locale] 的公开文档入口；不读取工作台 service
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata } from "next";
import { t, type Locale } from "@/lib/i18n";
import { DocsContent, MarketingShell } from "@/components/marketing-site";
import { BreadcrumbJsonLd } from "@/components/marketing-jsonld";
import { loadDocs } from "@/lib/docs";
import { buildAlternates, buildOpenGraph, buildTwitter } from "../seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const current = locale as Locale;
  const path = "/docs";
  const title = t("marketing", current, "meta.docs.title");
  const description = t("marketing", current, "meta.docs.description");
  const ogTitle = t("marketing", current, "meta.docs.ogTitle");
  const ogDescription = t("marketing", current, "meta.docs.ogDescription");
  const twitterDescription = t("marketing", current, "meta.docs.twitterDescription");
  return {
    title,
    description,
    robots: { index: true, follow: true },
    alternates: buildAlternates(path, current),
    openGraph: buildOpenGraph(path, current, ogTitle, ogDescription),
    twitter: buildTwitter(ogTitle, twitterDescription),
  };
}

export default async function DocsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const current = locale as Locale;
  const docs = loadDocs(current);
  return <>
    <BreadcrumbJsonLd items={[{ name: "Recut", path: "/" }, { name: t("marketing", current, "meta.docs.title"), path: "/docs" }]} locale={current} />
    <MarketingShell locale={current}><DocsContent docs={docs} /></MarketingShell>
  </>;
}
