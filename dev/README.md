# dev/

> L2 | 父级: /README.md

成员清单
2026-07-27-broll-agent-current-flow.md: 基于真实 Vox B-roll 项目、浏览器与本地持久化记录的 Agent—媒体任务执行链审计；列出当前阻塞点与同步化边界。
2026-8-5-agent-context.md: 会话上下文现状与「App/项目以 skill 形态跨场景可用、MCP 动态注册」的三层解耦思考。
2026-8-5-agent-session-refactor.md: 四层解耦（能力/状态/会话/平台）重构方案：Agent Task 组合输入 Doc 与 Asset 并交付一个或多个输出 Doc、每个 App 单一 storage.sqlite（全局 + 所有 Project 按 project_id 分区）与项目动态 files、无项目 App state、owner App 操作驱动的跨 Doc 读取、浮动会话的默认 Doc 快照、标准 skill 树、动态 MCP 与外部 Agent 封装。

此目录保存可追溯的开发审计与设计记录，不参与运行时。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
