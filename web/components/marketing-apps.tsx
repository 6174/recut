/*
 * [INPUT]: 依赖 MDX App 数据（经 props 传入）、marketing-site 的 App URL 与 Locale 上下文、lib/i18n 字典、共享 MarkdownContent
 * [OUTPUT]: 对外提供官网 /apps 的应用市场目录与 /apps/:appID 的公开 App SEO 落地页；App 展示字段按 MarketingLocaleContext 取双语言数据；详情用 MDX 正文渲染，附加 frontmatter 中的 FAQ/设备要求/相关应用内链；官网内部导航一律用 <a> 全页跳转（营销 URL 不在 Next 客户端路由树内）
 * [POS]: web/components 的公开官网应用层；App 数据一律由服务端页面经 props 注入，本文件不引入内容加载器，也不读取工作台 Catalog 或本地 service 安装状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useMarketingLocale, useMarketingAppURL } from "@/components/marketing-site";
import { t, type Locale, localizeURL } from "@/lib/i18n";
import type { MarketingApp } from "@/lib/marketing-apps";
import { MarkdownContent } from "@/components/markdown-content";
import { trackEvent } from "@/components/posthog-analytics";

// 与 lib/marketing-apps 的访问器同名同义；组件是 client，不能导入含 node:fs 的加载器模块。
function appName(app: MarketingApp, locale: Locale): string {
  return app.name[locale] ?? app.name.en;
}
function appTagline(app: MarketingApp, locale: Locale): string {
  return app.tagline[locale] ?? app.tagline.en;
}
function appFaq(app: MarketingApp, locale: Locale): MarketingApp["faq"]["en"] {
  return app.faq[locale] ?? app.faq.en;
}
function appBody(app: MarketingApp, locale: Locale): string {
  return app.body[locale] ?? app.body.en;
}
type AppRequirements = { title: string; items: string[]; note?: string };
function appRequirements(app: MarketingApp, locale: Locale): AppRequirements | undefined {
  return app.requirements?.[locale] ?? app.requirements?.en;
}

export function MarketingAppsContent({ apps }: { apps: MarketingApp[] }) {
  const locale = useMarketingLocale();
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
      <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">{t("marketing", locale, "apps.eyebrow")}</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">{t("marketing", locale, "apps.title")}</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">{t("marketing", locale, "apps.tagline")}</p>
      <div className="mt-10 grid gap-4 md:grid-cols-2">{apps.map((app) => { const name = appName(app, locale); return (
        <article className="flex min-h-56 flex-col rounded-2xl border bg-card p-6 transition hover:border-primary/35 hover:shadow-sm" key={app.id}>
          <p className="font-mono text-[10px] font-semibold tracking-[0.15em] text-primary">{app.type === "project" ? "PROJECT APP" : "STANDALONE APP"}</p>
          <h2 className="mt-4 text-xl font-semibold"><a className="transition hover:text-primary" href={localizeURL(`/apps/${encodeURIComponent(app.id)}`, locale)}>{name}</a></h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{appTagline(app, locale)}</p>
          <div className="mt-auto flex items-center justify-between gap-3 pt-6">
            <span className="text-xs text-muted-foreground">{app.type === "project" ? t("marketing", locale, "apps.projectApp") : t("marketing", locale, "apps.standaloneApp")}</span>
            <a className="inline-flex items-center gap-1 text-sm font-semibold text-primary" href={localizeURL(`/apps/${encodeURIComponent(app.id)}`, locale)}>{t("marketing", locale, "apps.learnMore").replace("{name}", name)}</a>
          </div>
          {app.requirements && <p className="mt-3 rounded-lg border border-warning/35 bg-warning/5 px-3 py-2 text-xs leading-5 text-muted-foreground">{t("marketing", locale, "apps.requirementsNote")}</p>}
        </article>
      ); })}</div>
    </section>
  );
}

export function MarketingAppDetailContent({ app, related }: { app: MarketingApp; related: MarketingApp[] }) {
  const appURL = useMarketingAppURL();
  const locale = useMarketingLocale();
  const name = appName(app, locale);
  const detailURL = `${appURL}/apps/${encodeURIComponent(app.id)}`;
  const repoURL = app.repository?.replace(/\.git$/, "");
  const faq = appFaq(app, locale);
  const requirements = appRequirements(app, locale);
  return (
    <article className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
      <a className="text-sm font-semibold text-primary" href={localizeURL("/apps", locale)}>{t("marketing", locale, "apps.backToAll")}</a>
      <p className="mt-10 font-mono text-xs text-muted-foreground">{app.type === "project" ? t("marketing", locale, "apps.projectApp") : t("marketing", locale, "apps.standaloneApp")}</p>
      <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{name}</h1>
      <p className="mt-6 text-lg leading-8 text-muted-foreground">{appTagline(app, locale)}</p>
      <MarkdownContent content={appBody(app, locale)} />
      {faq.length > 0 && <section className="mt-12 border-t pt-8"><h2 className="text-2xl font-semibold tracking-tight">{t("marketing", locale, "apps.faqTitle")}</h2><div className="mt-4 space-y-4">{faq.map(({ question, answer }) => <div className="rounded-xl border bg-card p-5" key={question}><h3 className="text-base font-semibold">{question}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{answer}</p></div>)}</div></section>}
      {requirements && <div className="mt-12 rounded-xl border border-warning/35 bg-warning/5 p-5"><h2 className="text-sm font-semibold">{requirements.title}</h2><ul className="mt-3 space-y-2">{requirements.items.map((item) => <li className="pl-1 text-sm leading-6 text-muted-foreground" key={item}>· {item}</li>)}</ul>{requirements.note && <p className="mt-3 text-xs leading-5 text-muted-foreground">{requirements.note}</p>}</div>}
      <div className="mt-10 flex flex-wrap gap-3">
        <a className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/85" href={detailURL} onClick={() => trackEvent("recut_workspace_clicked", { location: "app_detail", app_id: app.id })}>{t("marketing", locale, "apps.openInWorkspace").replace("{name}", name)}</a>
        {repoURL && <a className="inline-flex h-11 items-center rounded-lg border bg-card px-5 text-sm font-semibold transition hover:bg-muted" href={repoURL} onClick={() => trackEvent("recut_external_clicked", { target: "app_repo", app_id: app.id })} rel="noreferrer" target="_blank">{t("marketing", locale, "apps.viewSource")}</a>}
      </div>
      {related.length > 0 && <div className="mt-10 border-t pt-8"><h2 className="text-sm font-semibold">{t("marketing", locale, "apps.learnMoreRelated")}</h2><div className="mt-3 flex flex-wrap gap-2">{related.map((item) => <a className="inline-flex items-center gap-1 rounded-lg border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-primary/35 hover:text-foreground" href={localizeURL(`/apps/${encodeURIComponent(item.id)}`, locale)} key={item.id}>{appName(item, locale)} →</a>)}</div></div>}
    </article>
  );
}
