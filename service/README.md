# service/

> L2 | 父级: /README.md

成员清单
go.mod: 本地 Recut shell service 的 Go 模块定义，不依赖公开仓库路径。
main.go: 解析运行参数并启动本机 Daemon。
bridge.go: 管理短期 Agent 会话、状态投影、按需 source state 读取、版本化提案、可审计提交与撤销事务。
mcp.go: 通过 stdio JSON-RPC 暴露通用 App Agent Bridge MCP 工具。
catalog.go: 加载和校验声明式 App 包及其 Project Layout Descriptor。
project.go: 创建、列举、读取本地项目包及其声明 source state，落实 core 与 App namespace 的边界。
server.go: 提供仅限 loopback 的 App、项目、CLI 探测、终端 HTTP API 与本地工作台 CORS 边界。
ws.go: 提供项目事件 WebSocket，向 UI 推送 Agent proposal、提交、撤销和任务事件。
terminal.go: 通用 PTY 会话包装层，提供 CLI 启动、输入、尺寸调整、输出订阅、终止、项目内 transcript 持久化与最新可读输出摘要。
project_test.go: 验证项目创建时的平台核心与 App 私有文件结构。
terminal_test.go: 验证终端会话的 append-only transcript 可在管理器重建后恢复。
bridge_test.go: 验证 Agent 只能提交声明的 App source state，且提交必须基于当前 revision。

服务边界
此目录是完整的本地 shell service。文件采用同一个 Go package，避免人为的 `cmd/`、`internal/` 分层；前端仅通过其 HTTP API 交互。`terminal.go` 不携带 App 业务语义；启动项目关联的 Codex 或 Claude Code 时，`bridge.go` 创建一次性 session token，`server.go` 注入客户端 MCP 配置与最小启动提示，`mcp.go` 以受限 stdio server 服务该 session。App 状态永远经 Bridge 的 context / proposal / commit 事务读取或变更，UI 只消费 Daemon 状态。项目终端会话存于项目的 `sessions/terminals/<id>/`，Bridge 元数据存于全局 `sessions/agent-bridge/<id>/`；重启后恢复历史记录而不伪造已退出进程。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
