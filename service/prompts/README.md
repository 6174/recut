# prompts/

> L2 | 父级: /service/README.md

成员清单
core-agents.md.tmpl: 平台级 Agent 模板；定义会话上下文快照协议（首轮 `recut.context`，15 分钟内复用）、真实项目必须由 `recut.project.create` 创建、项目内 Artifact 绝不冒充项目的 MCP 工作边界、媒体异步 job 生命周期（提交后 `recut.media.wait_for_job` 到 `completed` 才算成功，`ready`/`not-configured`/`codex-native` readiness 门）、目标解析、App 管理、Creation Worlds 只读规则，以及引用输出格式。渲染时以 `OutputFormat` 区分两种宿主：`xml`（服务内建 bridge 渲染，Recut chat UI 解析 `<media>`/`<project>`/`<app>` 受控标签为卡片与预览）与 `url`（第三方 Agent 只输出 `https://recut.video/...` 深链），以 `External` 区分是否附带外部 Skill 的连接检查与前端注记。领域规则仍留在各自 App 包的 SKILL.md，不注入任何 App 全文。
bridge-instructions.md: MCP `project_context` 与传统终端启动时使用的平台级简短操作提示。

该目录属于 Go 后端实现，编译时通过 `go:embed` 打入服务二进制。应用领域规则仍留在各自 App 包的 `AGENTS.md`。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
