/*
 * [INPUT]: 依赖 usePathname、lib/i18n（Locale/localizeURL/t）、lib/marketing-home 双语言数据、MDX 文章/App 正文（以 props 传入）、构建时的 Recut App URL 与浏览器当前 Host
 * [OUTPUT]: 对外提供官网 Header 与 Footer（均含语言切换）、按 Hero→核心应用→创作底座→三步开始→适合谁→对比→文章→FAQ→CTA 编排的 Landing、Docs 与 Blog 的共享展示组件；
 *           MarketingLocaleContext 供 client 组件读 locale；Blog 与 App 详情共用 MarkdownContent 渲染 MDX 正文并提供分享条；localhost 下的工作台链接统一指向同端口 app.localhost；
 *           官网内部导航一律用 <a> 全页跳转：营销浏览器 URL（无前缀 / /zh/ 前缀）与 Next 客户端路由树（/marketing/[locale]/…）不一致，<a> 保证每次导航都经 Worker/server.cjs 的正确重写
 * [POS]: web/components 的公开官网视觉层；服务 recut.video 与 localhost，不读取本地 service 或工作台状态；文章/应用数据一律由服务端页面经 props 注入，本文件不引入内容加载器
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { t, type Locale, localizeURL } from "@/lib/i18n";
import type { MarketingPost } from "@/lib/marketing-posts";
import type { DocPage } from "@/lib/docs";
import { HOME_FAQ, HOW_IT_WORKS } from "@/lib/marketing-home";
import { MarkdownContent } from "@/components/markdown-content";
import { trackEvent } from "@/components/posthog-analytics";

const defaultAppURL = process.env.NEXT_PUBLIC_RECUT_APP_URL ?? "https://app.recut.video";
const MarketingAppURLContext = createContext(defaultAppURL);

const MarketingLocaleContext = createContext<Locale>("en");

export function useMarketingLocale() {
  return useContext(MarketingLocaleContext);
}

// [locale]/layout.tsx 用它注入 locale 并设置 <html lang>；MarketingShell 内部同样兜底（client 路由时按路径判定）。
export function MarketingLocaleProvider({ children, locale }: { children: React.ReactNode; locale: Locale }) {
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh" : "en";
  }, [locale]);
  return <MarketingLocaleContext value={locale}>{children}</MarketingLocaleContext>;
}

function resolveLocaleFromPath(pathname: string | null): Locale {
  const publicPath = pathname?.replace(/^\/marketing\/(?:zh|en)(?=\/|$)/, "");
  return publicPath?.startsWith("/zh") ? "zh" : "en";
}

// 把内部静态壳路径（/marketing/<locale>/...，静态生成时 usePathname 返回的形态）转回公开路径；
// 浏览器环境 usePathname 本来就是公开路径（/ 或 /zh/...），原样返回。
function publicPath(pathname: string): string {
  const match = pathname.match(/^\/marketing\/(?:zh|en)(\/.*)?$/);
  if (match) return match[1] ?? "/";
  return pathname;
}

// localizeURL 逆运算：zh 页切英文去掉 /zh 前缀，en 页切中文加 /zh 前缀。
function localizedSwitchPath(pathname: string, to: Locale): string {
  const publicPathname = publicPath(pathname);
  const withoutPrefix = publicPathname.startsWith("/zh") ? publicPathname.slice("/zh".length) : publicPathname;
  // 尾斜杠归一化：server.cjs 重写时去尾斜杠、浏览器 URL 保留尾斜杠，统一去掉避免 hydration mismatch。
  const normalized = (withoutPrefix.startsWith("/") ? withoutPrefix : `/${withoutPrefix}`).replace(/\/+$/, "") || "/";
  return localizeURL(normalized, to);
}

function writeLocaleCookie(locale: Locale) {
  document.cookie = `recut_locale=${locale}; max-age=31536000; path=/`;
}

// 语言切换器先写 recut_locale cookie 再导航，避免被 Accept-Language 弹回原语言；用 <a> 强制整页导航让 Worker/Host 重新判定。
export function LocaleSwitchLink({ to, className }: { to: Locale; className?: string }) {
  const locale = useMarketingLocale();
  const pathname = usePathname() ?? "/";
  const href = localizedSwitchPath(pathname, to);
  const label = t("marketing", locale, to === "zh" ? "nav.switchToZh" : "nav.switchToEn");
  return (
    <a className={className} href={href} onClick={() => writeLocaleCookie(to)}>
      {label}
    </a>
  );
}

export function MarketingShell({ children, locale }: { children: React.ReactNode; locale?: Locale }) {
  const appURL = useAppURLForHost();
  const contextLocale = useMarketingLocale();
  const pathname = usePathname();
  const effective = locale ?? contextLocale ?? resolveLocaleFromPath(pathname);
  useEffect(() => {
    document.documentElement.lang = effective === "zh" ? "zh" : "en";
  }, [effective]);
  return (
    <MarketingAppURLContext value={appURL}>
      <MarketingLocaleContext value={effective}>
        <div className="min-h-screen bg-[oklch(0.985_0.004_150)] text-foreground">
          <MarketingHeader />
          <main>{children}</main>
          <MarketingFooter />
        </div>
      </MarketingLocaleContext>
    </MarketingAppURLContext>
  );
}

export function MarketingHeader() {
  const appURL = useMarketingAppURL();
  const locale = useMarketingLocale();
  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-5 px-5 sm:px-8">
<a aria-label={t("marketing", locale, "nav.ariaHome")} className="flex shrink-0 items-center gap-2.5" href={localizeURL("/", locale)}>
        <img alt="Recut" className="size-8 rounded-lg" height={424} src="/logo.jpg" width={404} />
        <span className="text-sm font-semibold tracking-tight">Recut</span>
        </a>
        <nav aria-label={t("marketing", locale, "nav.ariaMain")} className="hidden items-center gap-1 md:flex">
          <MarketingNav href={localizeURL("/#product", locale)}>{t("marketing", locale, "nav.product")}</MarketingNav>
          <MarketingNav href={localizeURL("/apps", locale)}>{t("marketing", locale, "nav.apps")}</MarketingNav>
          <MarketingNav href={localizeURL("/docs", locale)}>{t("marketing", locale, "nav.docs")}</MarketingNav>
          <MarketingNav href={localizeURL("/blog", locale)}>{t("marketing", locale, "nav.blog")}</MarketingNav>
          <a className="rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground" href="https://github.com/6174/recut" onClick={() => trackEvent("recut_external_clicked", { target: "github" })} rel="noreferrer" target="_blank">{t("marketing", locale, "nav.github")}</a>
          <LocaleSwitchLink className="rounded-md px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted" to={locale === "zh" ? "en" : "zh"} />
        </nav>
        <a className="inline-flex h-9 shrink-0 items-center rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/85" href={appURL} onClick={() => trackEvent("recut_workspace_clicked", { location: "header" })}>{t("marketing", locale, "nav.openWorkspace")} <span aria-hidden="true" className="ml-1">↗</span></a>
      </div>
    </header>
  );
}

function MarketingNav({ children, href }: { children: React.ReactNode; href: string }) {
  return <a className="rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground" href={href}>{children}</a>;
}

export function MarketingFooter() {
  const appURL = useMarketingAppURL();
  const locale = useMarketingLocale();
  const pathname = usePathname() ?? "/";
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 sm:px-8 md:grid-cols-[1fr_auto_auto]">
        <div>
          <div className="flex items-center gap-2">
            <img alt="" className="size-6 rounded-md" height={424} src="/logo.jpg" width={404} />
            <span className="text-sm font-semibold">Recut</span>
          </div>
          <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">{t("marketing", locale, "footer.tagline")}</p>
        </div>
        <FooterLinks title={t("marketing", locale, "footer.product")} links={[{ href: localizeURL("/#product", locale), label: t("marketing", locale, "nav.product") }, { href: localizeURL("/apps", locale), label: t("marketing", locale, "nav.apps") }, { href: localizeURL("/docs", locale), label: t("marketing", locale, "nav.docs") }, { href: appURL, label: t("marketing", locale, "footer.openWorkspace") }]} />
        <FooterLinks title={t("marketing", locale, "footer.resources")} links={[{ href: localizeURL("/blog", locale), label: t("marketing", locale, "nav.blog") }, { href: "https://github.com/6174/recut", label: t("marketing", locale, "footer.github") }]} />
      </div>
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 border-t px-5 py-5 sm:flex-row sm:px-8">
        <p className="text-sm font-semibold text-foreground">{t("marketing", locale, "footer.language")}</p>
        <div className="flex items-center gap-1 rounded-lg border bg-background p-1" role="group" aria-label={t("marketing", locale, "footer.language")}>
          {(["zh", "en"] as const).map((option) => {
            const active = option === locale;
            return (
              <a aria-current={active ? "true" : undefined} className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} href={localizedSwitchPath(pathname, option)} key={option} onClick={() => writeLocaleCookie(option)}>
                {t("marketing", locale, option === "zh" ? "nav.switchToZh" : "nav.switchToEn")}
              </a>
            );
          })}
        </div>
      </div>
      <div className="border-t px-5 py-4 text-center text-xs text-muted-foreground">{t("marketing", locale, "footer.copyright")}</div>
    </footer>
  );
}

function FooterLinks({ links, title }: { links: ReadonlyArray<{ href: string; label: string }>; title: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <ul className="mt-3 space-y-2">{links.map(({ href, label }) => <li key={label}><a className="text-sm text-muted-foreground transition hover:text-foreground" href={href}>{label}</a></li>)}</ul>
    </div>
  );
}

export function MarketingHero() {
  const appURL = useMarketingAppURL();
  const locale = useMarketingLocale();
  return (
    <section className="relative overflow-hidden border-b">
      <div aria-hidden="true" className="absolute -top-48 right-[-18rem] size-[38rem] rounded-full bg-primary/15 blur-3xl" />
      <div aria-hidden="true" className="absolute -bottom-64 left-1/4 size-[32rem] rounded-full bg-accent/75 blur-3xl" />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1fr_0.8fr] lg:items-center">
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">{t("marketing", locale, "hero.eyebrow")}</p>
          <h1 className="mt-5 text-5xl font-semibold leading-[1.03] tracking-[-0.045em] sm:text-6xl">{t("marketing", locale, "hero.title1")}<br /><span className="text-primary">{t("marketing", locale, "hero.title2")}</span></h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">{t("marketing", locale, "hero.tagline")}</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/85" href={appURL} onClick={() => trackEvent("recut_install_clicked", { location: "hero" })}>{t("marketing", locale, "hero.install")} <span aria-hidden="true" className="ml-1">↗</span></a>
            <a className="inline-flex h-11 items-center rounded-lg border bg-card px-5 text-sm font-semibold transition hover:bg-muted" href={localizeURL("/docs", locale)} onClick={() => trackEvent("recut_docs_clicked", { location: "hero" })}>{t("marketing", locale, "hero.readDocs")}</a>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">{t("marketing", locale, "hero.subtext")}</p>
        </div>
        <ProductPreview />
      </div>
    </section>
  );
}

export function MarketingLanding({ posts }: { posts: MarketingPost[] }) {
  return <><MarketingHero /><FeaturedApplications /><ProductSection /><HowItWorks /><AudienceSection /><CompareSection /><LatestPosts posts={posts} /><HomeFaqSection /><FinalCTA /></>;
}

function HowItWorks() {
  const locale = useMarketingLocale();
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
      <div className="max-w-2xl">
        <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">{t("marketing", locale, "how.eyebrow")}</p>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{t("marketing", locale, "how.title")}</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("marketing", locale, "how.tagline")}</p>
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-3">{HOW_IT_WORKS[locale].map(({ step, title, description }) => <div className="rounded-2xl border bg-card p-6" key={step}><span className="font-mono text-sm font-semibold text-primary">{step}</span><h3 className="mt-4 text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p></div>)}</div>
    </section>
  );
}

function AudienceSection() {
  const locale = useMarketingLocale();
  const items = [
    [t("marketing", locale, "audience.item1Title"), t("marketing", locale, "audience.item1Body"), localizeURL("/apps/recut.audio-studio", locale)],
    [t("marketing", locale, "audience.item2Title"), t("marketing", locale, "audience.item2Body"), localizeURL("/apps/recut.remotion-studio", locale)],
    [t("marketing", locale, "audience.item3Title"), t("marketing", locale, "audience.item3Body"), localizeURL("/blog/local-first-creative-workspace", locale)],
    [t("marketing", locale, "audience.item4Title"), t("marketing", locale, "audience.item4Body"), localizeURL("/apps", locale)],
  ] as const;
  return (
    <section className="border-y bg-card">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">{t("marketing", locale, "audience.eyebrow")}</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{t("marketing", locale, "audience.title")}</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("marketing", locale, "audience.tagline")}</p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{items.map(([title, description, href]) => <a className="group rounded-2xl border bg-background p-6 transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-sm" href={href} key={title}><h3 className="text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p><span className="mt-4 inline-flex text-sm font-semibold text-primary">{t("marketing", locale, "audience.learnMore")}</span></a>)}</div>
      </div>
    </section>
  );
}

function CompareSection() {
  const locale = useMarketingLocale();
  const rows = [
    [t("marketing", locale, "compare.row1a"), t("marketing", locale, "compare.row1b"), t("marketing", locale, "compare.row1c"), t("marketing", locale, "compare.row1d"), t("marketing", locale, "compare.row1e")],
    [t("marketing", locale, "compare.row2a"), t("marketing", locale, "compare.row2b"), t("marketing", locale, "compare.row2c"), t("marketing", locale, "compare.row2d"), t("marketing", locale, "compare.row2e")],
    [t("marketing", locale, "compare.row3a"), t("marketing", locale, "compare.row3b"), t("marketing", locale, "compare.row3c"), t("marketing", locale, "compare.row3d"), t("marketing", locale, "compare.row3e")],
    [t("marketing", locale, "compare.row4a"), t("marketing", locale, "compare.row4b"), t("marketing", locale, "compare.row4c"), t("marketing", locale, "compare.row4d"), t("marketing", locale, "compare.row4e")],
  ] as const;
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
      <div className="max-w-2xl">
        <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">{t("marketing", locale, "compare.eyebrow")}</p>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{t("marketing", locale, "compare.title")}</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("marketing", locale, "compare.tagline")}</p>
      </div>
      <div className="mt-10 overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead><tr className="border-b text-muted-foreground"><th className="p-4 font-semibold">{t("marketing", locale, "compare.headerDimension")}</th><th className="p-4 font-semibold text-primary">{t("marketing", locale, "compare.headerRecut")}</th><th className="p-4 font-semibold">{t("marketing", locale, "compare.headerJianying")}</th><th className="p-4 font-semibold">{t("marketing", locale, "compare.headerCloud")}</th><th className="p-4 font-semibold">{t("marketing", locale, "compare.headerPro")}</th></tr></thead>
          <tbody>{rows.map(([label, recut, jianying, cloud, pro]) => <tr className="border-b last:border-0" key={label}><td className="p-4 text-muted-foreground">{label}</td><td className="p-4 font-medium text-foreground">{recut}</td><td className="p-4">{jianying}</td><td className="p-4">{cloud}</td><td className="p-4">{pro}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{t("marketing", locale, "compare.footnote")}</p>
    </section>
  );
}

function HomeFaqSection() {
  const locale = useMarketingLocale();
  return (
    <section className="border-y bg-card">
      <div className="mx-auto max-w-4xl px-5 py-20 sm:px-8">
        <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">{t("marketing", locale, "faq.eyebrow")}</p>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{t("marketing", locale, "faq.title")}</h2>
        <div className="mt-10 grid gap-4">{HOME_FAQ[locale].map(({ question, answer }) => <div className="rounded-2xl border bg-background p-6" key={question}><h3 className="text-lg font-semibold">{question}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{answer}</p></div>)}</div>
      </div>
    </section>
  );
}

function ProductPreview() {
  const locale = useMarketingLocale();
  const items = [
    [t("marketing", locale, "preview.item1Title"), t("marketing", locale, "preview.item1Body")],
    [t("marketing", locale, "preview.item2Title"), t("marketing", locale, "preview.item2Body")],
    [t("marketing", locale, "preview.item3Title"), t("marketing", locale, "preview.item3Body")],
    [t("marketing", locale, "preview.item4Title"), t("marketing", locale, "preview.item4Body")],
  ] as const;
  return (
    <div className="rounded-2xl border border-primary/20 bg-card/85 p-4 shadow-[0_24px_70px_oklch(0.22_0.05_151_/_0.14)] backdrop-blur">
      <div className="flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">R</span>
          <span><span className="block text-sm font-semibold">{t("marketing", locale, "preview.workspace")}</span><span className="block text-[10px] tracking-[0.14em] text-muted-foreground">{t("marketing", locale, "preview.eyebrow")}</span></span>
        </div>
        <span className="rounded-full bg-primary/10 px-2 py-1 font-mono text-[9px] font-semibold text-primary">{t("marketing", locale, "preview.status")}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">{items.map(([title, description]) => <div className="rounded-xl border bg-background p-3.5" key={title}><span className="grid size-7 place-items-center rounded-lg bg-accent text-xs font-bold text-accent-foreground">✦</span><h3 className="mt-5 text-sm font-semibold">{title}</h3><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{description}</p></div>)}</div>
    </div>
  );
}

export function ProductSection() {
  const locale = useMarketingLocale();
  const values = [
    [t("marketing", locale, "product.value1Title"), t("marketing", locale, "product.value1Body"), localizeURL("/blog/local-first-creative-workspace", locale)],
    [t("marketing", locale, "product.value2Title"), t("marketing", locale, "product.value2Body"), "https://github.com/6174/recut"],
    [t("marketing", locale, "product.value3Title"), t("marketing", locale, "product.value3Body"), localizeURL("/blog/creative-tools-should-be-extensible", locale)],
  ] as const;
  return (
    <section className="border-y bg-card" id="product">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">{t("marketing", locale, "product.eyebrow")}</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{t("marketing", locale, "product.title1")}<br />{t("marketing", locale, "product.title2")}</h2>
          <p className="mt-5 max-w-sm text-sm leading-6 text-muted-foreground">{t("marketing", locale, "product.tagline")}</p>
        </div>
        <div className="grid gap-3">{values.map(([title, description, href], index) => <article className="grid gap-4 rounded-xl border bg-background p-5 sm:grid-cols-[3rem_1fr]" key={title}><span className="font-mono text-sm font-semibold text-primary">0{index + 1}</span><div><h3 className="text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p><a className="mt-3 inline-flex text-sm font-semibold text-primary" href={href}>{index === 1 ? t("marketing", locale, "product.seeGithub") : t("marketing", locale, "product.learnMore")} →</a></div></article>)}</div>
      </div>
    </section>
  );
}

function FeaturedApplications() {
  const appURL = useMarketingAppURL();
  const locale = useMarketingLocale();
  const apps = [
    [t("marketing", locale, "featured.item1Title"), t("marketing", locale, "featured.item1Body"), "TIMELINE", localizeURL("/apps", locale)],
    [t("marketing", locale, "featured.item2Title"), t("marketing", locale, "featured.item2Body"), "CONTEXT", ""],
    [t("marketing", locale, "featured.item3Title"), t("marketing", locale, "featured.item3Body"), "VOICE", localizeURL("/apps/recut.audio-studio", locale)],
    [t("marketing", locale, "featured.item4Title"), t("marketing", locale, "featured.item4Body"), "EXTEND", localizeURL("/apps", locale)],
  ] as const;
  return (
    <section aria-labelledby="featured-apps-title" className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">{t("marketing", locale, "featured.eyebrow")}</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl" id="featured-apps-title">{t("marketing", locale, "featured.title")}</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("marketing", locale, "featured.tagline")}</p>
        </div>
        <a className="text-sm font-semibold text-primary" href={`${appURL}/apps`}>{t("marketing", locale, "featured.browseApps")}</a>
      </div>
      <div className="mt-10 grid gap-3 md:grid-cols-2">{apps.map(([title, description, label, href], index) => { const card = <article className="group flex min-h-52 flex-col overflow-hidden rounded-2xl border bg-card p-5 transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[var(--shadow-overlay)]"><div className="flex items-center justify-between"><span className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">{label}</span><span className="grid size-8 place-items-center rounded-full border text-sm text-muted-foreground transition group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground">0{index + 1}</span></div><div className="mt-12"><h3 className="text-xl font-semibold">{title}</h3><p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p></div></article>; return href ? <a className="block" href={href} key={title}>{card}</a> : <div className="block" key={title}>{card}</div>; })}</div>
    </section>
  );
}

function TeamNote() {
  const locale = useMarketingLocale();
  return (
    <section className="border-y bg-[oklch(0.17_0.012_150)] text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[0.7fr_1.3fr]">
        <div>
          <span className="grid size-12 place-items-center rounded-xl bg-primary text-xl font-bold">R</span>
          <p className="mt-5 font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">{t("marketing", locale, "team.eyebrow")}</p>
        </div>
        <div>
          <h2 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{t("marketing", locale, "team.title1")}<br />{t("marketing", locale, "team.title2")}</h2>
          <p className="mt-6 max-w-2xl text-base leading-7 text-white/65">{t("marketing", locale, "team.body")}</p>
          <a className="mt-8 inline-flex text-sm font-semibold text-primary" href={localizeURL("/blog/local-first-creative-workspace", locale)}>{t("marketing", locale, "team.readMore")}</a>
        </div>
      </div>
    </section>
  );
}

function PostDate({ className, date }: { className?: string; date: string }) {
  const locale = useMarketingLocale();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const readableDate = match
    ? new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))))
    : date;
  return <time className={`block font-mono text-muted-foreground ${className ?? ""}`} dateTime={date}>{t("marketing", locale, "blog.published").replace("{date}", readableDate)}</time>;
}

function LatestPosts({ posts }: { posts: MarketingPost[] }) {
  const locale = useMarketingLocale();
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
      <div className="flex items-end justify-between gap-5">
        <div>
          <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">LATEST FROM RECUT</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{t("marketing", locale, "blog.title")}</h2>
        </div>
        <a className="hidden text-sm font-semibold text-primary sm:inline" href={localizeURL("/blog", locale)}>{t("marketing", locale, "blog.allPosts")}</a>
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-3">{posts.map((post) => <article className="flex min-h-60 flex-col rounded-2xl border bg-card p-5" key={post.slug}><PostDate className="text-[10px]" date={post.date} /><h3 className="mt-8 text-lg font-semibold leading-6"><a className="transition hover:text-primary" href={localizeURL(`/blog/${post.slug}`, locale)}>{post.title[locale]}</a></h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{post.description[locale]}</p><a className="mt-auto pt-6 text-sm font-semibold text-primary" href={localizeURL(`/blog/${post.slug}`, locale)}>{t("marketing", locale, "blog.continueReading")}</a></article>)}</div>
      <a className="mt-6 inline-flex text-sm font-semibold text-primary sm:hidden" href={localizeURL("/blog", locale)}>{t("marketing", locale, "blog.allPosts")}</a>
    </section>
  );
}

function FinalCTA() {
  const appURL = useMarketingAppURL();
  const locale = useMarketingLocale();
  return (
    <section className="border-t bg-primary text-primary-foreground">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 py-14 sm:px-8 md:flex-row md:items-center">
        <div>
          <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary-foreground/65">{t("marketing", locale, "cta.eyebrow")}</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">{t("marketing", locale, "cta.title")}</h2>
        </div>
        <a className="inline-flex h-11 items-center rounded-lg bg-card px-5 text-sm font-semibold text-foreground transition hover:bg-background" href={appURL} onClick={() => trackEvent("recut_install_clicked", { location: "final_cta" })}>{t("marketing", locale, "cta.install")} <span aria-hidden="true" className="ml-1">↗</span></a>
      </div>
    </section>
  );
}

export function DocsContent({ docs }: { docs: DocPage[] }) {
  const appURL = useMarketingAppURL();
  const locale = useMarketingLocale();
  const groups: Array<{ group: string; docs: DocPage[] }> = [];
  for (const doc of docs) {
    const last = groups[groups.length - 1];
    if (last && last.group === doc.group) last.docs.push(doc);
    else groups.push({ group: doc.group, docs: [doc] });
  }
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
      <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">{t("marketing", locale, "docs.eyebrow")}</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">{t("marketing", locale, "docs.title")}</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">{t("marketing", locale, "docs.tagline")}</p>
      <div className="mt-10 space-y-10">{groups.map(({ group, docs: groupDocs }) => <div key={group}><h2 className="text-sm font-semibold text-muted-foreground">{group}</h2><div className="mt-4 grid gap-4 md:grid-cols-2">{groupDocs.map((doc) => <article className="rounded-2xl border bg-card p-6 transition hover:border-primary/35 hover:shadow-sm" key={doc.slug}><h3 className="text-lg font-semibold"><a className="transition hover:text-primary" href={localizeURL(`/docs/${doc.slug}`, locale)}>{doc.title}</a></h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{doc.description}</p><div className="mt-4 flex items-center justify-between gap-3"><a className="text-sm font-semibold text-primary" href={localizeURL(`/docs/${doc.slug}`, locale)}>{t("marketing", locale, "docs.readMore")} →</a><a className="text-xs text-muted-foreground" href={appURL}>{t("marketing", locale, "docs.openInWorkspace")}</a></div></article>)}</div></div>)}</div>
    </section>
  );
}

export function DocContent({ doc }: { doc: DocPage }) {
  const appURL = useMarketingAppURL();
  const locale = useMarketingLocale();
  return <article className="mx-auto max-w-3xl px-5 py-16 sm:px-8"><a className="text-sm font-semibold text-primary" href={localizeURL("/docs", locale)}>← {t("marketing", locale, "docs.title")}</a><h1 className="mt-10 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{doc.title}</h1><p className="mt-6 text-lg leading-8 text-muted-foreground">{doc.description}</p><MarkdownContent content={doc.content} /><a className="mt-10 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/85" href={appURL}>{t("marketing", locale, "docs.openInWorkspace")}</a></article>;
}

export function BlogContent({ posts }: { posts: MarketingPost[] }) {
  const locale = useMarketingLocale();
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
      <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">{t("marketing", locale, "blog.eyebrow")}</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">{t("marketing", locale, "blog.title")}</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">{t("marketing", locale, "blog.tagline")}</p>
      <div className="mt-10 divide-y border-y">{posts.map((post) => <article className="grid gap-3 py-7 sm:grid-cols-[9rem_1fr_auto] sm:items-center" key={post.slug}><PostDate className="text-xs" date={post.date} /><div><h2 className="text-xl font-semibold"><a className="transition hover:text-primary" href={localizeURL(`/blog/${post.slug}`, locale)}>{post.title[locale]}</a></h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{post.description[locale]}</p></div><a aria-label={t("marketing", locale, "blog.readAria").replace("{title}", post.title[locale])} className="text-sm font-semibold text-primary" href={localizeURL(`/blog/${post.slug}`, locale)}>{t("marketing", locale, "blog.read")}</a></article>)}</div>
    </section>
  );
}

export function BlogPostContent({ post }: { post: MarketingPost }) {
  const appURL = useMarketingAppURL();
  const locale = useMarketingLocale();
  const title = post.title[locale];
  return (
    <article className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
      <a className="text-sm font-semibold text-primary" href={localizeURL("/blog", locale)}>{t("marketing", locale, "blog.backToAll")}</a>
      <PostDate className="mt-10 text-xs" date={post.date} />
      <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{title}</h1>
      <p className="mt-6 text-lg leading-8 text-muted-foreground">{post.description[locale]}</p>
      <MarkdownContent content={post.content[locale]} />
      <ShareActions title={title} urlPath={localizeURL(`/blog/${post.slug}`, locale)} />
      <a className="mt-10 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/85" href={appURL}>{t("marketing", locale, "blog.openWorkspace")}</a>
    </article>
  );
}

export function ShareActions({ title, urlPath }: { title: string; urlPath: string }) {
  const locale = useMarketingLocale();
  const [copied, setCopied] = useState(false);
  // urlPath 由父组件用 localizeURL 派生（服务端/客户端一致），不从 usePathname 推导，
  // 避免 SSR 的 /marketing/<locale>/ 内部路径经 publicPath 剥掉 locale 造成 hydration mismatch。
  const url = `https://recut.video${urlPath}`;
  const encode = encodeURIComponent;
  const links = [
    { label: "X", href: `https://twitter.com/intent/tweet?text=${encode(title)}&url=${encode(url)}` },
    { label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${encode(url)}` },
    { label: "Telegram", href: `https://t.me/share/url?url=${encode(url)}&text=${encode(title)}` },
    { label: t("marketing", locale, "share.weibo"), href: `https://service.weibo.com/share/share.php?url=${encode(url)}&title=${encode(title)}` },
  ];
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="mt-10 flex flex-wrap items-center gap-2 border-t pt-6">
      <span className="text-xs font-medium text-muted-foreground">{t("marketing", locale, "share.label")}</span>
      {links.map(({ href, label }) => <a className="inline-flex h-8 items-center rounded-md border bg-card px-3 text-xs font-medium text-muted-foreground transition hover:border-primary/35 hover:text-foreground" href={href} key={label} onClick={() => trackEvent("recut_share_clicked", { platform: label })} rel="noreferrer" target="_blank">{label}</a>)}
      <button className="inline-flex h-8 items-center rounded-md border bg-card px-3 text-xs font-medium text-muted-foreground transition hover:border-primary/35 hover:text-foreground" onClick={() => { trackEvent("recut_share_clicked", { platform: "copy_link" }); void copyLink(); }} type="button">{copied ? t("marketing", locale, "share.copied") : t("marketing", locale, "share.copyLink")}</button>
    </div>
  );
}

export function useMarketingAppURL() {
  return useContext(MarketingAppURLContext);
}

function useAppURLForHost() {
  const [appURL, setAppURL] = useState(defaultAppURL);
  useEffect(() => {
    if (window.location.hostname !== "localhost") return;
    setAppURL(`${window.location.protocol}//app.localhost${window.location.port ? `:${window.location.port}` : ""}`);
  }, []);
  return appURL;
}
