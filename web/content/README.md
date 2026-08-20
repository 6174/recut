# web/content/

> L2 | 父级: /web/README.md

官网的可编辑内容，全部以 MDX 文件 + YAML frontmatter 保存，按类型与 locale 分目录：

```text
content/
├── marketing/<locale>/<slug>.mdx   官网 Blog 文章
├── apps/<locale>/<appID>.mdx       官网 App 详情页
└── docs/<locale>/<slug>.mdx        官网 Docs 文档页
```

约定

- **locale 目录**：`zh` 与 `en`（与 `rfc/2026-08-16-i18n-zh-en.md` 的 Locale 枚举一致；`en` 为 default 无前缀面、`zh` 走 `/zh/` 前缀）。新增文章默认产双语言；单语言文章在 i18n 上线后缺语言的一侧 404 且不出 sitemap/hreflang。
- **frontmatter**：blog 为 `date/title/description`；App 为 `id/name/type/tagline/description/keywords/relatedApps/repository/requirements/faq`，其中 `requirements` 与 `faq` 是嵌套 YAML。
- **正文**：自由 markdown，支持段落、`##`/`###` 标题、`-`/有序列表、`**加粗**`、行内代码与围栏代码块，由 `components/markdown-content.tsx` 渲染；不同文章/App 可以有不同的结构与篇幅。
- **消费方式**：`lib/marketing-posts.ts` 与 `lib/marketing-apps.ts` 是 server-only 的 MDX 加载器，读取后经 props 注入客户端组件；改内容只需编辑 MDX，sitemap / JSON-LD / 列表 / 详情自动派生，无需改路由。

新增文章：在 `content/marketing/zh/` 新建 `<slug>.mdx` 即可；新增 App：在 `content/apps/zh/` 新建 `<appID>.mdx`，`id` 需与工作台 Catalog 的 app id 一致以打通「在工作台打开」深链。`apps/zh/recut.editor.mdx` 是 Editor 的公开产品入口，路由详情会自动挂载其专属 Showcase。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
