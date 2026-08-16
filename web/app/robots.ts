/*
 * [INPUT]: 依赖 Next.js MetadataRoute 类型
 * [OUTPUT]: 对外提供 out/robots.txt：允许官网公开路径，Disallow 工作台与内部壳路径，并声明 sitemap
 * [POS]: web/app 的抓取边界声明；工作台路径同时由根布局 noindex 兜底，此处是纵深防御
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/marketing", "/appstore", "/projects", "/worlds", "/media", "/workspace-app"],
      },
    ],
    sitemap: "https://recut.video/sitemap.xml",
  };
}
