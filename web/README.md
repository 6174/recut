# web/

> L2 | 父级: /README.md

成员清单
package.json: Next.js 工作台的独立依赖与开发命令；Zustand 保存跨路由唯一的 service 连接状态，wavesurfer.js 提供音频波形播放，开发时以 polling 避免本机 watcher 耗尽。
package-lock.json: 锁定前端依赖的可复现版本。
next.config.ts: 前端构建配置。
wrangler.toml: `recut-web` Cloudflare Worker 与静态 Assets 发布配置；域名在 Cloudflare Dashboard 的 Custom Domain 中管理。
worker.ts: Cloudflare 静态站边缘入口；在边缘内部将项目和 App 语义深链分别映射为唯一静态壳，浏览器仍保留真实 URL，直接交给静态 Assets binding，绝不代理 localhost service。
public/install.sh: 无源码 Unix 安装/升级入口；从同域 release manifest 取得版本与 SHA-256，macOS 注册 launchd、Linux 注册 systemd user service，并等待 `/health` 验证 daemon 真正启动后才报告成功。
public/install.ps1: 无源码 Windows 安装/升级入口；校验 ZIP service 包后注册并启动当前用户的登录任务。
public/releases/latest/: `make service-release` 生成的 macOS、Linux、FreeBSD 和 Windows service 发布包与 SHA-256 manifest；随 Worker Assets 发布，不进入 Git。
next-env.d.ts: Next.js 自动生成的 TypeScript 环境声明。
postcss.config.mjs: Tailwind v4 的 PostCSS 编译入口。
components.json: shadcn/Mira 组件生成与路径别名配置。
tsconfig.json: TypeScript 编译约束与 `@/*` 路径别名。
app/: 本地 Recut 工作台的 App Router 页面与样式。
components/: Chat UI、保留的终端诊断面板与 shadcn 风格 UI 原子组件；浮层交互基于 Radix Portal。
lib/: 前端共享工具函数与不持久化的跨路由数据快照；service endpoint 变化时整体失效，目录和 Agent 低频元数据禁止页面级轮询。
public/: 公开的跨平台 service 安装器与构建时生成的发布包。

依赖边界
`NEXT_PUBLIC_RECUT_WORKSPACE_MODE=cloud` 时，web 以 `NEXT_PUBLIC_RECUT_API_URL` 作为默认地址，并将用户选择的 service endpoint 保存于浏览器；浏览器直连该本地或远程 service，Cloudflare Worker 不代理其 API。`NEXT_PUBLIC_RECUT_WORKSPACE_MODE=local` 时，导出的页面由 service 自身交付，默认 API 为浏览器同源地址，既不显示“安装本地 service”的引导，也不依赖固定端口；local 和 LAN 模式均不读取或写入 cloud 留下的 endpoint。`NEXT_PUBLIC_RECUT_WORKSPACE_MODE=lan` 用于端口 3000 的开发工作台：它复用访问页面的主机名、改用 `NEXT_PUBLIC_RECUT_API_PORT`（默认 17373）访问 service。LAN service 接受私有、链路本地和 loopback IP 的浏览器跨域请求。`NEXT_PUBLIC_RECUT_SERVICE_VERSION` 是 Makefile 从唯一 `RECUT_VERSION` 注入的本次发布 service 版本；对话以 Agent Session 事件为真相，PTY 输出只可用于终端诊断，不得导入 `cmd/`、`internal/` 或直接读写本地项目目录。

根布局固定挂载 service 控制入口：所有页面展示同一 endpoint 的状态与版本；仅默认本地 endpoint 可经 daemon API 确认式升级或重启，浏览器不直接执行系统命令。daemon 启动即将 Codex、Claude Code、OpenCode 与通用 Agent 软链接到同一个 `<data-dir>/skills/recut` 来源，并为前三者保留现有用户配置地原子注册 Recut MCP，使 Skill 可直接调用平台工具；全局设置的 Recut Skill Tab 查询 `GET /v1/skills` 按归属列出平台与全部 App Skill，并通过 `POST /v1/skills/links`（平台 Recut Skill 沿用 `POST /v1/skills/recut/links`）创建或修复 Agent 软链接。所有工作台 Header 右侧提供 Recut GitHub 项目主页外链；项目 Header 与 Apps 目录分别显示 App 版本，Git 检测到远端版本后需在确认 popover 中升级。

域名边界

在 Cloudflare Dashboard 将 `recut.video` 与 `www.recut.video` 添加为同一 Worker 的 Custom Domain；不要同时保留指向外部 HTTPS origin 的代理 DNS 记录，也不要使用只匹配 `/` 的 Worker Route。Custom Domain 必须覆盖静态 HTML、`/_next/static/*`、release manifest 与安装包，避免 chunk 回落到源站并触发 525。不要在 `wrangler.toml` 的 `routes` 和 Dashboard Custom Domain 中重复配置域名：前者会禁用默认 `workers.dev` 域名并增加故障恢复复杂度。

表单规范
每个 `input`、`select`、`textarea` 必须有可见的 `<label htmlFor>`，并与控件 `id` 对应；placeholder 只能提供格式或示例，不能替代字段名称。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
