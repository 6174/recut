/*
 * [INPUT]: 依赖 Next.js MetadataRoute 类型、lib/i18n（locales/localizeURL）与 lib/marketing-posts / lib/marketing-apps 双语言目录
 * [OUTPUT]: 对外提供 out/sitemap.xml：逐语言遍历 locales，en 用无前缀 URL、zh 用 /zh/ 前缀 URL，覆盖 Landing/Docs/Apps/应用详情/Blog/文章，URL 收敛到 https://recut.video 裸域并带尾斜杠
 * [POS]: web/app 的官网索引清单；文章/应用条目自动来自共享目录，新增内容无需改此处
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import type { MetadataRoute } from "next";
import { locales, localizeURL, type Locale } from "@/lib/i18n";
import { marketingPosts } from "@/lib/marketing-posts";
import { marketingApps } from "@/lib/marketing-apps";
import { loadDocs } from "@/lib/docs";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const SITE_URL = "https://recut.video";
  const entries: MetadataRoute.Sitemap = [];
  for (const locale of locales) {
    const path = (p: string) => `${SITE_URL}${localizeURL(p, locale)}`;
    entries.push(
      { url: path("/"), lastModified: new Date("2026-08-16"), changeFrequency: "monthly", priority: 1 },
      { url: path("/docs/"), lastModified: new Date("2026-08-16"), changeFrequency: "monthly", priority: 0.8 },
      { url: path("/apps/"), lastModified: new Date("2026-08-16"), changeFrequency: "weekly", priority: 0.9 },
      { url: path("/blog/"), lastModified: new Date("2026-08-16"), changeFrequency: "weekly", priority: 0.8 },
    );
    for (const app of marketingApps) {
      entries.push({ url: path(`/apps/${app.id}/`), lastModified: new Date("2026-08-16"), changeFrequency: "monthly", priority: 0.8 });
    }
    for (const doc of loadDocs(locale as Locale)) {
      entries.push({ url: path(`/docs/${doc.slug}/`), lastModified: new Date("2026-08-16"), changeFrequency: "monthly", priority: 0.7 });
    }
    for (const post of marketingPosts) {
      entries.push({ url: path(`/blog/${post.slug}/`), lastModified: new Date(post.date), changeFrequency: "yearly", priority: 0.7 });
    }
  }
  return entries;
}
