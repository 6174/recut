# marketing/

> L2 | 父级: /web/app/README.md

成员清单
[locale]/: 官网逐语言多路由的动态段；`layout.tsx` 的 `generateStaticParams` 枚举 `["zh", "en"]`（default=en 无前缀、zh 固定 `/zh/` 前缀），并经 client 的 `MarketingLocaleProvider` 注入 locale、设置 `document.documentElement.lang`；`seo.ts` 是非路由共享模块，为各页 `generateMetadata` 构造逐语言 canonical/hreflang/og/twitter。
[locale]/page.tsx: Landing 路由；由 Worker / server.cjs 的无前缀（en）或 `/zh/`（zh）映射，按 Hero、核心应用、创作底座、团队主张、文章与最终 CTA 的信息节奏介绍本地优先 AI 视频创作，并挂载 Organization/WebSite/SoftwareApplication/HomeFaq/ItemList JSON-LD。
[locale]/apps/: 逐语言公开应用市场；`page.tsx` 是 `/apps`（与 `/zh/apps`）目录，`[appID]/page.tsx` 是每个 App 的 SEO 落地页，`generateStaticParams` 返回全部 appID 与 locale 组合，由 `lib/marketing-apps` 静态数据逐语言生成并挂载逐 App 元数据与 SoftwareApplication/Breadcrumb JSON-LD；与工作台 `lib/appstore`（云端市场）解耦，仅 `id` 保持一致以打通深链。
[locale]/docs/: 逐语言官网 Docs 公开入口；`/docs` 与 `/zh/docs`，不访问本地 service。
[locale]/blog/: 逐语言官网 Blog 公开目录与静态文章详情；列表与详情逐语言取 `lib/marketing-posts` 双语言内容，缺某语言的文章对该语言路由 `notFound()`，并挂载 Blog/BlogPosting 结构化数据。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
