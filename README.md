# Recut - Local-first Extension Host

Recut 是本地 AI 视频工作台，也是类似 Chrome 的 App Host：App 用 JavaScript 定义 UI 与业务，平台提供隔离存储、文件、任务、素材、Artifact 和 MCP capability。

技术栈：Next.js + React 工作台，Go Daemon，Goja JavaScript sandbox，平台托管 SQLite，MCP stdio。

```text
apps/             App 包：每个包只有 manifest.json 与自己的 JS/UI 代码
service/          Daemon：Extension Registry、JS runtime、storage/MCP/HTTP capability
web/              平台工作台：发现、打开和承载 App UI
ARCHITECTURE.md   Extension Host 契约与 B-roll 案例
```

## 核心法则

- `manifest.json` 是 App 唯一运行时配置：身份、类型、入口、权限、API 和 MCP 工具。
- `type: project` 绑定项目；`type: standalone` 绑定工作区。它们使用同一运行时和 capability API。
- App 数据模型属于 App 的 JavaScript。平台不解析 `project-layout.json`，不规定表、JSON 文件或工作流步骤。
- SQLite 是资源真相：App state、Artifact、事件、引用与版本均存表中；文件根只保存图片、视频、音频等大二进制，数据库保存其 `fileId`/内容哈希引用。用户 Agent 对话另存为根目录 `workspace.sqlite`，与项目数据库解耦。
- App 之间通过公开 API 和不可变 Artifact 引用协作，绝不读取彼此数据库或文件目录。
- Agent 只连平台 MCP Host。Host 从当前 App 的 manifest 暴露工具，再将调用路由给 `background.js`。
- Chat UI 消费结构化 Agent Session 事件；Codex/Claude 等 native session id 只用于续聊，终端 PTY 保留为兼容与诊断通道。
- 每个 Codex turn 同时注入平台 guide 与当前 App 的 `AGENTS.md`；先调用 `recut.project_context` 获得项目与 Artifact 真相，再按 manifest 选择 App 工具。

运行 `make dev` 启动服务和工作台；`make check` 执行 Go 测试、静态检查与前端构建。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
