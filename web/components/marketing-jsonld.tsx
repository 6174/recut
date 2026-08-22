/*
 * [INPUT]: 依赖 lib/marketing-posts / lib/marketing-apps 双语言目录、lib/marketing-home 双语言 FAQ、lib/i18n（Locale/localizeURL/t）；无运行时状态
 * [OUTPUT]: 对外提供官网 JSON-LD 结构化数据的服务端组件：Organization、WebSite、SoftwareApplication、Blog 列表与 BlogPosting、BreadcrumbList；inLanguage 与 URL 逐语言，经 locale prop 传入
 * [POS]: web/components 的公开官网数据层；只在服务端页面渲染，禁止进入客户端组件子树（React 19 要求客户端 `<script>` 带 async）
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { marketingPosts, type MarketingPost } from "@/lib/marketing-posts";
import { appDescription, appName, marketingApps, type MarketingApp } from "@/lib/marketing-apps";
import { HOME_FAQ } from "@/lib/marketing-home";
import { localizeURL, t, type Locale } from "@/lib/i18n";

const SITE_URL = "https://recut.video";
const LOGO_URL = `${SITE_URL}/logo.jpg`;

function localizedURL(path: string, locale: Locale) {
  return `${SITE_URL}${localizeURL(path, locale)}`;
}

function inLanguage(locale: Locale) {
  return locale === "zh" ? "zh" : "en";
}

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

export function WebSiteJsonLd({ locale }: { locale: Locale }) {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Recut",
    url: localizedURL("/", locale),
    inLanguage: inLanguage(locale),
  }} />;
}

export function SoftwareApplicationJsonLd({ locale }: { locale: Locale }) {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Recut",
    url: localizedURL("/", locale),
    description: t("marketing", locale, "meta.landing.description"),
    applicationCategory: "MultimediaApplication",
    operatingSystem: "macOS, Windows",
    inLanguage: inLanguage(locale),
    installUrl: "https://app.recut.video/",
    isAccessibleForFree: true,
    featureList: [
      t("marketing", locale, "jsonld.feature1"),
      t("marketing", locale, "jsonld.feature2"),
      t("marketing", locale, "jsonld.feature3"),
      t("marketing", locale, "jsonld.feature4"),
      t("marketing", locale, "jsonld.feature5"),
    ],
    offers: { "@type": "Offer", price: 0, priceCurrency: "CNY" },
  }} />;
}

export function HomeFaqJsonLd({ locale }: { locale: Locale }) {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: HOME_FAQ[locale].map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  }} />;
}

export function AppSoftwareJsonLd({ app, locale }: { app: MarketingApp; locale: Locale }) {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: appName(app, locale),
    url: localizedURL(`/apps/${app.id}/`, locale),
    description: appDescription(app, locale),
    applicationCategory: app.type === "project" ? "VideoGame" : "UtilitiesApplication",
    operatingSystem: "macOS, Windows",
    inLanguage: inLanguage(locale),
    author: { "@type": "Organization", name: "Recut", url: SITE_URL },
    offers: { "@type": "Offer", price: 0, priceCurrency: "CNY" },
  }} />;
}

export function AppFaqJsonLd({ app, locale }: { app: MarketingApp; locale: Locale }) {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: app.faq[locale].map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  }} />;
}

export function MarketingAppsItemListJsonLd({ locale }: { locale: Locale }) {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: t("marketing", locale, "meta.apps.ogTitle"),
    itemListElement: marketingApps.map((app, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: appName(app, locale),
      url: localizedURL(`/apps/${app.id}/`, locale),
    })),
  }} />;
}

export function BlogListJsonLd({ locale }: { locale: Locale }) {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "Blog",
    name: t("marketing", locale, "meta.blog.ogTitle"),
    url: localizedURL("/blog", locale),
    inLanguage: inLanguage(locale),
    publisher: { "@type": "Organization", name: "Recut", url: SITE_URL, logo: { "@type": "ImageObject", url: LOGO_URL } },
    blogPost: marketingPosts.map((post) => ({
      "@type": "BlogPosting",
      headline: post.title[locale],
      description: post.description[locale],
      url: localizedURL(`/blog/${post.slug}`, locale),
      datePublished: post.date,
      author: { "@type": "Organization", name: "Recut", url: SITE_URL },
      image: LOGO_URL,
    })),
  }} />;
}

export function BlogPostJsonLd({ post, locale }: { post: MarketingPost; locale: Locale }) {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title[locale],
    description: post.description[locale],
    url: localizedURL(`/blog/${post.slug}`, locale),
    datePublished: post.date,
    inLanguage: inLanguage(locale),
    author: { "@type": "Organization", name: "Recut", url: SITE_URL },
    publisher: { "@type": "Organization", name: "Recut", url: SITE_URL, logo: { "@type": "ImageObject", url: LOGO_URL } },
    image: LOGO_URL,
    mainEntityOfPage: localizedURL(`/blog/${post.slug}`, locale),
  }} />;
}

export function BreadcrumbJsonLd({ items, locale }: { items: ReadonlyArray<{ name: string; path: string }>; locale: Locale }) {
  return <JsonLd data={{
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(({ name, path }, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
      item: localizedURL(path, locale),
    })),
  }} />;
}
