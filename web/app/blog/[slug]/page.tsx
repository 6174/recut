/*
 * [INPUT]: 依赖 Next 静态参数生成、notFound 与 marketing-site 文章目录/详情组件
 * [OUTPUT]: 对外提供每篇 recut.video/blog/:slug 与 localhost:3000/blog/:slug 的静态文章详情
 * [POS]: web/app/blog 的内容详情层；所有 slug 必须来自共享文章目录
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { notFound } from "next/navigation";
import { BlogPostContent, MarketingShell } from "@/components/marketing-site";
import { marketingPosts } from "@/lib/marketing-posts";

export function generateStaticParams() {
  return marketingPosts.map(({ slug }) => ({ slug }));
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = marketingPosts.find((item) => item.slug === slug);
  if (!post) notFound();
  return <MarketingShell><BlogPostContent post={post} /></MarketingShell>;
}
