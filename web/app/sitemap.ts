/*
 * [INPUT]: 依赖 Next.js MetadataRoute 类型与 lib/marketing-posts 文章目录
 * [OUTPUT]: 对外提供 out/sitemap.xml：官网 Landing、Docs、Blog 列表与每篇文章，URL 全部收敛到 https://recut.video 裸域
 * [POS]: web/app 的官网索引清单；文章条目自动来自共享目录，新增文章无需改此处
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { MetadataRoute } from "next";
import { marketingPosts } from "@/lib/marketing-posts";
import { marketingApps } from "@/lib/marketing-apps";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const posts: MetadataRoute.Sitemap = marketingPosts.map((post) => ({
    url: `https://recut.video/blog/${post.slug}/`,
    lastModified: new Date(post.date),
    changeFrequency: "yearly",
    priority: 0.7,
  }));
  const apps: MetadataRoute.Sitemap = marketingApps.map((app) => ({
    url: `https://recut.video/apps/${app.id}/`,
    lastModified: new Date("2026-08-16"),
    changeFrequency: "monthly",
    priority: 0.8,
  }));
  return [
    { url: "https://recut.video/", lastModified: new Date("2026-08-16"), changeFrequency: "monthly", priority: 1 },
    { url: "https://recut.video/docs/", lastModified: new Date("2026-08-16"), changeFrequency: "monthly", priority: 0.8 },
    { url: "https://recut.video/apps/", lastModified: new Date("2026-08-16"), changeFrequency: "weekly", priority: 0.9 },
    { url: "https://recut.video/blog/", lastModified: new Date("2026-08-16"), changeFrequency: "weekly", priority: 0.8 },
    ...apps,
    ...posts,
  ];
}
