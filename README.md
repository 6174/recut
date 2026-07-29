# Recut - Local-first Extension Host

Recut 是本地 AI 视频工作台，也是类似 Chrome 的 App Host：App 用 JavaScript 定义 UI 与业务，平台提供隔离存储、文件、任务、素材、Artifact 和 MCP capability。

技术栈：Next.js + React 工作台，Go Daemon，Goja JavaScript sandbox，平台托管 SQLite，MCP stdio。

```text
apps/             本地 App 包与 Vox B-roll submodule；通过 make app-link 链接到运行时目录
.gitmodules       外部 App 源码的固定远端与分支配置
scripts/          当前用户生产 service 的 launchd/systemd 安装器
dev/              开发审计与设计记录；不参与运行时
service/          Daemon：Extension Registry、JS runtime、Media Platform、storage/MCP/HTTP capability
web/              平台工作台：项目、素材库系统应用与 App UI 容器
ARCHITECTURE.md   Extension Host 契约与 B-roll 案例
Makefile          本地开发、生产 service 安装与 Cloudflare Worker 部署入口
```

## 核心法则

- `manifest.json` 是 App 唯一运行时配置：身份、作者、简短描述、可选 Git 仓库、类型、入口、权限、可选 `onboarding` 引导卡和一次定义的 `operations`。每个 onboarding 必须显式声明 `id`、`title` 和点击后写入的 `prompt`；每个 operation 以 `surfaces` 声明供 UI API、Agent MCP 或两者使用，避免同一业务契约重复。
- `type: project` 绑定项目；`type: standalone` 绑定工作区。它们使用同一运行时和 capability API。
- App 数据模型属于 App 的 JavaScript。平台不解析 `project-layout.json`，不规定表、JSON 文件或工作流步骤。
- SQLite 是资源真相：App state、Artifact、事件、引用与版本均存表中；媒体平台在 `workspace.sqlite` 管理跨项目 Asset、Provider BYOK 凭据、用途模型 Route 与任务，文件根只保存内容寻址的大二进制，数据库保存其哈希引用。异步媒体先原子持久化稳定的 queued Asset 与 Job；常驻 Daemon 用 SQLite lease 和外部调用 checkpoint 提交 prediction、原位推进 Asset，并周期回收终态。只有已持久化的 prediction 可安全重试，未知外部提交保留原 Asset 并明确失败，避免重复收费；前端只读本地状态。所有媒体依赖以全局 `assetId` 表达；用户上传也先成为带 `origin: user-upload` 的 Asset，再绑定项目与 Agent turn。用户 Agent 对话同样位于根目录 `workspace.sqlite`，与项目数据库解耦。
- App 之间通过公开 API 和不可变 Artifact 引用协作，绝不读取彼此数据库或文件目录。
- Agent 只连平台 MCP Host。Host 以按媒介类型划分的 `recut.image.generate`、`recut.video.generate_async`、`recut.speech.generate_async` 暴露生成能力，另以 `recut.media.*` 提供配置、任务和素材管理；`recut.project_context` 直接携带用户配置的默认媒体路由、模型契约和可选参数。图片同步返回资产或终态错误，视频与语音显式返回异步 Job。当前 App 的业务工具仍由 manifest 约束。
- Chat UI 消费结构化 Agent Session 事件；Codex/Claude 等 native session id 只用于续聊，终端 PTY 保留为兼容与诊断通道。
- 前端表单控件必须有与 `id` 关联的可见 `label`；`placeholder` 只用于填写示例，不能承担字段名称或可访问性语义。
- 运行时 App 根默认为 `~/.recut/apps`。开发时运行 `make app-link`，将本仓库的 App 源码包逐个链接到此目录；生产安装可在相同位置放置 Git clone。服务不再从源码仓库的 `apps/` 直接加载。
- 每个项目在 `.recut/app` 创建指向当前 App 包的符号链接。每个 Codex turn 由 Go 后端内嵌的 `service/prompts/core-agents.md.tmpl` 渲染平台 guide，并注入当前 App 自己的 `AGENTS.md`；该 guide 指示 Agent 从 `.recut/app` 读取、测试和按需修改当前 App 源码。

运行 `git submodule update --init --recursive` 获取 Vox B-roll 后，再运行 `make app-link` 链接全部本地 App；只链接一个包时使用 `make app-link APP=apps/vox-broll`。随后运行 `make dev`。

运行 `make dev` 启动服务和工作台；其 service 固定报告为 `dev`，只能由开发命令停止/重启，网页管理器会明确禁用生产 service 操作。`make check` 执行 Go 测试、静态检查与前端构建。

## 发布与本地连接

`make deploy` 是唯一发布入口：发布前在 Makefile 顶部维护唯一的 `RECUT_VERSION`，该值会同时写入 service、SHA-256 release manifest 和前端兼容版本。命令随后为 macOS、Linux、FreeBSD 与 Windows 的 arm64/amd64 构建压缩 service 包到 web static 目录，导出 Next.js 工作台并以 Wrangler 部署到 Cloudflare Worker。`make web-deploy` 保留为等价兼容命令。将 `recut.video` 绑定到该 Worker 后，macOS、Linux 或 FreeBSD 用户可运行 `curl -fsSL https://recut.video/install.sh | sh`；Windows 用户在 PowerShell 运行 `irm https://recut.video/install.ps1 | iex`。安装器从 release manifest 读取版本、校验 CPU 对应包的 SHA-256、保留用户数据；macOS 注册 launchd，Linux 注册 systemd user service，Windows 注册当前用户登录任务，FreeBSD 输出供进程管理器使用的启动命令。重复执行即升级。Worker 不代理本地 API，也不会接触项目、素材或 BYOK 凭据；浏览器只连接用户自己的 `http://127.0.0.1:17373`。

`make service-build` 默认构建当前平台；交叉编译使用 `make service-build TARGET=windows-amd64`（同样支持 `darwin-*`、`linux-*`、`freebsd-*`）。`make service-install RECUT_VERSION=0.1.0` 可从源码构建并安装当前 Unix 主机的二进制，注册为 macOS launchd 或 Linux systemd user service；FreeBSD 保留由宿主进程管理器启动。首次打开 `https://recut.video` 时，前端默认检测本地 service；缺失时可安装本地 service，也可在设置中填入已有远程 service 的根地址。远程 service 需对浏览器可达并允许 `https://recut.video` 的跨域请求。`make service-status` 用于检查常驻 service。

首页只有 **Project** 与 **Apps** 两个核心 tab。素材库是随 Recut service 自带的系统 App，不属于 Git 安装或升级管理；Apps 中其余 App 可安装 HTTPS GitHub 仓库，service 只在 clone 后验证标准 `manifest.json` 才激活。已安装的 Git App 使用 `git status --porcelain --branch` 读取工作树和 behind 状态；升级拒绝覆盖本地修改，并只运行 `git pull --ff-only`。安装、升级和本地 service 出错时，界面提供可复制给 Codex 或 Claude Code 的诊断任务，而不猜测性修改本机状态。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
