/*
 * [INPUT]: 依赖 Next Link、构建时的 Recut App URL 与浏览器当前 Host
 * [OUTPUT]: 对外提供官网 Header、Footer、按 Hero→核心应用→创作底座→团队主张→文章→CTA 编排的 Landing、Docs 与 Blog 的共享展示组件及文章目录；localhost 下的工作台链接统一指向同端口 app.localhost
 * [POS]: web/components 的公开官网视觉层；服务 recut.video 与 localhost，不读取本地 service 或工作台状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";
import { marketingPosts } from "@/lib/marketing-posts";

const defaultAppURL = process.env.NEXT_PUBLIC_RECUT_APP_URL ?? "https://app.recut.video";
const MarketingAppURLContext = createContext(defaultAppURL);

export function MarketingShell({ children }: { children: React.ReactNode }) {
  const appURL = useAppURLForHost();
  return <MarketingAppURLContext value={appURL}><div className="min-h-screen bg-[oklch(0.985_0.004_150)] text-foreground"><MarketingHeader /><main>{children}</main><MarketingFooter /></div></MarketingAppURLContext>;
}

export function MarketingHeader() {
  const appURL = useMarketingAppURL();
  return <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur"><div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-5 px-5 sm:px-8"><Link aria-label="Recut 首页" className="flex shrink-0 items-center gap-2.5" href="/"><img alt="Recut" className="size-8 rounded-lg" src="/logo.jpg" /><span className="text-sm font-semibold tracking-tight">Recut</span></Link><nav aria-label="官网导航" className="hidden items-center gap-1 md:flex"><MarketingNav href="/#product">产品</MarketingNav><MarketingNav href="/docs">Docs</MarketingNav><MarketingNav href="/blog">Blog</MarketingNav><a className="rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground" href="https://github.com/6174/recut" rel="noreferrer" target="_blank">GitHub ↗</a></nav><a className="inline-flex h-9 shrink-0 items-center rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/85" href={appURL}>打开工作台 <span aria-hidden="true" className="ml-1">↗</span></a></div></header>;
}

function MarketingNav({ children, href }: { children: React.ReactNode; href: string }) {
  return <Link className="rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground" href={href}>{children}</Link>;
}

export function MarketingFooter() {
  const appURL = useMarketingAppURL();
  return <footer className="border-t bg-card"><div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 sm:px-8 md:grid-cols-[1fr_auto_auto]"><div><div className="flex items-center gap-2"><img alt="" className="size-6 rounded-md" src="/logo.jpg" /><span className="text-sm font-semibold">Recut</span></div><p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">本地优先、可扩展的 AI 视频创作工作台。</p></div><FooterLinks title="产品" links={[{ href: "/#product", label: "产品" }, { href: "/docs", label: "Docs" }, { href: appURL, label: "打开工作台" }]} /><FooterLinks title="资源" links={[{ href: "/blog", label: "Blog" }, { href: "https://github.com/6174/recut", label: "GitHub" }]} /></div><div className="border-t px-5 py-4 text-center text-xs text-muted-foreground">© 2026 Recut. Open source, local first.</div></footer>;
}

function FooterLinks({ links, title }: { links: ReadonlyArray<{ href: string; label: string }>; title: string }) {
  return <div><h2 className="text-sm font-semibold">{title}</h2><ul className="mt-3 space-y-2">{links.map(({ href, label }) => <li key={label}><a className="text-sm text-muted-foreground transition hover:text-foreground" href={href}>{label}</a></li>)}</ul></div>;
}

export function MarketingHero() {
  const appURL = useMarketingAppURL();
  return <section className="relative overflow-hidden border-b"><div aria-hidden="true" className="absolute -top-48 right-[-18rem] size-[38rem] rounded-full bg-primary/15 blur-3xl" /><div aria-hidden="true" className="absolute -bottom-64 left-1/4 size-[32rem] rounded-full bg-accent/75 blur-3xl" /><div className="relative mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1fr_0.8fr] lg:items-center"><div className="max-w-3xl"><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">LOCAL CREATIVE OS</p><h1 className="mt-5 text-5xl font-semibold leading-[1.03] tracking-[-0.045em] sm:text-6xl">让 AI 视频创作，<br /><span className="text-primary">留在你的电脑里。</span></h1><p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">Recut 把剪辑、世界观、授权语音与生成式创作放进同一个本地工作台。你的项目、素材和工作流始终由你掌控。</p><div className="mt-9 flex flex-wrap gap-3"><a className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/85" href={appURL}>安装 Recut <span aria-hidden="true" className="ml-1">↗</span></a><Link className="inline-flex h-11 items-center rounded-lg border bg-card px-5 text-sm font-semibold transition hover:bg-muted" href="/docs">阅读 Docs</Link></div><p className="mt-4 text-xs text-muted-foreground">免费开源 · 本地运行 · 通过 App 持续扩展</p></div><ProductPreview /></div></section>;
}

export function MarketingLanding() {
  return <><MarketingHero /><FeaturedApplications /><ProductSection /><TeamNote /><LatestPosts /><FinalCTA /></>;
}

function ProductPreview() {
  const items = [["剪辑", "把素材、节奏与叙事放进可编辑时间线。"], ["世界观", "让角色、场景和规则在每次创作中保持连贯。"], ["语音克隆", "为已获授权的声音建立可复用表达。"], ["扩展应用", "接入自己的模型、工具和工作流。"]] as const;
  return <div className="rounded-2xl border border-primary/20 bg-card/85 p-4 shadow-[0_24px_70px_oklch(0.22_0.05_151_/_0.14)] backdrop-blur"><div className="flex items-center justify-between border-b pb-3"><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">R</span><span><span className="block text-sm font-semibold">Recut Workspace</span><span className="block text-[10px] tracking-[0.14em] text-muted-foreground">LOCAL · PRIVATE · EXTENSIBLE</span></span></div><span className="rounded-full bg-primary/10 px-2 py-1 font-mono text-[9px] font-semibold text-primary">READY</span></div><div className="mt-4 grid grid-cols-2 gap-2.5">{items.map(([title, description]) => <div className="rounded-xl border bg-background p-3.5" key={title}><span className="grid size-7 place-items-center rounded-lg bg-accent text-xs font-bold text-accent-foreground">✦</span><h2 className="mt-5 text-sm font-semibold">{title}</h2><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{description}</p></div>)}</div></div>;
}

export function ProductSection() {
  const values = [["本地优先", "项目、素材与凭据在你的设备与基础设施中流动，而不是被锁进不透明的云端。"], ["开源可审阅", "代码公开，边界清楚。你可以检查、部署、修改，也可以放心地长期使用。"], ["为扩展而生", "核心工作台提供统一能力；App 决定你要怎样剪辑、生成、管理世界观和声音。"]] as const;
  return <section className="border-y bg-card" id="product"><div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]"><div><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">THE CREATIVE BASE</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">作品不该散落在<br />一堆临时工具里。</h2><p className="mt-5 max-w-sm text-sm leading-6 text-muted-foreground">Recut 让每一步都落到同一个可持续的创作环境：能保存上下文，也允许你替换其中任何一层。</p></div><div className="grid gap-3">{values.map(([title, description], index) => <article className="grid gap-4 rounded-xl border bg-background p-5 sm:grid-cols-[3rem_1fr]" key={title}><span className="font-mono text-sm font-semibold text-primary">0{index + 1}</span><div><h3 className="text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p></div></article>)}</div></div></section>;
}

function FeaturedApplications() {
  const appURL = useMarketingAppURL();
  const apps = [["视频剪辑", "从素材整理到时间线编排，让每次修改都能继续。", "TIMELINE"], ["Worlds", "把角色、场景、叙事规则留在作品的长期上下文中。", "CONTEXT"], ["语音创作", "为获授权的声音建立可复用的角色和旁白表达。", "VOICE"], ["应用市场", "用 App 接入新的模型、工具和你自己的创作流程。", "EXTEND"]] as const;
  return <section aria-labelledby="featured-apps-title" className="mx-auto max-w-6xl px-5 py-20 sm:px-8"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div className="max-w-2xl"><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">FEATURED CAPABILITIES</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl" id="featured-apps-title">每个应用，都让创作向前一步。</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">视频、世界观、声音与工具扩展不是孤立功能；它们在同一个工作台里共享项目、素材与意图。</p></div><a className="text-sm font-semibold text-primary" href={`${appURL}/apps`}>浏览应用市场 →</a></div><div className="mt-10 grid gap-3 md:grid-cols-2">{apps.map(([title, description, label], index) => <article className="group min-h-52 overflow-hidden rounded-2xl border bg-card p-5 transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[var(--shadow-overlay)]" key={title}><div className="flex items-center justify-between"><span className="font-mono text-[10px] font-semibold tracking-[0.16em] text-primary">{label}</span><span className="grid size-8 place-items-center rounded-full border text-sm text-muted-foreground transition group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground">0{index + 1}</span></div><div className="mt-12"><h3 className="text-xl font-semibold">{title}</h3><p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p></div></article>)}</div></section>;
}

function TeamNote() {
  return <section className="border-y bg-[oklch(0.17_0.012_150)] text-white"><div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[0.7fr_1.3fr]"><div><span className="grid size-12 place-items-center rounded-xl bg-primary text-xl font-bold">R</span><p className="mt-5 font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">A NOTE FROM RECUT</p></div><div><h2 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">我们不想让每一次创作，<br />都从一张空白网页重新开始。</h2><p className="mt-6 max-w-2xl text-base leading-7 text-white/65">创作者需要的不只是一次生成，而是一处可以积累素材、角色、决定和工具的地方。Recut 因此选择本地优先，也选择开放到足以被每个团队继续塑造。</p><Link className="mt-8 inline-flex text-sm font-semibold text-primary" href="/blog/local-first-creative-workspace">阅读我们为何这样做 →</Link></div></div></section>;
}

function LatestPosts() {
  return <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8"><div className="flex items-end justify-between gap-5"><div><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">LATEST FROM RECUT</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">关于创作，也关于工具。</h2></div><Link className="hidden text-sm font-semibold text-primary sm:inline" href="/blog">查看所有文章 →</Link></div><div className="mt-10 grid gap-4 md:grid-cols-3">{marketingPosts.map((post) => <article className="flex min-h-60 flex-col rounded-2xl border bg-card p-5" key={post.slug}><time className="font-mono text-[10px] text-muted-foreground">{post.date}</time><h3 className="mt-8 text-lg font-semibold leading-6"><Link className="transition hover:text-primary" href={`/blog/${post.slug}`}>{post.title}</Link></h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{post.description}</p><Link className="mt-auto pt-6 text-sm font-semibold text-primary" href={`/blog/${post.slug}`}>继续阅读 →</Link></article>)}</div><Link className="mt-6 inline-flex text-sm font-semibold text-primary sm:hidden" href="/blog">查看所有文章 →</Link></section>;
}

function FinalCTA() {
  const appURL = useMarketingAppURL();
  return <section className="border-t bg-primary text-primary-foreground"><div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 py-14 sm:px-8 md:flex-row md:items-center"><div><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary-foreground/65">START CREATING</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">让下一支视频，留在你的手里。</h2></div><a className="inline-flex h-11 items-center rounded-lg bg-card px-5 text-sm font-semibold text-foreground transition hover:bg-background" href={appURL}>安装 Recut <span aria-hidden="true" className="ml-1">↗</span></a></div></section>;
}

export function DocsContent() {
  const appURL = useMarketingAppURL();
  const docs = [["开始使用", "安装本地 service，打开工作台并完成第一次创作。", "安装与连接"], ["核心能力", "理解视频剪辑、世界观、授权语音和素材库如何协同。", "创作能力"], ["开发 App", "用 JavaScript 定义自己的界面、业务和工作流，并接入平台能力。", "App 开发"], ["本地部署", "将 Recut 运行在自己的电脑、局域网或受控的远程 service 上。", "部署与连接"]] as const;
  return <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8"><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">DOCUMENTATION</p><h1 className="mt-4 text-4xl font-semibold tracking-tight">从第一支视频开始。</h1><p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">Recut 的文档围绕实际创作路径组织：先在本地启动，再将平台能力扩展为自己的工作方式。</p><div className="mt-10 grid gap-4 md:grid-cols-2">{docs.map(([title, description, eyebrow]) => <article className="rounded-2xl border bg-card p-6 transition hover:border-primary/35 hover:shadow-sm" key={title}><p className="font-mono text-[10px] font-semibold tracking-[0.15em] text-primary">{eyebrow}</p><h2 className="mt-5 text-lg font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p><a className="mt-6 inline-flex text-sm font-semibold text-primary" href={appURL}>在工作台中开始 ↗</a></article>)}</div></section>;
}

export function BlogContent() {
  return <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8"><p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-primary">FROM RECUT</p><h1 className="mt-4 text-4xl font-semibold tracking-tight">关于创作工具的想法。</h1><p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">记录 Recut 如何构建本地优先、可扩展的 AI 视频创作环境。</p><div className="mt-10 divide-y border-y">{marketingPosts.map((post) => <article className="grid gap-3 py-7 sm:grid-cols-[9rem_1fr_auto] sm:items-center" key={post.slug}><time className="font-mono text-xs text-muted-foreground">{post.date}</time><div><h2 className="text-xl font-semibold"><Link className="transition hover:text-primary" href={`/blog/${post.slug}`}>{post.title}</Link></h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{post.description}</p></div><Link aria-label={`阅读 ${post.title}`} className="text-sm font-semibold text-primary" href={`/blog/${post.slug}`}>阅读 →</Link></article>)}</div></section>;
}

export function BlogPostContent({ post }: { post: (typeof marketingPosts)[number] }) {
  const appURL = useMarketingAppURL();
  return <article className="mx-auto max-w-3xl px-5 py-16 sm:px-8"><Link className="text-sm font-semibold text-primary" href="/blog">← 所有文章</Link><p className="mt-10 font-mono text-xs text-muted-foreground">{post.date}</p><h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{post.title}</h1><p className="mt-6 text-lg leading-8 text-muted-foreground">{post.description}</p><div className="mt-12 space-y-6 border-t pt-10 text-base leading-8 text-foreground/85"><p>真正长期的创作系统，不应把表达局限在一次性的生成结果里。它应该保存作品的上下文、让每个工具可替换，也让创作者能够决定数据和工作流在哪里运行。</p><p>Recut 以本地 service 作为执行与数据边界，再用可扩展的 App 连接剪辑、生成、世界观和声音能力。这样做并不追求把所有事情做成一个按钮，而是为不同的创作方式留出真实空间。</p><p>我们会继续把这些决定、实践与新的能力写在这里。</p></div><a className="mt-10 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/85" href={appURL}>打开 Recut 工作台 ↗</a></article>;
}

function useMarketingAppURL() {
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
