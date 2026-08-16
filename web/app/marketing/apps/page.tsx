/*
 * [INPUT]: 依赖 marketing-site 的官网外壳、marketing-apps 的应用目录内容与 Marketing JSON-LD
 * [OUTPUT]: 对外提供 recut.video/apps 的公开应用市场目录（Worker 从 Marketing Host 映射到 /marketing/apps/）
 * [POS]: web/app/marketing/apps 的公开应用目录；区别于 app host 的 `/apps` 工作台目录，只读 Catalog 静态数据
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing-site";
import { MarketingAppsContent } from "@/components/marketing-apps";
import { MarketingAppsItemListJsonLd } from "@/components/marketing-jsonld";

export const metadata: Metadata = {
  title: "应用",
  description: "Recut 应用：AI 短片、Remotion 视频、声音工坊、封面生成与深度图。每个 App 都在本地工作台中运行，可安装、可替换、可扩展。",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://recut.video/apps/" },
  openGraph: {
    type: "website",
    url: "https://recut.video/apps/",
    title: "Recut 应用",
    description: "可扩展的本地创作能力：AI 短片、Remotion 视频、声音工坊、封面生成与深度图。",
    siteName: "Recut",
    locale: "zh_CN",
    images: [{ url: "https://recut.video/logo.jpg", width: 404, height: 424, alt: "Recut" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Recut 应用",
    description: "可扩展的本地创作能力：AI 短片、Remotion 视频、声音工坊、封面生成与深度图。",
    images: ["https://recut.video/logo.jpg"],
  },
};

export default function MarketingAppsPage() {
  return <><MarketingAppsItemListJsonLd /><MarketingShell><MarketingAppsContent /></MarketingShell></>;
}
