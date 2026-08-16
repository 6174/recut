<!--
 * [INPUT]: 依赖 web/app 现有路由结构（app/marketing、app/docs、app/blog、app/page.tsx 工作台）、
 *          web/worker.ts + web/wrangler.toml（Cloudflare 静态站与 Host 分流）、web/components/marketing-site.tsx、
 *          web/lib/marketing-posts.ts、web/app/layout.tsx、Makefile（build:cloudflare / web-deploy）与 Cloudflare Static Assets
 * [OUTPUT]: 定义 Recut 官网（recut.video / www.recut.video / app.recut.video）完整 SEO 与社交分享体验的采纳契约：
 *          逐路由元数据、canonical 与域名收敛、robots.txt / sitemap.xml、Open Graph / Twitter Card 分享预览
 *          （含微信 / 微博 / X / LinkedIn / Slack / Discord / Telegram 等平台要点）、OG 图片（首期图标+文本占位，图槽留扩展）、JSON-LD 结构化数据、
 *          工作台 noindex 隔离、边缘 Worker 的 www 重定向与软 404 处理、图标集与首屏元数据基线
 * [POS]: rfc 的公开官网实施蓝图；获批后落地到 web/app 各路由、web/worker.ts 与构建脚本，作为 SEO 与分享的一致契约
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: 官网 SEO 与社交分享 —— recut.video 的元数据、索引与分享预览完整方案

- 状态：已实施
- 作者：Recut
- 日期：2026-08-16
- 决策范围：逐路由 metadata、canonical/域名收敛、robots.txt 与 sitemap.xml、Open Graph/Twitter Card 与各平台分享预览、OG 图片（首期图标+文本，图槽留作扩展）、JSON-LD 结构化数据、工作台 noindex 隔离、Worker 边缘调整（www 重定向、软 404、/marketing 别名）、favicon/图标集、Blog 内容补强
- 关联：`web/worker.ts`（Host 分流）、`web/wrangler.toml`（三域名 Custom Domain）、`web/app/layout.tsx`（根元数据）、`web/components/marketing-site.tsx`（官网展示层）、`web/lib/marketing-posts.ts`（文章目录）、`web/README.md` 与 `web/app/README.md`（路由协议）、`Makefile`（web-build-cloudflare / web-deploy）
- 实施进展：**P0 已落地**（根布局 `title.template` + 默认 noindex、四个 Marketing 路由独立 metadata、canonical、`app/robots.ts`/`app/sitemap.ts`/`app/manifest.ts`、Worker www→裸域 301、`/marketing` 301、Marketing/App Host 未知路径 404、`not_found_handling = "404-page"`）。**P1 已落地**（全站 og/twitter 标签 image 指向 `logo.jpg`，`marketing-jsonld.tsx` Organization/WebSite/SoftwareApplication/Blog/BlogPosting/Breadcrumb，`icon.png`/`apple-touch-icon.png`/`favicon.ico` + `theme-color`）。**P2 已落地**（Blog 五篇唯一 markdown 正文 ≥600 字，`BlogPostContent` 轻量 markdown 渲染 + `ShareActions` 分享组件）。**扩展落地**：官网新增公开 `/apps` 应用市场与 `/apps/:appID` SEO 落地页（Worker 从 Marketing Host 映射、robots 不再 Disallow `/apps`、sitemap/JSON-LD 覆盖、header/footer 加入口）；应用数据与工作台 `app-catalog` 解耦为 `lib/marketing-apps`，每个 App 含关键词/板块/FAQ/相关应用内链；首页按「本地 AI 视频剪辑」关键词策略重构（title/description/H1/H2、三步开始、适合谁、与云端对比、FAQ 六条），并新增首页 FAQPage、应用 ItemList 与增强 SoftwareApplication JSON-LD。验证：`make build:cloudflare` 全绿，逐页 head/sitemap/robots 审计通过，Worker 路由单测（含 deep-link 不回归）。

## 1. 背景与病灶（当前 SEO 状态盘点）

对 `make build:cloudflare` 静态产物逐页审查，当前官网的搜索引擎与社交分享现状如下：

1. **全站共用根布局唯一元数据**。`web/app/layout.tsx` 只声明 `title: "Recut Local Workspace"`、`description: "Local-first AI video workflows"`，没有任何逐路由 `metadata`/`generateMetadata`。实测 `out/marketing/index.html`、`out/index.html`、`out/blog/*`、`out/apps/app`、`out/worlds/app` 的 `<head>` 完全一致，仅 `viewport` + `description` + `logo.jpg` favicon。Google 会为所有页面看到同一标题与描述，点击率与相关性极差。
2. **无 sitemap.xml、无 robots.txt**。`out/` 与 `public/` 中都不存在；索引入口与抓取边界都未声明。
3. **无 canonical**。`www.recut.video` 与 `recut.video` 两个 Custom Domain 交付同一内容；`recut.video/marketing`（Worker 内部映射壳）也可直接访问造成重复；`app.recut.video` 的工作台壳与官网又是同一份构建产物。三处重复没有收敛信号。
4. **无任何 Open Graph / Twitter Card 标签**。分享到微信、微博、QQ、小红书、X/Twitter、LinkedIn、Slack、Discord、Telegram 时，卡片会退化成一串裸 URL，或抓取到 "Recut Local Workspace" 这个错误标题；**微信**等中国平台尤其依赖 `og:title` / `og:description` / `og:image`。
5. **无 OG 图片**。`public/` 只有 `logo.jpg`（123 KB），各平台卡片无图可显示。本 RFC 首期以「图标 + 文本」占位（`og:image` 复用 `logo.jpg`），1200×630 品牌分享图留作扩展点由后续补充。
6. **无 JSON-LD 结构化数据**。没有 Organization / WebSite / SoftwareApplication / BlogPosting 等富结果；新站权重低时无法靠结构化增强展示（如品牌徽标、面包屑、文章日期）。
7. **工作台页面可被索引**。`app.recut.video` 的 `/`、`/projects/:id`、`/worlds/:id`、`/apps/:id`、`/media` 等静态壳都是空的服务端 HTML（真实内容在浏览器直连本地 service 后才有），却未 `noindex`；同时这些壳经 Worker 深链映射后在 `recut.video` 与 `app.recut.video` 都能以不同 URL 访问，构成重复与低质页面。
8. **边缘软 404**。`wrangler.toml` 的 `not_found_handling = "single-page-application"` 会让 Marketing Host 上任何未知路径（如 `/foo`、`/marketing`）返回工作台 `index.html` 且状态 200，搜索引擎会把它当成真实页面收录。
9. **Blog 内容过薄且高度重复**。`lib/marketing-posts.ts` 三篇文章的正文是同一段模板文案，仅标题/描述不同，属于低质重复内容，不利于收录也不利于分享时的首屏印象。
10. **图标与移动端基线不足**。只有 `logo.jpg` 一处 favicon，无 `apple-touch-icon`、`theme-color`、`webmanifest`；微信/浏览器书签、iOS 分享长按的体验不完整。
11. **无分析埋点**。无法度量 SEO 带来的流量（作为边界内的可选基线，本 RFC 只占位，不做实现决策）。

**目标**：让 `recut.video` 的每个公开页面都有独立、正确的标题/描述/结构化数据与唯一 canonical；让分享到主流社交平台时首屏卡片正确显示——首期以图标 + 标题 + 描述呈现，1200×630 图片槽位留作后续扩展；让工作台页面明确不进索引；让爬虫获得 sitemap 与 robots 的明确指引。

**边界**：本 RFC 只负责「官网对外可索引/可分享的正确性」，不负责产品增长运营；不引入付费 SEO 服务或第三方聚合；不改动工作台（app.recut.video）的真实功能；Blog 内容补强只定义内容模型与要求，具体文案由内容创作完成。

## 2. 决策记录

| # | 决策 |
|---|---|
| D1 | **逐路由元数据**：`app/marketing`、`app/docs`、`app/blog`、`app/blog/[slug]` 四个服务端页面各导出 `metadata`（title/description/openGraph/twitter/alternates.canonical/robots），根布局升级为 `title.template = "%s | Recut"` + 全站默认值 |
| D2 | **索引默认关闭、官网显式开启**：根布局 `robots: { index: false }`；四个 Marketing 页面显式 `robots: { index: true }`。新增营销页面忘记写 metadata 时默认不进索引，安全失败 |
| D3 | **canonical 收敛**：官方唯一 URL = `https://recut.video`（裸域、无 www）；所有 Marketing 页面 `alternates.canonical` 指向 `https://recut.video/<path>`；Worker 对 `www.recut.video/*` 301 到 `recut.video/*` |
| D4 | **robots.txt + sitemap.xml 静态生成**：新增 `app/robots.ts` 与 `app/sitemap.ts`（`output: export` 下构建为 `out/robots.txt` 与 `out/sitemap.xml`）；sitemap 只含官网页面并带 `lastmod` |
| D5 | **Open Graph / Twitter Card 全页面**：所有 Marketing 页面提供 `og:title/description/url/type/image/site_name/locale` 与 `twitter:card=summary_large_image` 系列；`og:url` 恒等于 canonical |
| D6 | **OG 图片首期占位 + 扩展点**：首期 `og:image`/`twitter:image` 统一复用现有 `https://recut.video/logo.jpg`（图标），配合每页 `og:title`/`og:description` 文本形成分享卡；预留 `public/og/` 目录与 `<meta>` 结构作为扩展槽位，后续补充 1200×630 品牌分享图（或每篇 Blog 专属图）时只产出静态 PNG 并替换 image URL，不改页面与 metadata 代码 |
| D7 | **JSON-LD 结构化数据**：官网注入 Organization、WebSite、SoftwareApplication（Landing）、Blog/BlogPosting（Blog 列表与详情）、BreadcrumbList（Docs/Blog） |
| D8 | **工作台 noindex 隔离**：`app.recut.video` 全部静态壳（`/`、`/projects/:id`、`/worlds/:id`、`/apps/:id`、`/media`、`/workspace-app/:id`、`/appstore`）经 D2 默认 noindex；robots.txt 再加 `Disallow` 作为纵深防御 |
| D9 | **Worker 边缘调整**：www→apex 301；Marketing Host 未知路径返回 404（不再 SPA 回退 200）；`/marketing` 别名 301 到 `/`；`/marketing/*` 不存在路径 404 |
| D10 | **Blog 内容补强**：`marketing-posts.ts` 扩展 `content`（markdown）字段并渲染；每篇正文必须唯一、≥600 中文字；新增文章时 sitemap 自动来自目录，OG 图沿用默认图直至补充专属图（扩展点） |
| D11 | **图标与移动基线**：生成 `favicon.ico`/`icon.png`、`apple-touch-icon`（180×180）、`theme-color`、`manifest.webmanifest`；`icons` 元数据完整声明 |
| D12 | **分享组件（可选，P2）**：Blog 详情加轻量「分享」条，输出各平台分享意图链接（X/LinkedIn/Telegram/微博）与「复制链接」（微信无开放分享意图，复制链接是标准做法） |

## 3. 逐路由元数据设计（D1/D2/D3/D5）

### 3.1 根布局

```ts
// app/layout.tsx
export const metadata: Metadata = {
  title: { default: "Recut", template: "%s | Recut" },
  description: "本地优先、可扩展的 AI 视频创作工作台。剪辑、世界观、授权语音与生成式创作都在你的电脑里。",
  robots: { index: false, follow: false },          // D2：默认不索引，Marketing 页显式开启
  alternates: { canonical: "https://recut.video/" }, // 根 fallback；子页面各自覆盖
  icons: { icon: "/favicon.ico", shortcut: "/favicon.ico", apple: "/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
  openGraph: { siteName: "Recut", locale: "zh_CN", type: "website", images: ["https://recut.video/logo.jpg"] },
  twitter: { card: "summary_large_image", title: "Recut", description: "..." , images: ["https://recut.video/logo.jpg"] },
};
```

### 3.2 Marketing Landing（`app/marketing/page.tsx`）

```ts
export const metadata: Metadata = {
  title: "本地优先的 AI 视频创作工作台",
  description: "Recut 把剪辑、世界观、授权语音与生成式创作放进同一个本地工作台。免费开源，本地运行，通过 App 持续扩展。",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://recut.video/" },
  openGraph: {
    type: "website", url: "https://recut.video/", title: "Recut — 让 AI 视频创作留在你的电脑里",
    description: "本地优先、可扩展的 AI 视频创作工作台。", images: [{ url: "https://recut.video/logo.jpg", width: 500, height: 500, alt: "Recut 图标" }],
  },
  twitter: { card: "summary_large_image", title: "Recut — 让 AI 视频创作留在你的电脑里", description: "本地优先、可扩展的 AI 视频创作工作台。", images: ["https://recut.video/logo.jpg"] },
};
```

### 3.3 Docs 与 Blog（`app/docs`、`app/blog`、`app/blog/[slug]`）

- Docs：`title: "文档"`，`description` 围绕「开始使用 / 核心能力 / 开发 App / 本地部署」，canonical `https://recut.video/docs`。
- Blog 列表：`title: "Blog"`，canonical `https://recut.video/blog`。
- Blog 详情：`generateMetadata` 从 `marketingPosts` 取 `title/description/date`；`openGraph.type = "article"`，`article.publishedTime` = 文章 date，`og:image` 首期沿用 `https://recut.video/logo.jpg`（扩展点：补充专属图时替换为 `https://recut.video/og/<slug>.png`）；`alternates.canonical = https://recut.video/blog/<slug>`。

### 3.4 工作台页面（noindex，D8）

工作台各壳页面（`app/page.tsx` 与各 shell 页面）**不写** metadata，继承根布局的 `robots: { index: false }`。为可读性可在各 shell 服务端页面显式补 `export const metadata: Metadata = { robots: { index: false } }`（页面是服务端组件，可导出）。

## 4. 域名与 canonical 收敛（D3/D9）

```text
现状                      问题
recut.video/...           官方唯一 URL（保留）
www.recut.video/...       重复 → Worker 301 到 recut.video
recut.video/marketing     Worker 内部壳被公开访问 → 301 到 /
app.recut.video/*         工作台 → 默认 noindex + robots Disallow
```

Worker 调整（`web/worker.ts`）：

- `marketingHosts` 分支中，先把 `www.recut.video` 直接 301 到同路径 `recut.video`（保留 query/hash）。
- 对 Marketing Host，`/marketing`（及 `/marketing/`）301 到 `/`；`/marketing/*` 直接 404。
- 对 Marketing Host 的未知路径（不匹配 `/`、`/docs*`、`/blog*`、静态资源、`robots.txt`、`sitemap.xml`、`og/*`、安装器与 release 资源），返回 404（fetch `/404/` 静态壳并设置 `404` 状态），不再落入 SPA 回退的 200。
- 对 App Host 保持现有 deep-link 映射，其余未知路径同样返回 404 而非 SPA 回退。

> `not_found_handling = "single-page-application"` 保留用于 App Host 的 SPA 路由回退；Marketing Host 的 404 由 Worker 显式接管。可选的更严格做法是把该配置改为 `"404-page"` 并让 Worker 对 App Host 未知路径显式 fetch 404 壳，二者等价，实施时二选一并在 README 记录。

## 5. robots.txt 与 sitemap.xml（D4）

`app/robots.ts`：

```ts
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/marketing", "/appstore", "/apps", "/projects", "/worlds", "/media", "/workspace-app"] },
    ],
    sitemap: "https://recut.video/sitemap.xml",
  };
}
```

`app/sitemap.ts`：固定条目 `/`、`/docs`、`/blog`，加 `marketingPosts.map(...)` 生成 `/blog/<slug>`，每条 `url: https://recut.video/<path>`、`lastModified: <date>`。**全部来自静态数据，构建期完成**，无需改动 Worker 即可在 Marketing Host 与 App Host 下可访问（App Host 下的 robots 同样收敛到官网 sitemap）。

## 6. OG 图片与分享预览（D5/D6/D11）

### 6.1 首期实现：图标 + 文本（D6）

- `og:image` / `twitter:image` 首期统一指向 `https://recut.video/logo.jpg`（现有图标，123 KB、约正方形），配合每页 `og:title` / `og:description` 文本形成分享卡——各平台至少显示 Recut 图标与正确的标题、描述，不再退化成一串裸 URL。
- 不引入图片生成脚本、字体与 sharp 依赖；微信/微博对「方形图标 + 文本」的展示足够；X 的 `summary_large_image` 与 Facebook 的 1:1 裁剪均能接受任意比例。
- **扩展点（图槽）**：约定未来专属分享图放 `public/og/` 并以 `https://recut.video/og/<name>.png`（1200×630）对外；补充时只需产出静态 PNG 并替换 `<meta>` 中的 image URL，页面结构与 metadata 代码保持不变。默认分享图与每篇 Blog 专属图都走这个槽位。
- **为什么不用 `opengraph-image.tsx`**：`output: export`（Cloudflare 静态托管）下不产生可用的动态路由 Handler，`next/og` 的 ImageResponse 在静态导出中不可靠；静态 PNG（无论是现在的 `logo.jpg` 还是后续 `og/*.png`）与仓库构建模式一致、可审阅、可复现。

### 6.2 各平台要点（写入 RFC 作为验收口径）

| 平台 | 读取的标签 | 关键约束 |
|---|---|---|
| 微信（公众号/个人分享） | `og:title`/`og:description`/`og:image`（回退 `<title>`、`meta description`） | 图片必须 HTTPS 绝对地址、≤5 MB、不可被防盗链拒绝；**链接预览有缓存**，改标签后需等缓存过期或换 URL。域名未被微信封禁即可 |
| 微博 | `og:title`/`og:description`/`og:image` | 图片 HTTPS；`og:url` 建议与页面地址一致 |
| QQ / 小红书 | `og:title`/`og:description`/`og:image` | 同上；小红书对图质量敏感，1200×630 即可 |
| X / Twitter | `twitter:card`/`twitter:title`/`twitter:description`/`twitter:image`（可回退 og） | `summary_large_image`；图片 ≥ 800×418 |
| LinkedIn | `og:*` | 图片 ≥ 200×200，推荐 1200×630；`og:title` 有长度上限（约 96 字符） |
| Slack / Discord / Telegram | `og:*`（Discord 读 og，Slack 读 og+twitter） | 图片 HTTPS；Discord 有图片代理，无需额外配置 |
| iMessage / SMS | `og:title`/`og:image` + `twitter:*` | 常用 `twitter:card` 兜底 |

约束映射到实现：所有 `og:image`/`twitter:image` 一律输出 `https://recut.video/logo.jpg`（扩展点：`og/*.png` 就位后换成绝对 URL）；`og:title` 控制在 60 字符内、`og:description` 控制在 120–160 字符内；`og:url` 恒等于 canonical。

### 6.3 分享组件（D12，P2 可选）

Blog 详情底部加 `<ShareActions url description title />`（client 组件）：

- X：`https://twitter.com/intent/tweet?text=<title>&url=<url>`
- LinkedIn：`https://www.linkedin.com/sharing/share-offsite/?url=<url>`
- Telegram：`https://t.me/share/url?url=<url>&text=<title>`
- 微博：`https://service.weibo.com/share/share.php?url=<url>&title=<title>`
- 微信：`navigator.clipboard.writeText(url)`（微信无开放 web 分享意图，复制链接为标准路径）

## 7. JSON-LD 结构化数据（D7）

新增轻量服务端组件 `web/components/marketing-jsonld.tsx`，用 `<script type="application/ld+json" dangerouslySetInnerHTML>` 注入（静态导出安全）：

- **Organization**（Landing/全站 Footer 一次）：`name: Recut`、`url: https://recut.video`、`logo: https://recut.video/logo.jpg`、`sameAs: ["https://github.com/6174/recut"]`、`foundingDate` 可省。
- **WebSite**：`name: Recut`、`url: https://recut.video`、`inLanguage: zh-CN`。
- **SoftwareApplication**（Landing）：`name: Recut`、`applicationCategory: "MultimediaApplication"`、`operatingSystem: "macOS, Linux, Windows, FreeBSD"`、`offers: { price: 0, priceCurrency: "CNY" }`（开源免费）、`url`。
- **Blog / BlogPosting**（Blog 列表 `Blog` 类型；详情 `BlogPosting`）：`headline`、`description`、`datePublished`（来自 `marketingPosts.date`）、`author: { @type: "Organization", name: "Recut" }`、`image: https://recut.video/logo.jpg`（扩展点：`og/<slug>.png` 就位后替换）、`mainEntityOfPage`。
- **BreadcrumbList**（Docs/Blog 详情）：`/` → `/docs` 或 `/blog/<slug>`。

## 8. Blog 内容补强（D10）

`lib/marketing-posts.ts` 扩展：

```ts
export type MarketingPost = { date: string; slug: string; title: string; description: string; content: string /* markdown */ };
```

- `BlogPostContent` 将正文替换为渲染 `content`（实现上可引入 `marked`/`react-markdown`，或先用受支持的子集：标题 + 段落 + 列表 + 引用 + 代码块；静态导出安全）。
- 验收标准：每篇正文**唯一且 ≥600 中文字**；`description` 每篇不同；文章日期即 `datePublished` 与 sitemap `lastmod`。
- 新增文章只改 `marketing-posts.ts`，sitemap/OG 图/详情页自动派生，不加新页面样板。

## 9. 图标与移动端基线（D11）

- `public/favicon.ico`（或继续 `icon` 指向 `logo.jpg` 的 PNG；正式补齐 ICO 多尺寸）。
- `public/apple-touch-icon.png`（180×180，从 `logo.jpg` 生成）。
- `public/icon.png`（512×512）与 `public/manifest.webmanifest`（`name/short_name/start_url/icons`，`display: standalone` 供 PWA 提示；不要求离线能力）。
- 根布局 `icons` 完整声明；可选 `<meta name="theme-color">` 与品牌绿一致。
- 全站图片（`marketing-site.tsx` 的 logo 与 footer logo）补 `width`/`height`，避免 CLS；Blog 配图延迟加载（`loading="lazy"`）。

## 10. 分阶段实施路线

| 阶段 | 内容 | 验证 |
|---|---|---|
| **P0**（元数据 + 索引 + canonical） | 根布局模板化 + 默认 noindex；四个 Marketing 页面 metadata；www 301、/marketing 301、Marketing/App Host 未知路径 404（Worker）；`app/robots.ts`、`app/sitemap.ts` | `make build:cloudflare` 后逐页 grep `<title>`/`canonical`/`noindex`；`curl https://recut.video/robots.txt`、`/sitemap.xml`；`curl -I` 验证 301/404 状态码 |
| **P1**（分享预览 + 结构化数据） | 全站 og/twitter 标签，image 首期指向 `logo.jpg`（图槽扩展点预留 `og/*` 约定）；`marketing-jsonld.tsx`（Organization/WebSite/SoftwareApplication/BlogPosting/Breadcrumb）；图标集 + manifest + theme-color | OG 验证器（Facebook Sharing Debugger / X Card Validator / LinkedIn Post Inspector）逐页通过；JSON-LD 用 Rich Results Test / schema.org 校验；分享到微信实际看卡片 |
| **P2**（内容与分享组件） | Blog 每篇唯一正文（markdown 渲染）；`ShareActions` 组件 | 文章字数与唯一性 lint；`make check` + 页面渲染抽查 |

## 11. 验证方案

1. **构建产物审计**：`make build:cloudflare` 后对 `out/marketing/index.html`、`out/docs/index.html`、`out/blog/index.html`、`out/blog/<slug>/index.html` 断言：`<title>` 唯一且含站点名、有 `canonical`、有 `og:*`/`twitter:*`、有 JSON-LD、Marketing 页 `robots` 允许索引、工作台壳 `noindex`。
2. **边缘行为**：`wrangler dev` 或部署后验证：`www.recut.video/x` → 301；`recut.video/marketing` → 301 `/`；`recut.video/unknown` → 404；`app.recut.video/unknown` → 404；`/projects/:id`、`/worlds/:id`、`/apps/:id` 深链映射不变。
3. **社交预览**：Facebook Sharing Debugger / X Card Validator / LinkedIn Post Inspector 对 `/`、`/blog/local-first-creative-workspace` 通过；真实微信会话内分享确认标题/描述/图片正确。
4. **回归**：`make check` 全绿；既有 `web/worker.ts` 的 App Host 深链行为不回归；`web/README.md`、`web/app/README.md` 与 `rfc/README.md` 反向一致。

## 12. 边界与未决

- **分析埋点**：SEO 流量度量（如 Cloudflare Web Analytics 或自建 `/v1/analytics`）不在本 RFC 实施，仅保留接入位置，避免引入第三方脚本影响 CWV。
- **hreflang**：当前单语言 `zh-CN`，不加 `hreflang`；`og:locale = zh_CN` 足够。若未来出英文站，需在同 RFC 基础上补 `hreflang` 与双语 sitemap。
- **Docs 正文化**：当前 `/docs` 只有一页卡片壳，真实内容在 `app.recut.video` 工作台内。是否把安装/能力/开发/部署四类文档正文化到 `/docs/*` 静态页以扩大可索引内容，本 RFC 建议作为 P2+ 单独 RFC，避免与工作台内容双写。
- **meta keywords**：Google 已忽略，不实现。
- **专属分享图（扩展点）**：首期以 `logo.jpg` + 文本占位；后续补充 1200×630 品牌分享图或每篇 Blog 专属图时，产出静态 PNG 到 `public/og/` 并替换 `<meta>`/JSON-LD 中的 image URL 即可，不改页面结构与 metadata 代码。若走脚本生成（品牌色 + 标题文字），中文渲染需自带字体（如思源黑体子集），字体体积与授权在实现时确认；也可由设计直接出静态图。
