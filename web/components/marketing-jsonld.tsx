/*
 * [INPUT]: 依赖 lib/marketing-posts 文章目录；无运行时状态
 * [OUTPUT]: 对外提供官网 JSON-LD 结构化数据的服务端组件：Organization、WebSite、SoftwareApplication、Blog 列表与 BlogPosting、BreadcrumbList
 * [POS]: web/components 的公开官网数据层；只在服务端页面渲染，禁止进入客户端组件子树（React 19 要求客户端 `<script>` 带 async）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { marketingPosts, type MarketingPost } from "@/lib/marketing-posts";
import { marketingApps, type MarketingApp } from "@/lib/marketing-apps";
import { HOME_FAQ } from "@/lib/marketing-home";

const SITE_URL = "https://recut.video";
const LOGO_URL = `${SITE_URL}/logo.jpg`;

function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} type="application/ld+json" />;
}

export function OrganizationJsonLd() {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Recut",
    url: SITE_URL,
    logo: LOGO_URL,
    sameAs: ["https://github.com/6174/recut"],
  }} />;
}

export function WebSiteJsonLd() {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Recut",
    url: SITE_URL,
    inLanguage: "zh-CN",
  }} />;
}

export function SoftwareApplicationJsonLd() {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Recut",
    url: SITE_URL,
    description: "免费开源的本地 AI 视频剪辑与创作工作台：时间线剪辑、AI 生成、字幕配音与世界观都在你的电脑里运行，素材不上传、可离线使用，可用 JavaScript 扩展。",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "macOS, Linux, Windows, FreeBSD",
    inLanguage: "zh-CN",
    installUrl: "https://app.recut.video/",
    isAccessibleForFree: true,
    featureList: ["本地优先，素材不上传", "开源可审阅，可自部署", "时间线剪辑与 AI 生成", "本地字幕与 AI 配音", "用 JavaScript 扩展"],
    offers: { "@type": "Offer", price: 0, priceCurrency: "CNY" },
  }} />;
}

export function HomeFaqJsonLd() {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: HOME_FAQ.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  }} />;
}

export function AppSoftwareJsonLd({ app }: { app: MarketingApp }) {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: app.name,
    url: `${SITE_URL}/apps/${app.id}/`,
    description: app.description,
    applicationCategory: app.type === "project" ? "VideoGame" : "UtilitiesApplication",
    operatingSystem: "macOS, Linux, Windows, FreeBSD",
    inLanguage: "zh-CN",
    author: { "@type": "Organization", name: "Recut", url: SITE_URL },
    offers: { "@type": "Offer", price: 0, priceCurrency: "CNY" },
  }} />;
}

export function AppFaqJsonLd({ app }: { app: MarketingApp }) {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: app.faq.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  }} />;
}

export function MarketingAppsItemListJsonLd() {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Recut 应用",
    itemListElement: marketingApps.map((app, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: app.name,
      url: `${SITE_URL}/apps/${app.id}/`,
    })),
  }} />;
}

export function BlogListJsonLd() {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "Recut Blog",
    url: `${SITE_URL}/blog`,
    inLanguage: "zh-CN",
    publisher: { "@type": "Organization", name: "Recut", url: SITE_URL },
    blogPost: marketingPosts.map((post) => ({
      "@type": "BlogPosting",
      headline: post.title,
      description: post.description,
      url: `${SITE_URL}/blog/${post.slug}`,
      datePublished: post.date,
      author: { "@type": "Organization", name: "Recut", url: SITE_URL },
      image: LOGO_URL,
    })),
  }} />;
}

export function BlogPostJsonLd({ post }: { post: MarketingPost }) {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    url: `${SITE_URL}/blog/${post.slug}`,
    datePublished: post.date,
    inLanguage: "zh-CN",
    author: { "@type": "Organization", name: "Recut", url: SITE_URL },
    publisher: { "@type": "Organization", name: "Recut", url: SITE_URL },
    image: LOGO_URL,
    mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
  }} />;
}

export function BreadcrumbJsonLd({ items }: { items: ReadonlyArray<{ name: string; path: string }> }) {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(({ name, path }, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
      item: `${SITE_URL}${path}`,
    })),
  }} />;
}
