# web/

> L2 | 父级: /README.md

成员清单
package.json: Next.js 工作台的独立依赖与开发命令；开发和运行均经 `server.cjs` 先按 Host 分流，Zustand 保存跨路由唯一的 service 连接状态，wavesurfer.js 提供音频波形播放，开发时以 polling 避免本机 watcher 耗尽。
package-lock.json: 锁定前端依赖的可复现版本。
next.config.ts: 前端构建配置；静态导出交给 Worker 按 Host 分流，本地 Node 运行时的 Host 映射由 `server.cjs` 处理。
server.cjs: 本地 Next 自定义服务器；在 App Router 匹配前将 `localhost` 的官网根路径和应用市场映射到 `marketing/` 静态路由，`app.localhost` 保持工作台路径不变。
wrangler.toml: `recut-web` Cloudflare Worker 与静态 Assets 发布配置；以可审阅的 `custom_domain` 路由声明 `recut.video`、`www.recut.video` 与 `app.recut.video`，部署时由 Cloudflare 管理 DNS 和 Universal SSL 绑定；`not_found_handling = "404-page"`，未知路径由 Worker 与 404.html 接管，不再 SPA 回退到工作台 index.html。
worker.ts: Cloudflare 静态站边缘入口；按 Host 将 `recut.video` / `www.recut.video` 根路径映射为公开官网 Landing，将 `app.recut.video` 映射为创作工作台；`www.recut.video` 一律 301 到裸域、`/marketing` 别名 301 到 `/`，Marketing Host 的公开 `/apps` 与 `/apps/:appID` 映射到 SEO 应用落地页，未知路径（含工作台深链）返回 404；同时在 App Host 边缘内部将 World、项目和 App 语义深链分别映射为唯一静态壳，浏览器仍保留真实 URL，直接交给静态 Assets binding，绝不代理 localhost service。
public/install.sh: 无源码 Unix 安装/升级入口；从同域 release manifest 取得版本与 SHA-256，macOS 注册 launchd、Linux 注册 systemd user service，并等待 `/health` 验证 daemon 真正启动后才报告成功。
public/install.ps1: 无源码 Windows 安装/升级入口；校验 ZIP service 包后注册并启动当前用户的登录任务。
public/releases/latest/: `make service-release` 生成的 macOS、Linux、FreeBSD 和 Windows service 发布包与 SHA-256 manifest；随 Worker Assets 发布，不进入 Git。
next-env.d.ts: Next.js 自动生成的 TypeScript 环境声明。
postcss.config.mjs: Tailwind v4 的 PostCSS 编译入口。
components.json: shadcn/Mira 组件生成与路径别名配置。
tsconfig.json: TypeScript 编译约束与 `@/*` 路径别名。
app/: 本地 Recut 工作台与官网的 App Router 页面与样式；`localhost:3000` 根路径是官网 Landing，`app.localhost:3000` 根路径是工作台，云端分别由 `recut.video` 与 `app.recut.video` 承载；工作台顶级 Tab 依次为 Studio、Worlds、Projects、Assets 与 Apps。
components/: Chat UI、保留的终端诊断面板、官网展示与 JSON-LD 结构化数据组件及 shadcn 风格 UI 原子组件；浮层交互基于 Radix Portal。
lib/: 前端共享工具函数、官网文章目录与不持久化的跨路由数据快照；service endpoint 变化时整体失效，目录和 Agent 低频元数据禁止页面级轮询。
public/: 公开的跨平台 service 安装器、品牌图标（`icon.png` / `apple-touch-icon.png` / `favicon.ico`）与构建时生成的发布包。
app/robots.ts、app/sitemap.ts、app/manifest.ts: `output: export` 下构建为 `robots.txt`、`sitemap.xml` 与 `manifest.webmanifest` 的元数据路由；robots 以 `Disallow` 覆盖工作台路径（`/apps` 公开给官网应用落地页）、sitemap 只列官网（Landing/Docs/应用/应用详情/Blog）且 URL 收敛到 `recut.video` 裸域并带尾斜杠，manifest 声明 PWA 启动与图标。

依赖边界
`NEXT_PUBLIC_RECUT_WORKSPACE_MODE=cloud` 时，web 以 `NEXT_PUBLIC_RECUT_API_URL` 作为默认地址，并将用户选择的 service endpoint 保存于浏览器；浏览器直连该本地或远程 service，Cloudflare Worker 不代理其 API。`NEXT_PUBLIC_RECUT_APP_URL` 是官网进入工作台的唯一跨域地址，发布为 `https://app.recut.video`，开发为 `http://app.localhost:3000`。`NEXT_PUBLIC_RECUT_WORKSPACE_MODE=local` 时，导出的页面由 service 自身交付，默认 API 为浏览器同源地址，既不显示“安装本地 service”的引导，也不依赖固定端口；local 和 LAN 模式均不读取或写入 cloud 留下的 endpoint。`NEXT_PUBLIC_RECUT_WORKSPACE_MODE=lan` 用于端口 3000 的开发工作台：`localhost:3000` 渲染官网，`app.localhost:3000` 渲染工作台；工作台复用访问页面的主机名、改用 `NEXT_PUBLIC_RECUT_API_PORT`（默认 17373）访问 service。LAN service 接受私有、链路本地和 loopback IP 的浏览器跨域请求。`NEXT_PUBLIC_RECUT_SERVICE_VERSION` 是 Makefile 从唯一 `RECUT_VERSION` 注入的本次发布 service 版本。官网与工作台统一使用 PostHog 埋点：`components/posthog-analytics.tsx` 内置项目 token（`phc_` 为公开客户端 token，可用构建环境变量 `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` 覆盖，`NEXT_PUBLIC_POSTHOG_DEBUG=true` 开启调试）并以 `https://us.i.posthog.com` 直连上报；初始化开启 autocapture（general 点击/输入）与 `capture_exceptions`（未捕获错误/Promise rejection），`recut_page_viewed` 页面访问事件覆盖官网与工作台全部路由（`site` 区分 marketing/app，脱敏动态路由并带实体 id 与来源/UTM），`trackEvent` 供安装、打开工作台、分享等语义事件复用。对话以 Agent Session 事件为真相，PTY 输出只可用于终端诊断，不得导入 `cmd/`、`internal/` 或直接读写本地项目目录。

根布局固定挂载 service 控制入口：所有页面展示同一 endpoint 的状态与版本；仅默认本地 endpoint 可经 daemon API 确认式升级或重启，浏览器不直接执行系统命令。daemon 启动即将 Codex、Claude Code、OpenCode 与通用 Agent 软链接到同一个 `<data-dir>/skills/recut` 来源，并为前三者保留现有用户配置地原子注册 Recut MCP，使 Skill 可直接调用平台工具；全局设置的 Recut Skill Tab 查询 `GET /v1/skills` 按归属列出平台与全部 App Skill，并通过 `POST /v1/skills/links`（平台 Recut Skill 沿用 `POST /v1/skills/recut/links`）创建或修复 Agent 软链接。所有工作台 Header 右侧提供 Recut GitHub 项目主页外链；项目 Header 与 Apps 目录分别显示 App 版本，Git 检测到远端版本后需在确认 popover 中升级。

域名边界

`wrangler.toml` 是三个域名的唯一声明：`recut.video`、`www.recut.video` 与 `app.recut.video` 都以 `custom_domain = true` 绑定到同一个 Worker，部署时由 Cloudflare 创建/维持 DNS 与 Universal SSL；不要再在 Dashboard 重复添加 Custom Domain、保留指向外部 HTTPS origin 的代理 DNS 记录，或配置只匹配 `/` 的 Worker Route。`recut.video` 是公开官网（Landing、Docs、Blog），`app.recut.video` 是创作工作台；Custom Domain 必须覆盖静态 HTML、`/_next/static/*`、release manifest 与安装包，避免 chunk 回落到源站并触发 525。SEO 收敛：`www.recut.video` 由 Worker 301 到裸域，所有官网页面 canonical 指向 `https://recut.video/<path>`（尾斜杠），官网默认 `index,follow` 而工作台页面继承根布局的 `noindex,nofollow`，robots.txt 同时 `Disallow` 工作台与 `/marketing` 内部壳路径。

表单规范
每个 `input`、`select`、`textarea` 必须有可见的 `<label htmlFor>`，并与控件 `id` 对应；placeholder 只能提供格式或示例，不能替代字段名称。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
