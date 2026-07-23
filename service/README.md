# service/

> L2 | 父级: /README.md

成员清单
go.mod: 本地 Recut shell service 的 Go 模块定义，不依赖公开仓库路径。
main.go: 解析运行参数并启动本机 Daemon。
catalog.go: 加载和校验声明式 App 包及其 Project Layout Descriptor。
project.go: 创建、列举和读取本地项目包，落实 core 与 App namespace 的边界。
server.go: 提供仅限 loopback 的 App、项目、CLI 探测、终端 HTTP API 与本地工作台 CORS 边界。
terminal.go: 通用 PTY 会话包装层，提供 CLI 启动、输入、尺寸调整、输出订阅、终止、项目内 transcript 持久化与最新可读输出摘要。
project_test.go: 验证项目创建时的平台核心与 App 私有文件结构。
terminal_test.go: 验证终端会话的 append-only transcript 可在管理器重建后恢复。

服务边界
此目录是完整的本地 shell service。文件采用同一个 Go package，避免人为的 `cmd/`、`internal/` 分层；前端仅通过其 HTTP API 交互。`terminal.go` 不携带 Agent 语义，Codex、Claude Code 或任意 CLI 都只是受控工作目录中的终端启动参数；服务端为一键 Codex 会话固定添加 `--dangerously-bypass-approvals-and-sandbox`。项目会话存于项目的 `sessions/terminals/<id>/`；未选择项目的会话在 `projects/` 根目录执行，metadata 与 transcript 存于全局 `sessions/terminals/<id>/`。重启后恢复历史记录而不伪造已退出进程。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
