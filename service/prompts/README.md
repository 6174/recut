# prompts/

> L2 | 父级: /service/README.md

成员清单
core-agents.md.tmpl: 平台级 Codex Agent 模板；定义 MCP 工作边界、生成后 `<media>` 资源引用协议，并以 Go `text/template` 的 `.AppID`、`.AppName`、`.AppGuide` 注入当前 App 上下文。
bridge-instructions.md: MCP `project_context` 与传统终端启动时使用的平台级简短操作提示。

该目录属于 Go 后端实现，编译时通过 `go:embed` 打入服务二进制。应用领域规则仍留在各自 App 包的 `AGENTS.md`。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
