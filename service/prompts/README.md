# prompts/

> L2 | 父级: /service/README.md

成员清单
core-agents.md.tmpl: 平台级 Codex Agent 模板；定义每个 Turn 必须先由 `recut.context` 读取会话上下文（已安装 App、skill 目录与媒体配置，不携带项目默认值）、真实项目必须由 `recut.project.create` 创建、项目内 Artifact 绝不冒充项目的 MCP 工作边界，生成后 `<media>` 资源引用协议，要求旁白异步提交后等待本地 job 终态，并在未配置图片路由或默认图片路由为 `codex/image` 时改用 Codex 原生生图并导入 Recut 素材，以 Go `text/template` 的 `.AppID`、`.AppName`、`.AppGuide` 注入当前 App 上下文。
bridge-instructions.md: MCP `project_context` 与传统终端启动时使用的平台级简短操作提示。

该目录属于 Go 后端实现，编译时通过 `go:embed` 打入服务二进制。应用领域规则仍留在各自 App 包的 `AGENTS.md`。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
