/*
 * [INPUT]: 依赖 Next Link/usePathname、lib/marketing-posts 静态文章目录、构建时的 Recut App URL 与浏览器当前 Host
 * [OUTPUT]: 对外提供官网 Header、Footer、按 Hero→核心应用→创作底座→团队主张→文章→CTA 编排的 Landing、Docs 与 Blog 的共享展示组件；
 *           Blog 详情渲染唯一 markdown 正文并提供 X/LinkedIn/Telegram/微博/复制链接分享条；localhost 下的工作台链接统一指向同端口 app.localhost
 * [POS]: web/components 的公开官网视觉层；服务 recut.video 与 localhost，不读取本地 service 或工作台状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { marketingPosts, type MarketingPost } from "@/lib/marketing-posts";
import { HOME_FAQ, HOW_IT_WORKS } from "@/lib/marketing-home";
import { trackEvent } from "@/components/posthog-analytics";

const defaultAppURL = process.env.NEXT_PUBLIC_RECUT_APP_URL ?? "https://app.recut.video";
const MarketingAppURLContext = createContext(defaultAppURL);

export function MarketingShell({ children }: { children: React.ReactNode }) {
  const appURL = useAppURLForHost();
  return <MarketingAppURLContext value={appURL}><div className="min-h-screen bg-[oklch(0.985_0.004_150)] text-foreground"><MarketingHeader /><main>{children}</main><MarketingFooter /></div></MarketingAppURLContext>;
}

export function MarketingHeader() {
  const appURL = useMarketingAppURL();
  return <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur"><div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-5 px-5 sm:px-8"><Link aria-label="Recut 首页" className="flex shrink-0 items-center gap-2.5" href="/"><img alt="Recut" className="size-8 rounded-lg" height={424} src="/logo.jpg" width={404} /><span className="text-sm font-semibold tracking-tight">Recut</span></Link><nav aria-label="官网导航" className="hidden items-center gap-1 md:flex"><MarketingNav href="/#product">产品</MarketingNav><MarketingNav href="/apps">应用</MarketingNav><MarketingNav href="/docs">Docs</MarketingNav><MarketingNav href="/blog">Blog</MarketingNav><a className="rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground" href="https://github.com/6174/recut" onClick={() => trackEvent("recut_external_clicked", { target: "github" })} rel="noreferrer" target="_blank">GitHub ↗</a></nav><a className="inline-flex h-9 shrink-0 items-center rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/85" href={appURL} onClick={() => trackEvent("recut_workspace_clicked", { location: "header" })}>打开工作台 <span aria-hidden="true" className="ml-1">↗</span></a></div></header>;
}

function MarketingNav({ children, href }: { children: React.ReactNode; href: string }) {
  return <Link className="rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground" href={href}>{children}</Link>;
}

export function MarketingFooter() {
  const appURL = useMarketingAppURL();
  return <footer className="border-t bg-card"><div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 sm:px-8 md:grid-cols-[1fr_auto_auto]"><div><div className="flex items-center gap-2"><img alt="" className="size-6 rounded-md" height={424} src="/logo.jpg" width={404} /><span className="text-sm font-semibold">Recut</span></div><p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">本地优先、可扩展的 AI 视频创作工作台。</p></div><FooterLinks title="产品" links={[{ href: "/#product", label: "产品" }, { href: "/apps", label: "应用" }, { href: "/docs", label: "Docs" }, { href: appURL, label: "打开工作台" }]} /><FooterLinks title="资源" links={[{ href: "/blog", label: "Blog" }, { href: "https://github.com/6174/recut", label: "GitHub" }]} /></div><div className="border-t px-5 py-4 text-center text-xs text-muted-foreground">© 2026 Recut. Open source, local first.</div></footer>;
}

function FooterLinks({ links, title }: { links: ReadonlyArray<{ href: string; label: string }>; title: string }) {
  return <div><h2 className="text-sm font-semibold">{title}</h2><ul className="mt-3 space-y-2">{links.map(({ href, label }) => <li key={label}><a className="text-sm text-muted-foreground transition hover:text-foreground" href={href}>{label}</a></li>)}</ul></div>;
}

export function MarketingHero() {
  const appURL = useMarketingAppURL();
  return <section className="relative overflow-hidden border-b"><div aria-hidden="true" className="absolute -top-48 right-[-18rem] size-[38rem] rounded-full bg-primary/15 blur-3xl" /><div aria-hidden="true" className="absolute -bottom-64 left-1/4 size-[32rem] rounded-full bg-accent/75 blur-3xl" /><div className="relative mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1fr_0.8fr] lg:items-center"><div className="max-w-3xl"><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">LOCAL CREATIVE OS</p><h1 className="mt-5 text-5xl font-semibold leading-[1.03] tracking-[-0.045em] sm:text-6xl">让 AI 视频剪辑与创作，<br /><span className="text-primary">留在你的电脑里。</span></h1><p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">Recut 是免费开源的本地 AI 视频剪辑与创作工作台：时间线剪辑、AI 短片、字幕配音与世界观都在你的电脑里运行，素材不上传、可离线使用，还能用 App 持续扩展。</p><div className="mt-9 flex flex-wrap gap-3"><a className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/85" href={appURL} onClick={() => trackEvent("recut_install_clicked", { location: "hero" })}>安装 Recut <span aria-hidden="true" className="ml-1">↗</span></a><Link className="inline-flex h-11 items-center rounded-lg border bg-card px-5 text-sm font-semibold transition hover:bg-muted" href="/docs" onClick={() => trackEvent("recut_docs_clicked", { location: "hero" })}>阅读 Docs</Link></div><p className="mt-4 text-xs text-muted-foreground">免费开源 · 本地运行 · 素材不上传 · 通过 App 持续扩展</p></div><ProductPreview /></div></section>;
}

export function MarketingLanding() {
  return <><MarketingHero /><FeaturedApplications /><ProductSection /><HowItWorks /><AudienceSection /><CompareSection /><LatestPosts /><HomeFaqSection /><FinalCTA /></>;
}

function HowItWorks() {
  return <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8"><div className="max-w-2xl"><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">HOW IT WORKS</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">三步开始本地 AI 视频剪辑。</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">安装 → 导入素材 → 生成与导出，全过程在你的电脑里完成，断网也能继续。</p></div><div className="mt-10 grid gap-4 md:grid-cols-3">{HOW_IT_WORKS.map(({ step, title, description }) => <div className="rounded-2xl border bg-card p-6" key={step}><span className="font-mono text-sm font-semibold text-primary">{step}</span><h3 className="mt-4 text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p></div>)}</div></section>;
}

function AudienceSection() {
  const items = [["口播与知识类创作者", "本地字幕、AI 配音与剪口播，素材不出设备。", "/apps/recut.audio-studio"], ["系列化内容团队", "Worlds 保持角色与场景一致，模板化批量出片。", "/apps/recut.remotion-studio"], ["隐私敏感的企业", "素材、项目与凭据都留在受控的基础设施里。", "/blog/local-first-creative-workspace"], ["开发者", "用 JavaScript 编写自己的 App，接入模型与工具。", "/apps"]] as const;
  return <section className="border-y bg-card"><div className="mx-auto max-w-6xl px-5 py-20 sm:px-8"><div className="max-w-2xl"><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">WHO IT'S FOR</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Recut 适合每天产出视频的创作者与团队。</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">口播与课程需要字幕配音，系列内容需要角色一致，企业需要素材不出设备，开发者需要可编程的工作台。</p></div><div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{items.map(([title, description, href]) => <Link className="group rounded-2xl border bg-background p-6 transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-sm" href={href} key={title}><h3 className="text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p><span className="mt-4 inline-flex text-sm font-semibold text-primary">了解 →</span></Link>)}</div></div></section>;
}

function CompareSection() {
  const rows = [
    ["素材与项目在哪", "你的设备上，不上传", "云端，需上传素材", "云端，积分/会员限制", "本机文件，无扩展"],
    ["AI 字幕与配音", "本地模型，断网可用", "云端，次数受限", "云端，积分墙", "无内置 AI"],
    ["免费开源", "免费开源，可自部署", "会员订阅", "积分付费", "一次性购买"],
    ["可扩展", "用 JavaScript 编写 App", "封闭功能清单", "封闭功能清单", "插件生态有限"],
  ] as const;
  return <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8"><div className="max-w-2xl"><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">COMPARISON</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">和云端 AI 视频工具，有什么不同。</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">剪映把 AI 字幕和配音放在云端，素材上传、次数受限；Recut 让剪辑与 AI 生成都在本地运行，免费开源，还能扩展。</p></div><div className="mt-10 overflow-x-auto rounded-2xl border bg-card"><table className="w-full min-w-[40rem] text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-4 font-semibold">对比维度</th><th className="p-4 font-semibold text-primary">Recut</th><th className="p-4 font-semibold">剪映 / CapCut</th><th className="p-4 font-semibold">云端 AI 视频工具</th><th className="p-4 font-semibold">Premiere / DaVinci</th></tr></thead><tbody>{rows.map(([label, recut, jianying, cloud, pro]) => <tr className="border-b last:border-0" key={label}><td className="p-4 text-muted-foreground">{label}</td><td className="p-4 font-medium text-foreground">{recut}</td><td className="p-4">{jianying}</td><td className="p-4">{cloud}</td><td className="p-4">{pro}</td></tr>)}</tbody></table></div><p className="mt-4 text-xs text-muted-foreground">「剪映平替」「开源视频剪辑软件」之外，Recut 也是可以长期自部署、用代码扩展的第三种选择。想深入理解设计取舍，可阅读我们关于本地优先与可扩展性的文章。</p></section>;
}

function HomeFaqSection() {
  return <section className="border-y bg-card"><div className="mx-auto max-w-4xl px-5 py-20 sm:px-8"><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">FAQ</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">关于本地 AI 视频剪辑，你关心的问题。</h2><div className="mt-10 grid gap-4">{HOME_FAQ.map(({ question, answer }) => <div className="rounded-2xl border bg-background p-6" key={question}><h3 className="text-lg font-semibold">{question}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{answer}</p></div>)}</div></div></section>;
}

function ProductPreview() {
  const items = [["剪辑", "把素材、节奏与叙事放进可编辑时间线。"], ["世界观", "让角色、场景和规则在每次创作中保持连贯。"], ["语音克隆", "为已获授权的声音建立可复用表达。"], ["扩展应用", "接入自己的模型、工具和工作流。"]] as const;
  return <div className="rounded-2xl border border-primary/20 bg-card/85 p-4 shadow-[0_24px_70px_oklch(0.22_0.05_151_/_0.14)] backdrop-blur"><div className="flex items-center justify-between border-b pb-3"><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">R</span><span><span className="block text-sm font-semibold">Recut Workspace</span><span className="block text-[10px] tracking-[0.14em] text-muted-foreground">LOCAL · PRIVATE · EXTENSIBLE</span></span></div><span className="rounded-full bg-primary/10 px-2 py-1 font-mono text-[9px] font-semibold text-primary">READY</span></div><div className="mt-4 grid grid-cols-2 gap-2.5">{items.map(([title, description]) => <div className="rounded-xl border bg-background p-3.5" key={title}><span className="grid size-7 place-items-center rounded-lg bg-accent text-xs font-bold text-accent-foreground">✦</span><h3 className="mt-5 text-sm font-semibold">{title}</h3><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{description}</p></div>)}</div></div>;
}

export function ProductSection() {
  const values = [["本地优先：素材与项目不上传", "项目、素材与凭据在你的设备与基础设施中流动，而不是被锁进不透明的云端；断网也能继续剪辑与创作。", "/blog/local-first-creative-workspace"], ["开源可审阅：代码公开透明", "代码公开，边界清楚。你可以检查、部署、修改，也可以放心地长期使用，不担心工具停止更新。", "https://github.com/6174/recut"], ["为扩展而生：用 JavaScript 扩展工作台", "核心工作台提供统一能力；App 决定你要怎样剪辑、生成、管理世界观和声音，也可以接入自己的模型与工具。", "/blog/creative-tools-should-be-extensible"]] as const;
  return <section className="border-y bg-card" id="product"><div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]"><div><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">THE CREATIVE BASE</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">你的视频素材与项目，<br />不离开这台电脑。</h2><p className="mt-5 max-w-sm text-sm leading-6 text-muted-foreground">Recut 让每一步都落到同一个可持续的创作环境：能保存上下文，也允许你替换其中任何一层。作品不该散落在一堆临时网页里。</p></div><div className="grid gap-3">{values.map(([title, description, href], index) => <article className="grid gap-4 rounded-xl border bg-background p-5 sm:grid-cols-[3rem_1fr]" key={title}><span className="font-mono text-sm font-semibold text-primary">0{index + 1}</span><div><h3 className="text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p><Link className="mt-3 inline-flex text-sm font-semibold text-primary" href={href}>{index === 1 ? "查看 GitHub 源码" : "了解更多"} →</Link></div></article>)}</div></div></section>;
}

function FeaturedApplications() {
  const appURL = useMarketingAppURL();
  const apps = [
    ["视频剪辑", "从素材整理到时间线编排，让每次修改都能继续。", "TIMELINE", "/apps"],
    ["Worlds", "把角色、场景、叙事规则留在作品的长期上下文中。", "CONTEXT", ""],
    ["语音创作", "本地 AI 配音与自动字幕，为已授权声音建立可复用表达。", "VOICE", "/apps/recut.audio-studio"],
    ["应用市场", "用 App 接入新的模型、工具和你自己的创作流程。", "EXTEND", "/apps"],
  ] as const;
  return <section aria-labelledby="featured-apps-title" className="mx-auto max-w-6xl px-5 py-20 sm:px-8"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div className="max-w-2xl"><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">FEATURED CAPABILITIES</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl" id="featured-apps-title">视频剪辑、AI 短片与语音创作，都在一个本地工作台。</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">视频、世界观、声音与工具扩展不是孤立功能；它们在同一个工作台里共享项目、素材与意图，不用在多个工具之间切换。</p></div><a className="text-sm font-semibold text-primary" href={`${appURL}/apps`}>浏览应用市场 →</a></div><div className="mt-10 grid gap-3 md:grid-cols-2">{apps.map(([title, description, label, href], index) => { const card = <article className="group flex min-h-52 flex-col overflow-hidden rounded-2xl border bg-card p-5 transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[var(--shadow-overlay)]"><div className="flex items-center justify-between"><span className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">{label}</span><span className="grid size-8 place-items-center rounded-full border text-sm text-muted-foreground transition group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground">0{index + 1}</span></div><div className="mt-12"><h3 className="text-xl font-semibold">{title}</h3><p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p></div></article>; return href ? <Link className="block" href={href} key={title}>{card}</Link> : <div className="block" key={title}>{card}</div>; })}</div></section>;
}

function TeamNote() {
  return <section className="border-y bg-[oklch(0.17_0.012_150)] text-white"><div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[0.7fr_1.3fr]"><div><span className="grid size-12 place-items-center rounded-xl bg-primary text-xl font-bold">R</span><p className="mt-5 font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">A NOTE FROM RECUT</p></div><div><h2 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">为什么我们做开源、<br />本地优先的视频创作工具。</h2><p className="mt-6 max-w-2xl text-base leading-7 text-white/65">创作者需要的不只是一次生成，而是一处可以积累素材、角色、决定和工具的地方。Recut 因此选择本地优先，也选择开放到足以被每个团队继续塑造。</p><Link className="mt-8 inline-flex text-sm font-semibold text-primary" href="/blog/local-first-creative-workspace">阅读我们为何这样做 →</Link></div></div></section>;
}

function LatestPosts() {
  return <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8"><div className="flex items-end justify-between gap-5"><div><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">LATEST FROM RECUT</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">关于 AI 视频创作与本地工具。</h2></div><Link className="hidden text-sm font-semibold text-primary sm:inline" href="/blog">查看所有文章 →</Link></div><div className="mt-10 grid gap-4 md:grid-cols-3">{marketingPosts.map((post) => <article className="flex min-h-60 flex-col rounded-2xl border bg-card p-5" key={post.slug}><time className="font-mono text-[10px] text-muted-foreground">{post.date}</time><h3 className="mt-8 text-lg font-semibold leading-6"><Link className="transition hover:text-primary" href={`/blog/${post.slug}`}>{post.title}</Link></h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{post.description}</p><Link className="mt-auto pt-6 text-sm font-semibold text-primary" href={`/blog/${post.slug}`}>继续阅读 →</Link></article>)}</div><Link className="mt-6 inline-flex text-sm font-semibold text-primary sm:hidden" href="/blog">查看所有文章 →</Link></section>;
}

function FinalCTA() {
  const appURL = useMarketingAppURL();
  return <section className="border-t bg-primary text-primary-foreground"><div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 py-14 sm:px-8 md:flex-row md:items-center"><div><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary-foreground/65">START CREATING</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">免费安装 Recut，现在开始本地 AI 视频创作。</h2></div><a className="inline-flex h-11 items-center rounded-lg bg-card px-5 text-sm font-semibold text-foreground transition hover:bg-background" href={appURL} onClick={() => trackEvent("recut_install_clicked", { location: "final_cta" })}>安装 Recut <span aria-hidden="true" className="ml-1">↗</span></a></div></section>;
}

export function DocsContent() {
  const appURL = useMarketingAppURL();
  const docs = [["开始使用", "安装本地 service，打开工作台并完成第一次创作。", "安装与连接"], ["核心能力", "理解视频剪辑、世界观、授权语音和素材库如何协同。", "创作能力"], ["开发 App", "用 JavaScript 定义自己的界面、业务和工作流，并接入平台能力。", "App 开发"], ["本地部署", "将 Recut 运行在自己的电脑、局域网或受控的远程 service 上。", "部署与连接"]] as const;
  return <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8"><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">DOCUMENTATION</p><h1 className="mt-4 text-4xl font-semibold tracking-tight">从第一支视频开始。</h1><p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">Recut 的文档围绕实际创作路径组织：先在本地启动，再将平台能力扩展为自己的工作方式。</p><div className="mt-10 grid gap-4 md:grid-cols-2">{docs.map(([title, description, eyebrow]) => <article className="rounded-2xl border bg-card p-6 transition hover:border-primary/35 hover:shadow-sm" key={title}><p className="font-mono text-[10px] font-semibold tracking-[0.15em] text-primary">{eyebrow}</p><h2 className="mt-5 text-lg font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p><a className="mt-6 inline-flex text-sm font-semibold text-primary" href={appURL}>在工作台中开始 ↗</a></article>)}</div></section>;
}

export function BlogContent() {
  return <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8"><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">FROM RECUT</p><h1 className="mt-4 text-4xl font-semibold tracking-tight">关于创作工具的想法。</h1><p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">记录 Recut 如何构建本地优先、可扩展的 AI 视频创作环境。</p><div className="mt-10 divide-y border-y">{marketingPosts.map((post) => <article className="grid gap-3 py-7 sm:grid-cols-[9rem_1fr_auto] sm:items-center" key={post.slug}><time className="font-mono text-xs text-muted-foreground">{post.date}</time><div><h2 className="text-xl font-semibold"><Link className="transition hover:text-primary" href={`/blog/${post.slug}`}>{post.title}</Link></h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{post.description}</p></div><Link aria-label={`阅读 ${post.title}`} className="text-sm font-semibold text-primary" href={`/blog/${post.slug}`}>阅读 →</Link></article>)}</div></section>;
}

export function BlogPostContent({ post }: { post: MarketingPost }) {
  const appURL = useMarketingAppURL();
  return <article className="mx-auto max-w-3xl px-5 py-16 sm:px-8"><Link className="text-sm font-semibold text-primary" href="/blog">← 所有文章</Link><p className="mt-10 font-mono text-xs text-muted-foreground">{post.date}</p><h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{post.title}</h1><p className="mt-6 text-lg leading-8 text-muted-foreground">{post.description}</p><MarkdownContent content={post.content} /><ShareActions title={post.title} /><a className="mt-10 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/85" href={appURL}>打开 Recut 工作台 ↗</a></article>;
}

function MarkdownContent({ content }: { content: string }) {
  const blocks = content.split(/\n\n+/);
  const nodes = blocks.flatMap((block, index) => {
    const lines = block.split("\n");
    if (lines.every((line) => line.startsWith("- "))) {
      return <ul className="mt-2 space-y-2" key={index}>{lines.map((line, itemIndex) => <li className="pl-1" key={itemIndex}>{inlineMarkdown(line.replace(/^- /, ""))}</li>)}</ul>;
    }
    if (lines[0].startsWith("## ")) {
      return <h2 className="mt-12 text-2xl font-semibold tracking-tight" key={index}>{inlineMarkdown(lines[0].replace(/^## /, ""))}</h2>;
    }
    return <p className="mt-2" key={index}>{inlineMarkdown(lines.join(" "))}</p>;
  });
  return <div className="mt-12 border-t pt-10 text-base leading-8 text-foreground/85">{nodes}</div>;
}

function inlineMarkdown(text: string) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, index) => index % 2 === 1 ? <strong className="font-semibold text-foreground" key={index}>{part}</strong> : part);
}

export function ShareActions({ title }: { title: string }) {
  const pathname = usePathname();
  const [copied, setCopied] = useState(false);
  const url = `https://recut.video${pathname}`;
  const encode = encodeURIComponent;
  const links = [
    { label: "X", href: `https://twitter.com/intent/tweet?text=${encode(title)}&url=${encode(url)}` },
    { label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${encode(url)}` },
    { label: "Telegram", href: `https://t.me/share/url?url=${encode(url)}&text=${encode(title)}` },
    { label: "微博", href: `https://service.weibo.com/share/share.php?url=${encode(url)}&title=${encode(title)}` },
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
  return <div className="mt-10 flex flex-wrap items-center gap-2 border-t pt-6"><span className="text-xs font-medium text-muted-foreground">分享</span>{links.map(({ href, label }) => <a className="inline-flex h-8 items-center rounded-md border bg-card px-3 text-xs font-medium text-muted-foreground transition hover:border-primary/35 hover:text-foreground" href={href} key={label} onClick={() => trackEvent("recut_share_clicked", { platform: label })} rel="noreferrer" target="_blank">{label}</a>)}<button className="inline-flex h-8 items-center rounded-md border bg-card px-3 text-xs font-medium text-muted-foreground transition hover:border-primary/35 hover:text-foreground" onClick={() => { trackEvent("recut_share_clicked", { platform: "copy_link" }); void copyLink(); }} type="button">{copied ? "已复制链接" : "复制链接"}</button></div>;
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
