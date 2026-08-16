# web/lib/

> L2 | 父级: /web/README.md

成员清单
utils.ts: 提供 shadcn 组件共享的 Tailwind 类名合并函数。
appstore.ts: 应用市场（可添加 App）的唯一云端数据源；从 `<site>/api/appstore.json` 拉取双语言目录（name/description/requirements 按 Locale 取），离线或拉取失败返回空目录；工作台 Apps 市场与 App 详情页消费，取代原静态 `app-catalog.ts`；service 的嵌入式 appstore 仅服务 MCP `recut.apps.store` 发现。
marketing-apps.ts: 官网应用市场的 MDX 加载器；用 gray-matter 读取 `content/apps/<locale>/*.mdx`，frontmatter 解析 `id/name/type/tagline/description/keywords/relatedApps/repository/requirements/faq`，正文为自由 markdown；导出 `MarketingApp` 与 `marketingApps`/`getMarketingApp`；只在服务端模块导入，客户端组件一律经 props 接收数据，避免 `node:fs` 进入浏览器包；App 的 `id` 需与工作台 Catalog 的 app id 一致以打通深链，但内容与安装目录完全解耦。
content-locale.ts: 内容目录默认 locale（`zh-CN`）与可用 locale 清单常量；多语言接入时在此扩展，blog 与 App 的 MDX 加载器共用。
docs.ts: 官网 Docs 的 MDX 加载器；读取 `content/docs/<locale>/*.mdx`，frontmatter 解析 `title/description/group/order`，正文为自由 markdown；导出 `DocPage` 与 `loadDocs`/`getDoc`；只在服务端模块导入，客户端组件经 props 接收数据；`group` 供索引按分组展示。
marketing-home.ts: 官网首页的静态营销数据；`HOME_FAQ` 六条常见问题（免费/与剪映区别/素材隐私/配置要求/是否要写代码/能做什么）与 `HOW_IT_WORKS` 三步开始流程，供首页渲染与首页 FAQPage JSON-LD 共用，避免客户端与服务端各维护一份。
service-endpoint.ts: Recut service 根地址、`local`/`lan`/`cloud` 工作台模式、格式校验与本地事件流地址；本机默认把 SSE/WebSocket 切到相邻端口，避免长连接耗尽短 API 的浏览器连接池；嵌入式 local 工作台始终以浏览器同源地址连接 service，LAN 开发工作台复用当前主机名和 service 端口，不持有运行时状态。
service-store.ts: 基于 Zustand persist 的 service 状态唯一真相；持久化 endpoint 并让所有 HTTP、SSE、WebSocket 调用订阅该值，ServiceControl 负责连接轮询，避免路由切换或刷新后退回旧地址。
agent-store.ts: Agent 元数据、会话列表、当前会话和详情快照的内存缓存；请求按 endpoint 去重，面板拥有 SSE 连接但将增量回写缓存。
agent-panel-context.ts: 全局 Agent 面板上下文的内存状态；保存根布局唯一挂载的面板所需的当前路由 projectID（仅素材上传/引导上下文）、宿主回填草稿与当前页面上下文，`useReportPageContext` 让页面声明式上报并在卸载时清理；Header 高度是工作台壳固定的 64px，不允许页面各自覆盖，面板为单一全局会话，各页面只声明这些上下文，不再各自挂载面板。
marketing-posts.ts: 官网 Blog 的 MDX 加载器；用 gray-matter 读取 `content/marketing/<locale>/*.mdx`，导出 `MarketingPost`（date/slug/title/description/content/locale）与 `marketingPosts`/`getMarketingPost`，按日期降序；只在服务端模块导入，客户端组件一律经 props 接收数据，避免 `node:fs` 进入浏览器包；内容覆盖产品理念、使用教程与技术关键词碰瓷（CosyVoice / Qwen ASR / Depth Anything / AI 封面等自部署难的高搜索词，落点到免配置 App 方案）。
media-configuration-store.ts: Provider、脱敏 Credential 与用途 Route 的按 endpoint 配置缓存；Settings、素材创建和 iframe App 宿主共享，绝不保存 API Key 输入草稿。
workspace-store.ts: 含可选 image/video `cover` 的项目、App、已安装 App、项目详情和独立 App scope 的内存目录缓存；App、项目与安装列表分别保留读取状态和服务端失败原因，安装列表成功返回空数组即是“尚未安装”，首次读取和写操作后显式刷新，禁止页面级轮询。
recut-worlds-client.ts: Creation Worlds 的浏览器传输适配器；请求/响应与全局 SDK 及 MCP 同构，World/Entity、可冻结的多模态 Evidence、Resolve 与项目 World Context 读写；错误统一解包为结构化 `RecutWorldsError`；只被原生 Recut 页面使用，App iframe 永不经它。
worlds-store.ts: Creation Worlds 的跨路由内存缓存；World 列表分页、详情、Entity 列表/详情快照分别保留读取状态与失败原因，缓存键按 `{endpoint, text, type, cursor}` / `{endpoint, worldId}` / `{endpoint, worldId, kind, cursor}` 划分，任何写或绑定成功后显式失效，禁止页面级轮询。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
