# Recut - Local-first Extension Host

Recut 是本地 AI 视频工作台，也是类似 Chrome 的 App Host：App 用 JavaScript 定义 UI 与业务，平台提供隔离存储、文件、任务、素材、Artifact 和 MCP capability。

技术栈：Next.js + React 工作台，Go Daemon，Goja JavaScript sandbox，平台托管 SQLite，MCP stdio。

```text
apps/             App 包：每个包只有 manifest.json 与自己的 JS/UI 代码
dev/              开发审计与设计记录；不参与运行时
service/          Daemon：Extension Registry、JS runtime、Media Platform、storage/MCP/HTTP capability
web/              平台工作台：项目、素材库系统应用与 App UI 容器
ARCHITECTURE.md   Extension Host 契约与 B-roll 案例
Makefile          本地开发入口；启动前会安全清理本项目残留的后端与前端进程
```

## 核心法则

- `manifest.json` 是 App 唯一运行时配置：身份、类型、入口、权限、API 和 MCP 工具。
- `type: project` 绑定项目；`type: standalone` 绑定工作区。它们使用同一运行时和 capability API。
- App 数据模型属于 App 的 JavaScript。平台不解析 `project-layout.json`，不规定表、JSON 文件或工作流步骤。
- SQLite 是资源真相：App state、Artifact、事件、引用与版本均存表中；媒体平台在 `workspace.sqlite` 管理跨项目 Asset、Provider BYOK 凭据、用途模型 Route 与任务，文件根只保存内容寻址的大二进制，数据库保存其哈希引用。用户 Agent 对话同样位于根目录 `workspace.sqlite`，与项目数据库解耦。
- App 之间通过公开 API 和不可变 Artifact 引用协作，绝不读取彼此数据库或文件目录。
- Agent 只连平台 MCP Host。Host 始终暴露 `recut.media.*` 平台工具；`recut.project_context` 直接携带用户配置的默认媒体路由、模型契约和可选参数，生成时使用该 default route。`recut.media.generate` 默认同步返回资产或终态错误；长任务必须显式使用 `recut.media.generate_async`。当前 App 的业务工具仍由 manifest 约束。
- Chat UI 消费结构化 Agent Session 事件；Codex/Claude 等 native session id 只用于续聊，终端 PTY 保留为兼容与诊断通道。
- 每个 Codex turn 同时注入平台 guide 与当前 App 的 `AGENTS.md`；先调用 `recut.project_context` 获得项目与 Artifact 真相，再按 manifest 选择 App 工具。

运行 `make dev` 启动服务和工作台；`make check` 执行 Go 测试、静态检查与前端构建。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
