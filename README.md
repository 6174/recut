# Recut - Local-first Extension Host

Recut 是本地 AI 视频工作台，也是类似 Chrome 的 App Host：App 用 JavaScript 定义 UI 与业务，平台提供隔离存储、文件、任务、素材、Artifact 和 MCP capability。

技术栈：Next.js + React 工作台，Go Daemon，Goja JavaScript sandbox，平台托管 SQLite，MCP stdio。

```text
apps/             本地 App 包与 AI 短片、Depth Anything、Cover Studio、Remotion Studio 子模块或源码；通过 make app-link 链接到运行时目录
docs/             平台稳定契约（权威规范）：通讯契约等；实现与文档必须与之保持一致
operation/        运营与开源协作资产；`official-repo/` 是官方社区 App 总库 submodule
rfc/              平台与产品的提议设计；Creation Worlds 等跨模块契约在实现前于此定稿
.gitmodules       外部 App 与官方社区仓库的固定远端与分支配置
scripts/          当前用户 production service 的安装器与内置 App 白名单打包器
dev/              开发审计与设计记录；不参与运行时
service/          Daemon：Extension Registry、JS runtime、Media Platform、storage/MCP/HTTP capability 与内嵌本地工作台
web/              平台工作台源码：导出为 Cloudflare 静态站或随 service 嵌入的本地 UI
ARCHITECTURE.md   Extension Host 契约与 AI 短片案例
Makefile          本地开发、生产 service 安装与 Cloudflare Worker 部署入口
```

## 核心法则

- `manifest.json` 是 App 唯一契约：身份、作者、简短描述、可选 Git 仓库、类型、入口、权限、可选 `onboarding` 引导卡、一次定义的 `operations`，以及可选的 `distribution.builtin.include` / `exclude` 发布规则。每个 onboarding 必须显式声明 `id`、`title` 和点击后写入的 `prompt`；每个 operation 以 `surfaces` 声明供 UI API、Agent MCP 或两者使用，避免同一业务契约重复。
- `type: project` 绑定用户项目；`type: standalone` 绑定稳定的 App 专属工作区 scope，不显示在项目桌面、不要求项目命名。它们使用同一运行时和 capability API。素材库是平台原生 React 页面，只使用隐藏 media scope 保存资产归属与 Agent 会话，不是 App、没有 manifest、不会进入 Catalog 或 iframe。
- App 数据模型属于 App 的 JavaScript。平台不解析 `project-layout.json`，不规定表、JSON 文件或工作流步骤。
- SQLite 是资源真相：App state、Artifact、事件、引用与版本均存表中；媒体平台在 `workspace.sqlite` 管理跨项目 Asset、Provider BYOK 凭据、用途模型 Route 与任务，文件根只保存内容寻址的大二进制，数据库保存其哈希引用。异步媒体先原子持久化稳定的 queued Asset 与 Job；常驻 Daemon 用 SQLite lease 和外部调用 checkpoint 提交 prediction、原位推进 Asset，并周期回收终态。只有已持久化的 prediction 可安全重试，未知外部提交保留原 Asset 并明确失败，避免重复收费；前端只读本地状态。所有媒体依赖以全局 `assetId` 表达；用户上传也先成为带 `origin: user-upload` 的 Asset，再绑定项目与 Agent turn。Project Doc 的可选 `cover` 只引用已完成的图片或视频 Asset，由 owner App 通过 `ctx.project.setCover({ assetId })` 按自身业务逻辑写入，平台只持久化和展示。用户 Agent 对话同样位于根目录 `workspace.sqlite`，与项目数据库解耦。
- App 之间通过公开 API 和不可变 Artifact 引用协作，绝不读取彼此数据库或文件目录。
- Agent 只连平台 MCP Host。Host 以按媒介类型划分的 `recut.image.generate`、`recut.video.generate`、`recut.speech.generate` 暴露生成能力，另以 `recut.media.*` 提供配置、任务和素材管理；`recut.context.media.readiness` 是生成能力是否可调用的唯一前置真相，防止已加载工具被误认为已配置模型。Agent 会话不绑定任何项目，项目由 `recut.project.list` / `recut.project_context` 发现并以显式 target 操作，`recut.project_context` 携带目标项目的默认媒体路由、模型契约和可选参数。三种生成都是异步 Job：提交即返回稳定 jobId 与 assetIds，Daemon 原位推进到终态，Agent 用 `recut.media.get_job` / `recut.media.wait_for_job` 观察状态。当前 App 的业务工具仍由 manifest 约束。
- Chat UI 消费结构化 Agent Session 事件；Codex/Claude 等 native session id 只用于续聊，终端 PTY 保留为兼容与诊断通道。
- 前端表单控件必须有与 `id` 关联的可见 `label`；`placeholder` 只用于填写示例，不能承担字段名称或可访问性语义。
- 运行时 App 根默认为 `~/.recut/apps`。发布 binary 内置 `builtinAppList` 中的 App（当前为 Remotion Studio），启动时原子同步其可运行包到该目录，因此首次打开不再是空白 App 列表；开发时 `make app-link` 创建的本地软链接优先，不会被内置同步替换。其他 App 仍可在相同位置以 Git clone 安装，服务不从源码仓库的 `apps/` 直接加载。
- Recut 平台 Skill 的唯一运行时正文固定在 `~/.recut/skills/recut`：service 启动（包括自更新后的重启）会原子同步二进制内嵌的最新版本，并自动安全软链接至 `~/.agents/skills/recut`、`~/.claude/skills/recut`、`~/.codex/skills/recut` 和 OpenCode 的用户配置目录；Codex、Claude Code、OpenCode 同时原子注册同一个 `http://127.0.0.1:17373/v1/mcp` Streamable HTTP Host，以 daemon-owned、可撤销的本机 Bearer device token 鉴权，绝不为每个 Agent 启动新的 service。Recut 内置会话暂以无状态 stdio adapter 连到同一 Host，保留 session 级工作区和素材导入上下文。已存在的其他 Skill 或用户自管 MCP 配置只会记录告警，绝不被覆盖；全局设置的 **Recut Skill** Tab 按归属列出全部 Skill（平台 Skill 归入「全局」，每个已安装 App 一个分组），供查看状态、手动修复和链接 App Skill。全局设置的 **Recut MCP** Tab 按归属列出本机 MCP Host 可提供的全部工具：平台能力始终可见并归入「平台工具」，App 声明 `mcp` surface 的操作按其归属 App 分组展示。
- 每个项目在 `.recut/app` 创建指向当前 App 包的符号链接。每个 Codex turn 由 Go 后端内嵌的 `service/prompts/core-agents.md.tmpl` 渲染平台 guide，并注入当前 App 自己的 `AGENTS.md`；该 guide 指示 Agent 从 `.recut/app` 读取、测试和按需修改当前 App 源码。

运行 `git submodule update --init --recursive` 获取所有外部 App（AI 短片、Depth Anything、Cover Studio）后，再运行 `make app-link` 链接全部本地 App；只链接一个包时使用对应的 `make app-link APP=apps/<app-name>`。随后运行 `make dev`。

运行 `make dev` 或 `make service-dev` 时，命令会先暂停当前用户受 launchd/systemd 托管的正式 Recut service，并取得 API `17373` 与事件流 `17374` 的独占开发所有权：任何监听者都会先收到 SIGTERM，10 秒后仍占用则精确 SIGKILL；因此命令不会因未知或遗留进程拒绝启动。服务将普通 API 请求固定在 `17373`，将 SSE/WebSocket 事件流固定在 `17374`；两端口共享同一个 daemon 与状态，但浏览器为它们分别分配连接池，多个标签、刷新或事件流自动重连都不会再挤占核心 API 请求。开发 service 固定报告为 `dev`，只能由开发命令停止/重启，网页管理器会明确禁用生产 service 操作。日常开发使用 `make dev`，它将 LAN service 与端口 `3000` 的 Next.js 热更新工作台一同启动；单独使用 `make service-dev` 时只启动 service，不再静态导出或嵌入前端，供已经运行的 `make web-dev` 配合。两个开发入口均会在 Ctrl+C/SIGTERM 时回收 service；服务本身会停止接收新 HTTP 请求，最多等待 10 秒完成在途请求后退出。结束开发后运行 `make service-resume` 恢复已安装的正式 service。生产 `make service-build` 先以 `NEXT_PUBLIC_RECUT_WORKSPACE_MODE=local` 导出同源工作台（不包含发布安装包），再将它嵌入 service binary；启动后直接访问 service 地址即可。`make check` 执行 Go 测试、静态检查与前端构建。

## 发布与本地连接

`make deploy` 是唯一发布入口：发布前在 Makefile 顶部维护唯一的 `RECUT_VERSION`，该值会同时写入 service、SHA-256 release manifest 和前端兼容版本。命令先为本地 mode 构建并嵌入工作台，随后为 macOS（Apple 芯片）与 Windows 的 arm64/amd64 构建压缩 self-contained service 包到 web static 目录，最后以 cloud mode 导出官网与工作台共用的 Next.js 静态产物并以 Wrangler 部署到同一个 Cloudflare Worker。`web/wrangler.toml` 是三个 Custom Domain 的唯一声明，部署时由 Cloudflare 管理 `recut.video`、`www.recut.video` 与 `app.recut.video` 的 DNS / Universal SSL 绑定；Worker 按 Host 分流：`recut.video` / `www.recut.video` 服务 Landing、Docs 与 Blog，`app.recut.video` 服务本地 service 驱动的创作工作台；官网的「打开工作台」统一跳转至 App Host。Cloudflare 静态站必须保留这些二进制包供用户安装；嵌入 binary 的本地工作台则明确排除它们，避免循环依赖。`make web-deploy` 保留为等价兼容命令。将三个域名绑定到该 Worker 后，macOS（Apple 芯片）用户可运行 `curl -fsSL https://recut.video/install.sh | sh`；Windows 用户在 PowerShell 运行 `irm https://recut.video/install.ps1 | iex`。Unix 安装器以阶段日志下载并校验 service，然后在 `~/.recut/` 自动预置受管 Python 3.11、默认 venv 与 FFmpeg；App 可覆盖版本或 venv，但不安装系统前置。macOS 注册 launchd，Windows 注册当前用户登录任务。重复执行即升级。Linux、FreeBSD 与 Intel Mac 暂不随发布提供，可在宿主机用 `make service-build`/`make service-install` 从源码自行构建。Worker 不代理本地 API，也不会接触项目、素材或 BYOK 凭据；service 默认监听局域网 API 地址 `:17373`，并在 `:17374` 承载浏览器事件流，浏览器可使用宿主机的 LAN IP 直接连接。

`make service-build` 默认构建当前平台；交叉编译使用 `make service-build TARGET=windows-amd64`（同样支持 `darwin-arm64`、`windows-arm64`）。`make service-install RECUT_VERSION=0.1.0` 可从源码构建并安装当前 macOS 主机的二进制，注册为 launchd user service；Linux、FreeBSD 与 Intel Mac 暂不提供，只能自行从源码构建二进制。用户从 `https://recut.video` 了解产品、阅读 Docs 或 Blog，再经 `https://app.recut.video` 打开工作台；App Host 默认检测本地 service，缺失时提供安装或已有远程 service 的连接入口。远程 service 需对浏览器可达并允许 `https://app.recut.video` 的跨域请求。开发时对应为 `http://localhost:3000` 与 `http://app.localhost:3000`。`make service-status` 用于检查常驻 service。

首页包含 **Project**、**Apps** 与素材库 Tab。素材库是 service 内置的原生 React 平台能力，不属于 Git 安装、App Catalog、升级管理或 iframe；它的隐藏 media scope 仅服务资产归属和 Agent 会话。首个内置 App Remotion Studio 随 binary 同步，其他 App 可安装 HTTPS GitHub 仓库，service 只在 clone 后验证标准 `manifest.json` 才激活。已安装的 Git App 定期抓取 `origin`，再以 `git status --porcelain --branch` 读取工作树和 behind 状态；后台检查结束经事件流刷新工作台目录，使更新提示无需页面轮询或手动刷新。升级拒绝覆盖本地修改，只运行 `git pull --ff-only`；远端更新和本地修改同时存在时，界面明确提示更新已发现且本地修改受保护，目录仅在存在可安全升级条目时展示一键更新。安装、升级和本地 service 出错时，界面提供可复制给 Codex 或 Claude Code 的诊断任务，而不猜测性修改本机状态。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
