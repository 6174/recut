/*
 * [INPUT]: 依赖 Next 静态参数生成、notFound、lib/marketing-posts 双语言文章目录、marketing-site 详情组件与 Marketing JSON-LD
 * [OUTPUT]: 对外提供每篇 /blog/:slug 与 /zh/blog/:slug 的逐语言静态文章详情、逐篇元数据与 BlogPosting/Breadcrumb 结构化数据；缺该语言内容的文章对该语言路由 notFound()
 * [POS]: web/app/marketing/[locale] 的内容详情层；generateStaticParams 返回全部 slug（与 layout 的 locale 参数组合出 zh/en × 全部文章）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { BlogPostContent, MarketingShell } from "@/components/marketing-site";
import { BlogPostJsonLd, BreadcrumbJsonLd } from "@/components/marketing-jsonld";
import { getMarketingPost, marketingPosts, postHasLocale } from "@/lib/marketing-posts";
import { buildAlternates, buildOpenGraph, buildTwitter } from "../../seo";

export function generateStaticParams() {
  return marketingPosts.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const current = locale as Locale;
  const post = getMarketingPost(slug);
  if (!post || !postHasLocale(post, current)) return {};
  const path = `/blog/${post.slug}`;
  const title = post.title[current];
  const description = post.description[current];
  return {
    title,
    description,
    robots: { index: true, follow: true },
    alternates: buildAlternates(path, current),
    openGraph: buildOpenGraph(path, current, title, description, "article", post.date),
    twitter: buildTwitter(title, description),
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const current = locale as Locale;
  const post = getMarketingPost(slug);
  if (!post || !postHasLocale(post, current)) notFound();
  return <>
    <BreadcrumbJsonLd items={[{ name: "Recut", path: "/" }, { name: t("marketing", current, "nav.blog"), path: "/blog" }, { name: post.title[current], path: `/blog/${post.slug}` }]} locale={current} />
    <BlogPostJsonLd post={post} locale={current} />
    <MarketingShell locale={current}><BlogPostContent post={post} /></MarketingShell>
  </>;
}
