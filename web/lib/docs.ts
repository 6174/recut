/*
 * [INPUT]: 依赖 node:fs / node:path 与 gray-matter，读取 content/docs/<locale>/*.mdx
 * [OUTPUT]: 对外提供官网 Docs 的静态文档目录：frontmatter（title/description/order）+ markdown 正文，按 order 排序
 * [POS]: web/lib 的公开文档加载器；只在服务端模块（页面、sitemap）导入，客户端组件经 props 接收数据；zh/en 文档都在 MDX，locale 由路由参数决定
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { type Locale } from "@/lib/i18n/locales";

export type DocPage = {
  locale: Locale;
  slug: string;
  title: string;
  description: string;
  group: string;
  order: number;
  content: string;
};

function docsDir(locale: string) {
  return path.join(process.cwd(), "content", "docs", locale);
}

function readDoc(file: string, locale: Locale): DocPage {
  const raw = fs.readFileSync(file, "utf8");
  const { data, content } = matter(raw);
  return {
    locale,
    slug: path.basename(file, ".mdx"),
    title: String(data.title ?? ""),
    description: String(data.description ?? ""),
    group: String(data.group ?? ""),
    order: Number(data.order ?? 100),
    content: content.trim(),
  };
}

export function loadDocs(locale: Locale): DocPage[] {
  const dir = docsDir(locale);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => readDoc(path.join(dir, file), locale))
    .sort((a, b) => a.order - b.order);
}

export function getDoc(slug: string, locale: Locale): DocPage | null {
  const file = path.join(docsDir(locale), `${slug}.mdx`);
  if (!fs.existsSync(file)) return null;
  return readDoc(file, locale);
}
