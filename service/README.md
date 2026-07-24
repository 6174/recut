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
agent.go: 保存本机用户的一对一 Agent 会话、消息与事件，并将 Codex JSONL 规范化为 UI 协议。
agent_server.go: 提供 Agent Session 的创建、发送、停止、查询与 SSE 事件 API。
terminal.go, ws.go: PTY 和事件传输基础设施。
*_test.go: manifest、存储与 JS runtime 的回归验证。

依赖关系

`Catalog -> Store -> AppHost -> Server/MCP Host`；`AgentManager -> Store.WorkspaceDatabase -> Codex JSONL` 是平行的对话协议路径。PTY 保留在 `TerminalManager`，仅作兼容与诊断，不能成为对话 UI 的真相源。App 代码只能经 `ctx.sqlite`、`ctx.files`、`ctx.artifacts` 访问平台资源；Host 决定权限和实际路径。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
