/*
 * [INPUT]: 依赖 marketing-site 的完整官网 Landing 编排与 Marketing JSON-LD
 * [OUTPUT]: 对外提供 recut.video 根路径的 Hero、核心应用、创作底座、团队主张、文章与 CTA Landing 页面，及 Organization/WebSite/SoftwareApplication 结构化数据
 * [POS]: web/app/marketing 的官网首页；仅经 Cloudflare Worker 的 Host 路由对外暴露为 `/`
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata } from "next";
import { MarketingLanding, MarketingShell } from "@/components/marketing-site";
import { HomeFaqJsonLd, MarketingAppsItemListJsonLd, OrganizationJsonLd, SoftwareApplicationJsonLd, WebSiteJsonLd } from "@/components/marketing-jsonld";

export const metadata: Metadata = {
  title: "免费开源的本地 AI 视频剪辑软件，素材不上传",
  description: "免费开源的本地 AI 视频剪辑软件：时间线剪辑、AI 短片、字幕配音与角色世界观都在你的电脑里运行，素材不上传、可离线使用，支持 macOS、Linux、Windows 与 FreeBSD。",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://recut.video/" },
  openGraph: {
    type: "website",
    url: "https://recut.video/",
    title: "Recut — 免费开源的本地 AI 视频剪辑软件",
    description: "时间线剪辑、AI 短片、字幕配音都在你的电脑里运行，素材不上传、可离线使用，可用 App 持续扩展。",
    siteName: "Recut",
    locale: "zh_CN",
    images: [{ url: "https://recut.video/logo.jpg", width: 404, height: 424, alt: "Recut" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Recut — 免费开源的本地 AI 视频剪辑软件",
    description: "时间线剪辑、AI 短片、字幕配音都在你的电脑里运行，素材不上传、可离线使用。",
    images: ["https://recut.video/logo.jpg"],
  },
};

export default function MarketingHomePage() {
  return <><OrganizationJsonLd /><WebSiteJsonLd /><SoftwareApplicationJsonLd /><MarketingAppsItemListJsonLd /><HomeFaqJsonLd /><MarketingShell><MarketingLanding /></MarketingShell></>;
}
