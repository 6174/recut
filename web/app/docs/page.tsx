/*
 * [INPUT]: 依赖 marketing-site 的官网外壳与文档导航内容，以及 Marketing JSON-LD
 * [OUTPUT]: 对外提供 recut.video/docs 与 localhost:3000/docs 的静态 Docs 页面及面包屑结构化数据
 * [POS]: web/app/docs 的公开文档入口；不读取工作台 service
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata } from "next";
import { DocsContent, MarketingShell } from "@/components/marketing-site";
import { BreadcrumbJsonLd } from "@/components/marketing-jsonld";

export const metadata: Metadata = {
  title: "文档",
  description: "Recut 文档：安装本地 service，理解视频剪辑、世界观、授权语音和素材库如何协同，开发自己的 App，并在本地或局域网部署。",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://recut.video/docs" },
  openGraph: {
    type: "website",
    url: "https://recut.video/docs",
    title: "Recut 文档",
    description: "从第一支视频开始：安装、核心能力、App 开发与本地部署。",
    siteName: "Recut",
    locale: "zh_CN",
    images: [{ url: "https://recut.video/logo.jpg", width: 404, height: 424, alt: "Recut" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Recut 文档",
    description: "从第一支视频开始：安装、核心能力、App 开发与本地部署。",
    images: ["https://recut.video/logo.jpg"],
  },
};

export default function DocsPage() {
  return <><BreadcrumbJsonLd items={[{ name: "Recut", path: "/" }, { name: "文档", path: "/docs" }]} /><MarketingShell><DocsContent /></MarketingShell></>;
}
