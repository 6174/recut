# recut-create-app

Recut 全局「创建 App」Skill。指导 Agent 从零创建一个标准 Recut App（manifest + background 业务 + 可选 iframe UI + 平台通讯契约），可安装、可测试、可随 Git 分发。

编译进 service，启动时原子同步到 `~/.recut/skills/recut-create-app`，供 Codex、Claude Code、OpenCode 和通用 Agent 软链接复用。

成员：`SKILL.md`（唯一正文）。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
