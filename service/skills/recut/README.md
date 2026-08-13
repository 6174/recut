# recut/

> L2 | 父级: /service/skills/README.md

成员清单
SKILL.md: Recut 平台的全局 Agent 协议，独立文本（`OutputFormat: url` 第三方约定）。先检查 Recut MCP 可用性，离线时引导安装 service 并打开 recut.video，在线后发现项目、App 工作流与媒体能力，不复制任何 App 私有规则。它与 `service/prompts/core-agents.md.tmpl`（`OutputFormat: xml`，服务内建 bridge 渲染）是两个独立文档而非同一来源：规则覆盖一致，唯一约定分叉是最终回复的引用格式——本 Skill 输出 `https://recut.video/...` 深链，绝不输出 `<media>`/`<project>`/`<app>` 受控 XML 标签。变更平台规则时两份要分别维护，`service/recut_skill_test.go` 与 `service/bridge_prompt_test.go` 的分叉不变量负责锁住一致性。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
