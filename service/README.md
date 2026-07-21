# service/

> L2 | 父级: /README.md

成员清单
go.mod: 本地 Recut shell service 的 Go 模块定义，不依赖公开仓库路径。
main.go: 解析运行参数并启动本机 Daemon。
catalog.go: 加载和校验声明式 App 包及其 Project Layout Descriptor。
project.go: 创建、列举和读取本地项目包，落实 core 与 App namespace 的边界。
server.go: 提供仅限 loopback 的 App 与项目 HTTP API。
project_test.go: 验证项目创建时的平台核心与 App 私有文件结构。

服务边界
此目录是完整的本地 shell service。文件采用同一个 Go package，避免人为的 `cmd/`、`internal/` 分层；前端仅通过其 HTTP API 交互。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
