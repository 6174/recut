/*
 * [INPUT]: 依赖 marketing-site 的 Locale 上下文（useMarketingLocale）、lib/i18n 字典与 lib/marketing-worlds 的静态数据（经 props 传入）
 * [OUTPUT]: 对外提供官网世界观展示层：MarketingWorldsSection（首页区块：封面图卡片网格）与 MarketingWorldsContent（/worlds 独立页：逐世界图文详情 + 实体设定摘要）
 * [POS]: web/components 的公开官网世界观层；数据一律由服务端页面构建期从 CDN 抓取后经 props 注入，本文件不发请求、不读取工作台状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import { useMarketingLocale, useMarketingAppURL } from "@/components/marketing-site";
import { t, localizeURL } from "@/lib/i18n";
import { trackEvent } from "@/components/posthog-analytics";
import type { MarketingWorld } from "@/lib/marketing-worlds";

export function MarketingWorldsSection({ worlds }: { worlds: MarketingWorld[] }) {
  const locale = useMarketingLocale();
  if (!worlds.length) return null;
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8" id="worlds">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">{t("marketing", locale, "worlds.eyebrow")}</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{t("marketing", locale, "worlds.section.title")}</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("marketing", locale, "worlds.section.tagline")}</p>
        </div>
        <a className="text-sm font-semibold text-primary" href={localizeURL("/worlds", locale)}>{t("marketing", locale, "worlds.viewAll")}</a>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {worlds.map((world) => <MarketingWorldCard key={world.id} world={world} locale={locale} href={localizeURL(`/worlds/${world.id}`, locale)} />)}
      </div>
    </section>
  );
}

function MarketingWorldCard({ world, locale, href }: { world: MarketingWorld; locale: "zh" | "en"; href: string }) {
  return (
    <a className="group block overflow-hidden rounded-2xl border bg-card transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[var(--shadow-overlay)]" href={href} onClick={() => trackEvent("recut_worlds_clicked", { world_id: world.id, location: "home_section" })}>
      {world.coverUrl
        ? <img alt={world.name} className="h-40 w-full border-b bg-muted object-cover" height={320} loading="lazy" src={world.coverUrl} width={480} />
        : <div className="h-40 w-full border-b bg-muted" />}
      <div className="flex flex-col p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-lg font-semibold transition group-hover:text-primary">{world.name}</h3>
          <span className="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">{worldTypeLabel(world.type, locale)}</span>
        </div>
        {world.positioning && <p className="mt-2 text-xs font-medium text-foreground/70">{world.positioning}</p>}
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{world.description}</p>
      </div>
    </a>
  );
}

export function MarketingWorldsContent({ worlds }: { worlds: MarketingWorld[] }) {
  const locale = useMarketingLocale();
  return (
    <div className="mx-auto max-w-6xl px-5 pb-16 pt-24 sm:px-8 sm:pt-28">
      <div className="max-w-3xl">
        <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">{t("marketing", locale, "worlds.eyebrow")}</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">{t("marketing", locale, "worlds.title")}</h1>
        <p className="mt-4 text-base leading-7 text-muted-foreground">{t("marketing", locale, "worlds.tagline")}</p>
      </div>
      {worlds.length === 0 && <p className="mt-12 rounded-2xl border bg-card p-8 text-sm text-muted-foreground">{t("marketing", locale, "worlds.empty")}</p>}
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {worlds.map((world) => <MarketingWorldCard key={world.id} world={world} locale={locale} href={localizeURL(`/worlds/${world.id}`, locale)} />)}
      </div>
    </div>
  );
}

export function MarketingWorldDetailContent({ world }: { world: MarketingWorld }) {
  const locale = useMarketingLocale();
  const appURL = useMarketingAppURL();
  return (
    <div className="mx-auto max-w-6xl px-5 pb-16 pt-24 sm:px-8 sm:pt-28">
      <a className="text-sm font-semibold text-primary" href={localizeURL("/worlds", locale)}>← {t("marketing", locale, "worlds.title")}</a>
      <article className="mt-8">
        <div className="flex items-center gap-3">
          <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">{t("marketing", locale, "worlds.eyebrow")}</p>
          <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 font-mono text-[10px] text-primary">{worldTypeLabel(world.type, locale)}</span>
        </div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{world.name}</h1>
        {world.positioning && <p className="mt-4 max-w-3xl text-base font-medium text-foreground/80">{world.positioning}</p>}
        <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">{world.description}</p>
        {world.tone && <p className="mt-4 text-sm leading-6 text-muted-foreground"><span className="font-semibold text-foreground/80">{t("marketing", locale, "worlds.detail.tone")}</span>{world.tone}</p>}
        {world.audience.length > 0 && <p className="mt-3 text-sm leading-6 text-muted-foreground"><span className="font-semibold text-foreground/80">{t("marketing", locale, "worlds.detail.audience")}</span>{world.audience.join(locale === "zh" ? "、" : ", ")}</p>}
        <a className="mt-6 inline-flex h-10 items-center rounded-lg border bg-card px-4 text-sm font-semibold transition hover:border-primary/35 hover:text-foreground" href={`${appURL}/worlds`} onClick={() => trackEvent("recut_workspace_clicked", { location: "world_detail", world_id: world.id })}>{t("marketing", locale, "worlds.openInWorkspace")} <span aria-hidden="true" className="ml-1">↗</span></a>
      </article>
      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        {world.images.map((url) => <img alt={world.name} className="w-full rounded-xl border bg-muted object-cover" height={480} loading="lazy" key={url} src={url} width={640} />)}
      </div>
      {world.entities.length > 0 && (
        <div className="mt-10 grid gap-3 md:grid-cols-2">
          {world.entities.map((entity) => (
            <div className="rounded-xl border bg-card p-4" key={entity.id || entity.title}>
              <div className="flex items-center gap-2">
                <span className="rounded-sm border bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">{entityKindLabel(entity.kind, locale)}</span>
                <h3 className="text-sm font-semibold">{entity.title}</h3>
              </div>
              {entity.summary && <p className="mt-2 line-clamp-4 text-xs leading-5 text-muted-foreground">{entity.summary}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MarketingWorldDetail({ world, locale, appURL }: { world: MarketingWorld; locale: "zh" | "en"; appURL: string }) {
  return (
    <article id={world.id} className="border-t pt-10 first:border-t-0 first:pt-0">
      <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="order-2 grid gap-3 sm:grid-cols-2 lg:order-1">
          {world.images.slice(0, 4).map((url) => <img alt={world.name} className="w-full rounded-xl border bg-muted object-cover" height={480} loading="lazy" key={url} src={url} width={480} />)}
        </div>
        <div className="order-1 lg:order-2">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{world.name}</h2>
            <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 font-mono text-[10px] text-primary">{worldTypeLabel(world.type, locale)}</span>
          </div>
          {world.positioning && <p className="mt-4 text-sm font-medium text-foreground/80">{world.positioning}</p>}
          <p className="mt-4 text-sm leading-7 text-muted-foreground">{world.description}</p>
          {world.tone && <p className="mt-4 text-sm leading-6 text-muted-foreground"><span className="font-semibold text-foreground/80">{t("marketing", locale, "worlds.detail.tone")}</span>{world.tone}</p>}
          {world.audience.length > 0 && <p className="mt-3 text-sm leading-6 text-muted-foreground"><span className="font-semibold text-foreground/80">{t("marketing", locale, "worlds.detail.audience")}</span>{world.audience.join(locale === "zh" ? "、" : ", ")}</p>}
          <a className="mt-6 inline-flex h-10 items-center rounded-lg border bg-card px-4 text-sm font-semibold transition hover:border-primary/35 hover:text-foreground" href={`${appURL}/worlds`} onClick={() => trackEvent("recut_workspace_clicked", { location: "worlds_page", world_id: world.id })}>{t("marketing", locale, "worlds.openInWorkspace")} <span aria-hidden="true" className="ml-1">↗</span></a>
        </div>
      </div>
      {world.entities.length > 0 && (
        <div className="mt-8 grid gap-3 md:grid-cols-2">
          {world.entities.map((entity) => (
            <div className="rounded-xl border bg-card p-4" key={entity.id || entity.title}>
              <div className="flex items-center gap-2">
                <span className="rounded-sm border bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">{entityKindLabel(entity.kind, locale)}</span>
                <h3 className="text-sm font-semibold">{entity.title}</h3>
              </div>
              {entity.summary && <p className="mt-2 line-clamp-4 text-xs leading-5 text-muted-foreground">{entity.summary}</p>}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function worldTypeLabel(type: string, locale: "zh" | "en"): string {
  const key = `worlds.type.${type}`;
  const label = t("marketing", locale, key);
  return label === key ? type : label;
}

function entityKindLabel(kind: string, locale: "zh" | "en"): string {
  const key = `worlds.entity.${kind}`;
  const label = t("marketing", locale, key);
  return label === key ? kind : label;
}
