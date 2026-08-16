/*
 * [INPUT]: 依赖 marketing-site 的官网外壳与文章目录，以及 Marketing JSON-LD
 * [OUTPUT]: 对外提供 recut.video/blog 与 localhost:3000/blog 的静态文章列表及 Blog 结构化数据
 * [POS]: web/app/blog 的公开内容目录；不读取工作台 service
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata } from "next";
import { BlogContent, MarketingShell } from "@/components/marketing-site";
import { BlogListJsonLd } from "@/components/marketing-jsonld";

export const metadata: Metadata = {
  title: "Blog",
  description: "关于创作，也关于工具。记录 Recut 如何构建本地优先、可扩展的 AI 视频创作环境。",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://recut.video/blog" },
  openGraph: {
    type: "website",
    url: "https://recut.video/blog",
    title: "Recut Blog",
    description: "关于创作，也关于工具。",
    siteName: "Recut",
    locale: "zh_CN",
    images: [{ url: "https://recut.video/logo.jpg", width: 404, height: 424, alt: "Recut" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Recut Blog",
    description: "关于创作，也关于工具。",
    images: ["https://recut.video/logo.jpg"],
  },
};

export default function BlogPage() {
  return <><BlogListJsonLd /><MarketingShell><BlogContent /></MarketingShell></>;
}
