/*
 * [INPUT]: 依赖 Next 静态参数生成、notFound、lib/docs 文档目录、marketing-site 文档详情组件与 Marketing JSON-LD
 * [OUTPUT]: 对外提供每篇 /docs/:slug 与 /zh/docs/:slug 的逐语言静态文档详情、逐文档元数据与 Breadcrumb 结构化数据；缺该语言文档时对该语言路由 notFound()
 * [POS]: web/app/marketing/[locale]/docs 的内容详情层；generateStaticParams 返回全部文档 slug（与 layout 的 locale 参数组合出 zh/en × 全部文档）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { DocContent, MarketingShell } from "@/components/marketing-site";
import { BreadcrumbJsonLd } from "@/components/marketing-jsonld";
import { getDoc, loadDocs } from "@/lib/docs";
import { buildAlternates, buildOpenGraph, buildTwitter } from "../../seo";

export function generateStaticParams() {
  const slugs = new Set<string>();
  for (const locale of ["zh", "en"] as Locale[]) {
    for (const doc of loadDocs(locale)) slugs.add(doc.slug);
  }
  return [...slugs].map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const current = locale as Locale;
  const doc = getDoc(slug, current);
  if (!doc) return {};
  const path = `/docs/${doc.slug}`;
  return {
    title: doc.title,
    description: doc.description,
    robots: { index: true, follow: true },
    alternates: buildAlternates(path, current),
    openGraph: buildOpenGraph(path, current, doc.title, doc.description),
    twitter: buildTwitter(doc.title, doc.description),
  };
}

export default async function DocDetailPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const current = locale as Locale;
  const doc = getDoc(slug, current);
  if (!doc) notFound();
  return <>
    <BreadcrumbJsonLd items={[{ name: "Recut", path: "/" }, { name: t("marketing", current, "meta.docs.title"), path: "/docs" }, { name: doc.title, path: `/docs/${doc.slug}` }]} locale={current} />
    <MarketingShell locale={current}><DocContent doc={doc} /></MarketingShell>
  </>;
}
