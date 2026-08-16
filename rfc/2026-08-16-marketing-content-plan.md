<!--
 * [INPUT]: 依赖 rfc/2026-08-16-i18n-zh-en.md（全站 zh/en 多语言架构、defaultLocale=en、/zh/ 前缀、逐语言 MDX 内容模型）、
 *          web/content/marketing|apps/<locale>/*.mdx（locale 目录内容）、lib/marketing-posts|marketing-apps|marketing-home.ts（MDX 加载器）、
 *          Google 视角的深度研究（AI 视频生成 / 视频制作科普 / 工具文 / 创作方法论四个研究簇，均按 Google 全球 + Google 中文 SERP 逻辑）
 * [OUTPUT]: 定义官网「如何做视频 / 做 AI 视频」主题域的 SEO 内容计划：主题簇、内容形态配比、中英双语言生产模型、
 *          P0–P2 执行顺序、时效更新机制，以及与 i18n RFC 的对齐方式
 * [POS]: rfc 的内容路线图；获批后按 P0 产 MDX 文章（zh + en），作为营销内容与 i18n 上线的内容铺垫
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 -->

# RFC: 视频创作主题域内容计划 —— Google 优先、全球视角、zh/en 双语言

- 状态：提议
- 作者：Recut
- 日期：2026-08-16
- 决策范围：主题簇划分（AI 视频生成 / 视频制作科普 / 工具文 / 创作方法论）、内容形态配比（科普文/工具文/教程/方法论）、权威性 vs 承接配比（60/40）、双语言生产模型（en 为 default 无前缀面，zh 走 `/zh/`）、P0–P2 执行顺序、榜单/教程的时效更新机制
- 关联：`rfc/2026-08-16-i18n-zh-en.md`（语言架构与内容模型）、`web/content/marketing|apps/<locale>/*.mdx`、`lib/marketing-posts.ts`、`lib/marketing-apps.ts`、`lib/marketing-home.ts`、`lib/content-locale.ts`、`components/markdown-content.tsx`
- 实施进展：**P0 三篇已落地**（zh MDX + en `EN_POSTS` 双语言）：① `ai-video-post-production-workflow`（AI 生成视频怎么剪辑）② `capcut-alternative-roundup-2026`（剪映平替 2026 实测盘点）③ `ai-video-model-comparison-2026`（旗舰模型对比，link magnet）；`MarkdownContent` 补齐 `|` 表格与 `>` 引用块支持。剩 P0：本地自动字幕/转写（en 版已有 inline 内容）。

## 1. 背景与选题依据

官网已有的内容（首页、18 篇 Blog、5 个 App 落地页）围绕「Recut 是什么」建立，但「如何做视频 / 做 AI 视频」是更大的搜索主题域——大量高意图查询（怎么做、怎么选、是什么、对比）在 Google 全球与 Google 中文都有流量，且我们的产品恰好覆盖其中「生成之后」的剪辑环节。

对四个研究簇（AI 视频生成、视频制作科普、工具文、创作方法论）按 **Google 全球 SERP（英文）+ Google 中文 SERP** 逻辑深度研究后的关键结论：

1. **Google 中文是蓝海**：中文站大多只做百度、不针对 Google 优化，Google 中文 SERP 由技术媒体（36氪/机器之心/少数派）+ 官方 + 知乎 + YouTube 中文主导，无百度系加权；中文长尾竞争普遍显著低于英文与百度。
2. **生成端是巨大流量池、竞争被大媒体与竞价占死**：正面打「文生视频/AI 视频生成工具」大词是帮他人导流；正确姿势是**用科普文/工具文建立主题权威**，再用「生成后的剪辑/字幕/配音/封面」后期话题软性承接 Recut。
3. **时效是独立站的武器**：AI 视频按月迭代（Seedance 2.5 刚发布、Sora 停服），大媒体新闻稿衰减快、更新慢；独立站用「最后更新 + 版本对照 + 一手实测」可长期占位。
4. **产品承接点集中在「生成之后」**：字幕/转写、去口癖/停顿、B-roll、封面、Remotion——因此内容策略是「生成端做权威、后期端做承接」，权威:承接约 60:40。

## 2. 主题簇与选题库

### 2.1 A 簇：AI 视频生成（纯权威为主，最大流量池）

| 选题 | 形态 | 语言 | 竞争 | 优先级 |
|---|---|---|---|---|
| Seedance 2.5 完全指南 | 科普+教程 | zh+en | 低（先发窗口） | P0 |
| Sora 停服 + 最佳替代 | 科普+工具 | en 主 | 低-中（时效） | P0 |
| 旗舰模型实测对比 Seedance/Kling/Veo/Runway | 对比 | zh+en | 中 | P0（link magnet） |
| Kling 3.0 / Jimeng / Hailuo / Vidu 教程 | 教程 | zh 主 | 低 | P1/P2 |
| 免费 AI 视频生成器盘点 | 榜单 | zh P0 / en P1 | 中低 | P0/P1 |
| 文生视频 vs 图生视频 / 扩散模型原理 | 科普 | zh+en | 中 | P1/P2（EEAT 基石） |
| AI 视频提示词指南 | 教程 | zh+en | 中 | P1 |

### 2.2 B 簇：视频制作科普（常青权威）

| 选题 | 形态 | 语言 | 竞争 | 承接 | 优先级 |
|---|---|---|---|---|---|
| How Video Works 原理旗舰 | 科普 | zh+en | 英低/中低 | 权威锚点 | P1 |
| 字幕与 CC / 软硬字幕 | 科普+教程 | zh+en | 英高/中低 | audio-studio | P0 |
| B-roll 是什么 + 口播加 B-roll | 科普+教程 | zh+en | 英中/中低 | AI 短片 | P0 |
| 分辨率/帧率/码率/编码/格式 规格 Hub | 科普(子页) | zh+en | 英高/中低 | 弱 | P2 |
| 转场/节奏/卡点 | 科普+教程 | zh+en | 英中/中低 | editor | P1 |
| 横竖屏/长短视频/多机位/绿幕/LUT | 对比/科普 | zh+en | 英中/中低 | 弱 | P2 |

### 2.3 C 簇：创作方法论（权威 + 承接混合）

| 选题 | 形态 | 语言 | 竞争 | 承接 | 优先级 |
|---|---|---|---|---|---|
| 口播视频完整制作方法 | 指南 | zh+en | 英中/中低 | 强（全程） | P0 |
| 去口癖/停顿：剪辑心理学+工作流 | 方法论 | zh+en | 低/空白 | 核心卖点 | P0 |
| 播客视频化（vodcast） | 工作流 | zh+en | 英中/低 | 强 | P0 |
| 前 3 秒钩子 / 脚本写作 | 方法论 | zh+en | 英中高/低 | 弱 | P1 |
| 完播率/平均观看时长复盘 | 方法论 | zh+en | 英中高/低 | 中 | P1 |
| 剪辑节奏心理学 | 方法论 | zh+en | 低/空白 | 弱（共鸣） | P1 |
| 教程/课程视频制作 | 指南 | zh+en | 英中高/低 | 强 | P1 |
| Faceless 视频 / YouTube 算法 / 选题系列化 | 指南/方法论 | zh+en | 英高/低 | 弱 | P2 |

### 2.4 D 簇：工具文（榜单/对比/评测）

| 选题 | 形态 | 语言 | 竞争 | 承接 | 优先级 |
|---|---|---|---|---|---|
| CapCut alternative / 剪映平替（2026） | 榜单+对比 | zh+en | 中（事件驱动） | 入列+承接 | P0 |
| 剪映字幕识别收费 → 本地免费方案 | 对比+教程 | zh+en | 中 | audio-studio | P0 |
| 本地转写/自动字幕（Whisper 方案） | 评测+教程 | zh+en | 低-中 | audio-studio | P0 |
| 长视频自动剪短片（AI shorts） | 评测+教程 | zh+en | 低-中 | AI 短片 | P0 |
| 开源视频工具盘点 | 盘点 | zh+en | 低-中 | 入列+身份 | P0 |
| How to edit AI-generated videos | 教程 | zh+en | 低-中 | 强（全能力） | P0 |
| Best AI video generator 2026（旗舰权威页） | 榜单 | zh+en | 高 | 内链枢纽 | P1 |
| 免费视频剪辑软件 | 榜单 | zh+en | 英高 | 入列 | P1 |
| 剪映 vs PR（第三种选择） | 对比 | zh+en | 英高 | 品牌叙事 | P1 |
| Remotion 教程 | 教程 | zh+en | 低 | Remotion | P1 |
| 本地 vs 云端剪辑/AI（隐私） | 对比 | zh+en | 低 | 定位宣言 | P1 |
| 视频转文字 / ElevenLabs 替代 / 数字人 / 缩略图 / 录屏 / DaVinci vs PR | 榜单/对比 | zh+en | 中高 | 弱/权威 | P2 |

## 3. 内容形态与配比

- **科普文**（explainer/原理/规格）：抢 featured snippet、建 E-E-A-T 权威锚点，常青、一次成稿。B 簇为主。
- **工具文**（榜单/评测/对比）：承接交易意图、拉外链，需时效刷新。D 簇为主。
- **教程/方法论**（how-to/工作流/心理学）：转化最强，承接 Recut 能力。A/C 簇为主。
- **配比**：权威性 60%（生成端科普、原理、规格、方法论）/ 承接 40%（字幕、剪辑、B-roll、封面、生成后工作流）。每篇在相关步骤处低密度内链到对应 App 落地页，不硬导流。

## 4. 双语言生产模型（对齐 i18n RFC）

- 内容文件：`content/marketing/<locale>/<slug>.mdx`、`content/apps/<locale>/<appID>.mdx`，locale 枚举 `zh`/`en`（见 `lib/content-locale.ts`）。
- **新增文章默认产双语言**：`en` 为 default 无前缀面（i18n RFC D1），`zh` 走 `/zh/` 前缀；双语言同 slug、URL 稳定。单语言文章允许存在，但 i18n 上线后缺语言的一侧 404 且不出 sitemap/hreflang。
- 同一篇文章的 zh/en 正文各写各的（不机器直译），关键词各自面向 Google 中文 / Google 全球。
- 标题/描述/tagline 逐语言进入 frontmatter；FAQ/要求等结构化字段逐语言。

## 5. 执行顺序

**P0（先打样 1 个 pillar + 3 篇 spoke，验证两条 SERP 曲线）**
1. **How to edit AI-generated videos（生成后剪辑工作流）**——唯一同时满足「高意图 + 强承接 + 低竞争」的桥梁文，作为打样第一篇（zh + en）。
2. CapCut alternative / 剪映平替（2026）——量级大、事件驱动、Recut 直接入列。
3. 本地自动字幕/转写（Whisper 方案）——核心承接 + 隐私/离线叙事（已有中文版，补 en）。
4. 旗舰模型对比 Seedance/Kling/Veo/Runway——link magnet + 主题域 pillar。

**P1（扩内容矩阵）**
口播视频制作 + 去口癖/停顿方法论、播客视频化、字幕与 CC 科普、B-roll 科普、Remotion 教程、免费 AI 视频生成器盘点、Best AI video generator 2026 权威页。

**P2（长尾与规格）**
规格 Hub（分辨率/帧率/码率/编码/格式）、横竖屏/长短视频/多机位/绿幕/LUT、Faceless/YouTube 算法/选题系列化、数字人/缩略图/录屏/转写等覆盖页。

**节奏**：2–3 篇/月，P0 五篇优先。

## 6. 时效与更新机制

- **刷新分层**：季度（AI 生成器/模型评测/榜单——模型月更）；半年度（免费剪辑/字幕/配音/对比）；年度（开源盘点/规格）；事件驱动（Sora 停服、CapCut 禁令、Seedance 发布、剪映收费）。
- **低成本刷新**：榜单数据 schema 化（对比表/评分/Pros-Cons 字段），刷新=填数据；页面可见「最后更新 + 版本对照 + changelog」；季度批量共用同一批测试素材摊薄成本；刷新后更新 title 年份、sitemap lastmod、GSC 抓取。
- **一手实测是差异化**：自测截图、基准表、真实工作流，压过大媒体新闻稿式内容（Google EEAT 权重上升）。

## 7. 验证

- 每篇产出自查：标题/描述含主关键词、H2 带次关键词、FAQPage/BlogPosting JSON-LD、双语言 frontmatter 完整、落点内链正确。
- 上线后：Google 中文与 Google 全球各跟踪一条 SERP 曲线；季度复查榜单 `lastmod` 与数据。
- `make build:cloudflare` 全绿，sitemap/hreflang 逐语言正确（随 i18n P0 上线）。

## 8. 边界与未决

- **非目标**：不做付费 SEO/外链采购；不做机器翻译流水线（人工双语写作，优先质量）；不碰影视解说等版权敏感选题；不正面硬刚「文生视频」大词（只做科普权威与后期承接）。
- **未决 A**：英文内容先建英文 blog 路线（`/blog/<slug>` 为 en default），还是等 i18n P0 路由一起上线——建议文章先行产 `content/marketing/en/`，路由随 i18n P0 统一暴露。
- **未决 B**：榜单类是否上 `aggregateRating` 等富结果——需真实评价后才可（沿用 SEO RFC 口径）。
