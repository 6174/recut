# web/

> L2 | 父级: /README.md

成员清单
package.json: Next.js 工作台的独立依赖与开发命令，开发时以 polling 避免本机 watcher 耗尽。
package-lock.json: 锁定前端依赖的可复现版本。
next.config.ts: 前端构建配置。
wrangler.toml: `recut-web` Cloudflare Worker 与静态 Assets 发布配置。
worker.ts: Cloudflare 静态站边缘入口；将项目深链重写为唯一静态项目壳，并把真实项目 id 放入查询串，直接交给静态 Assets binding，绝不代理 localhost service。
public/install.sh: 无源码 macOS 安装/升级入口；从同域 release manifest 取得版本与 SHA-256，校验用户 CPU 对应的 service 包后注册 launchd 用户服务。
public/releases/latest/: `make service-release` 生成的 macOS 压缩 service 发布包与 SHA-256 manifest；随 Worker Assets 发布，不进入 Git。
next-env.d.ts: Next.js 自动生成的 TypeScript 环境声明。
postcss.config.mjs: Tailwind v4 的 PostCSS 编译入口。
components.json: shadcn/Mira 组件生成与路径别名配置。
tsconfig.json: TypeScript 编译约束与 `@/*` 路径别名。
app/: 本地 Recut 工作台的 App Router 页面与样式。
components/: Chat UI、保留的终端诊断面板与 shadcn 风格 UI 原子组件。
lib/: 前端共享工具函数。
public/: 公开的 macOS service 安装器与构建时生成的发布包。

依赖边界
web 仅通过 `NEXT_PUBLIC_RECUT_API_URL` 调用 Daemon HTTP/SSE API；Cloudflare 构建固定为 `http://127.0.0.1:17373`，由浏览器直连用户 service。`NEXT_PUBLIC_RECUT_SERVICE_VERSION` 是 Makefile 从唯一 `RECUT_VERSION` 注入的本次发布 service 版本；对话以 Agent Session 事件为真相，PTY 输出只可用于终端诊断，不得导入 `cmd/`、`internal/` 或直接读写本地项目目录。

表单规范
每个 `input`、`select`、`textarea` 必须有可见的 `<label htmlFor>`，并与控件 `id` 对应；placeholder 只能提供格式或示例，不能替代字段名称。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
