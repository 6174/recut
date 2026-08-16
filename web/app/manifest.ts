/*
 * [INPUT]: 依赖 Next.js MetadataRoute 类型与 public/ 图标产物
 * [OUTPUT]: 对外提供 out/manifest.webmanifest：移动端/浏览器书签的 Recut PWA 元数据与图标声明
 * [POS]: web/app 的 Web App Manifest 来源；不要求离线能力，仅声明启动与图标
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Recut",
    short_name: "Recut",
    description: "本地优先、可扩展的 AI 视频创作工作台。",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#34d399",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
