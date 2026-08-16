/*
 * [INPUT]: 依赖 Next 静态参数生成、notFound、lib/marketing-posts 文章目录、marketing-site 详情组件与 Marketing JSON-LD
 * [OUTPUT]: 对外提供每篇 recut.video/blog/:slug 与 localhost:3000/blog/:slug 的静态文章详情、逐篇元数据与 BlogPosting/Breadcrumb 结构化数据
 * [POS]: web/app/blog 的内容详情层；所有 slug 必须来自共享文章目录
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogPostContent, MarketingShell } from "@/components/marketing-site";
import { BlogPostJsonLd, BreadcrumbJsonLd } from "@/components/marketing-jsonld";
import { marketingPosts } from "@/lib/marketing-posts";

export function generateStaticParams() {
  return marketingPosts.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = marketingPosts.find((item) => item.slug === slug);
  if (!post) return {};
  const url = `https://recut.video/blog/${post.slug}`;
  return {
    title: post.title,
    description: post.description,
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      title: post.title,
      description: post.description,
      publishedTime: post.date,
      authors: ["Recut"],
      siteName: "Recut",
      locale: "zh_CN",
      images: [{ url: "https://recut.video/logo.jpg", width: 404, height: 424, alt: "Recut" }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: ["https://recut.video/logo.jpg"],
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = marketingPosts.find((item) => item.slug === slug);
  if (!post) notFound();
  return <><BreadcrumbJsonLd items={[{ name: "Recut", path: "/" }, { name: "Blog", path: "/blog" }, { name: post.title, path: `/blog/${post.slug}` }]} /><BlogPostJsonLd post={post} /><MarketingShell><BlogPostContent post={post} /></MarketingShell></>;
}
