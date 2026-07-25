# service/

> L2 | 父级: /README.md

成员清单
main.go: 组合 Daemon、AppHost、MCP Host 与 loopback HTTP 服务。
catalog.go: 只读取和校验 manifest.json，不理解 App 数据布局。
project.go: 创建平台项目并按 App scope 提供 SQLite、文件与 Artifact 存储。
runtime.go: 在 Goja sandbox 中执行 App background.js，并注入 capability API。
mcp.go: 将平台的 recut.project_context 与当前 App 的 manifest.mcp.tools 路由给 JavaScript handler。
server.go: 提供项目、App UI、App API、Artifact 与终端 HTTP 边界。
bridge.go: 管理 Agent session 与本地 CLI 连接，并把当前 App 的 AGENTS.md 注入 Codex 项目 guide。
agent.go: 保存本机用户的一对一 Agent 会话、消息与事件；同一会话把生成期间的新消息持久化为 FIFO 待发送队列，并将 Codex JSONL 规范化为含工具名称、摘要详情和停止状态的 UI 时间线协议。
agent_server.go: 提供 Agent Session 的创建、待发送消息入队、停止、查询与 SSE 事件 API。
media.go: 平台级媒体资产、BYOK 凭据加密、Provider Registry、模型目录、用途 Route、按能力校验的图片/音频上下文、导入图片、异步生成任务与 OpenAI-compatible 图片适配器；生成资产保存提示词、模型、能力和参考素材 ID，图片引用会以 multipart 上传至编辑端点，通用兼容路由默认使用经实测可用的 GPT Image 2。
media_server.go: 素材库、图片导入、模型、凭据、路由、任务和资产内容的 HTTP API。
media_test.go: 验证媒体凭据不泄漏、Provider 模型归属、隐藏素材库系统项目、默认路由、模型/凭据直连校验和生成任务幂等性。
terminal.go, ws.go: PTY 和事件传输基础设施。
*_test.go: manifest、存储与 JS runtime 的回归验证。

依赖关系

`Catalog -> Store -> AppHost -> Server/MCP Host`；`MediaService -> Provider Registry -> WorkspaceDatabase/media files -> Server/MCP Host` 是平台级资源路径；`AgentManager -> Store.WorkspaceDatabase -> Codex JSONL` 是平行的对话协议路径。PTY 保留在 `TerminalManager`，仅作兼容与诊断，不能成为对话 UI 的真相源。App 代码只能经 `ctx.sqlite`、`ctx.files`、`ctx.artifacts` 或 `recut.media.*` 使用平台资源；Host 决定权限和实际路径。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
