/*
 * [INPUT]: 依赖 Next.js Metadata 类型和 app/globals.css 的全局样式
 * [OUTPUT]: 对外提供 Recut 工作台的根布局、页面元数据与品牌图标声明；官网默认不索引，Marketing 页面各自显式开启
 * [POS]: web/app 的框架根节点，被所有工作台页面共享；页面 Header 自行挂载统一的全局操作
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import { AgentPanelHost } from "@/components/agent-panel-host";
import { PosthogAnalytics } from "@/components/posthog-analytics";

export const viewport: Viewport = {
  themeColor: "#34d399",
};

export const metadata: Metadata = {
  title: { default: "Recut", template: "%s | Recut" },
  description: "本地优先、可扩展的 AI 视频创作工作台。剪辑、世界观、授权语音与生成式创作都在你的电脑里。",
  robots: { index: false, follow: false },
  alternates: { canonical: "https://recut.video/" },
  icons: { icon: "/icon.png", shortcut: "/icon.png", apple: "/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
  openGraph: {
    siteName: "Recut",
    locale: "zh_CN",
    type: "website",
    url: "https://recut.video/",
    title: "Recut",
    description: "本地优先、可扩展的 AI 视频创作工作台。",
    images: [{ url: "https://recut.video/logo.jpg", width: 404, height: 424, alt: "Recut" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Recut",
    description: "本地优先、可扩展的 AI 视频创作工作台。",
    images: ["https://recut.video/logo.jpg"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <Suspense fallback={null}>
          <PosthogAnalytics />
        </Suspense>
        <AgentPanelHost>{children}</AgentPanelHost>
      </body>
    </html>
  );
}
