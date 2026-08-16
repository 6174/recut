/*
 * [INPUT]: 依赖 marketing-site 的官网外壳与文章目录，以及 Marketing JSON-LD
 * [OUTPUT]: 对外提供 /blog 与 /zh/blog 的逐语言静态文章列表及 Blog 结构化数据；canonical/hreflang/og 逐语言
 * [POS]: web/app/marketing/[locale] 的公开内容目录；不读取工作台 service
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata } from "next";
import { t, type Locale } from "@/lib/i18n";
import { BlogContent, MarketingShell } from "@/components/marketing-site";
import { BlogListJsonLd } from "@/components/marketing-jsonld";
import { marketingPosts } from "@/lib/marketing-posts";
import { buildAlternates, buildOpenGraph, buildTwitter } from "../seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const current = locale as Locale;
  const path = "/blog";
  const title = t("marketing", current, "meta.blog.title");
  const description = t("marketing", current, "meta.blog.description");
  const ogTitle = t("marketing", current, "meta.blog.ogTitle");
  const ogDescription = t("marketing", current, "meta.blog.ogDescription");
  const twitterDescription = t("marketing", current, "meta.blog.twitterDescription");
  return {
    title,
    description,
    robots: { index: true, follow: true },
    alternates: buildAlternates(path, current),
    openGraph: buildOpenGraph(path, current, ogTitle, ogDescription),
    twitter: buildTwitter(ogTitle, twitterDescription),
  };
}

export default async function BlogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const current = locale as Locale;
  return <>
    <BlogListJsonLd locale={current} />
    <MarketingShell locale={current}><BlogContent posts={marketingPosts} /></MarketingShell>
  </>;
}
