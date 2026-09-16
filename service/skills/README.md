# skills/

> L2 | 父级: /service/README.md

成员清单
recut/: Recut 对外平台 Skill 包；编译进 service，启动时原子同步到 `~/.recut/skills/recut`，供 Codex、Claude Code、OpenCode 和通用 Agent 软链接复用；支持的 Agent 同时注册匿名本机 Recut MCP。
recut-design-system/: 全局设计系统参考库；直接复用 Open Design 的抽象风格定义，供任意 App 的 Agent 按风格 ID 读取。
recut-create-app/: 全局「创建 App」参考库；指导从零打造标准 Recut App（manifest + background + 可选 iframe UI + 平台通讯契约），编译进 service 并同步到 `~/.recut/skills/recut-create-app`。
recut-worlds/: World 与 World Canvas 的通用操作技能；World Canvas 是没有独立安装包的第一公民 App，本技能回答「怎么调用 `recut.worlds.*`」——读/写实体、关系、类型、证据与画布 ops/promote，并在世界语境里把媒体生成接到 `recut-director` 的 `references/generation-prompt`（STYLE LOCK + `<reference>` 锚定）。与 world.md（某个世界的内容/生产工作流）分层。
recut-director/: 全局导演技能库（RFC: rfc/2026-08-29-global-directing-skills.md）的**唯一对外入口**；只回答「这次创作走什么链、按什么顺序」。14 个导演决策子技能以 references 文档内联：story / hooks / shot / motion / a-roll / b-roll / editing / captions / sound / platform / remix / short-drama / generation-prompt / qc（外加 references/modes/ 的已验证 Mode 工作流与 references/director-router-origin.md 原始路由）。Agent 先加载 `recut-director/SKILL.md` 定链，再按 `references/<子技能>/SKILL.md` 用 `recut.skills.reference` 逐环节加载；子技能内部的深化文档路径已统一为相对本技能根。apps/editor 与 apps/remotion-studio 的 references 已瘦身为薄适配层（保留介质映射，决策指向 `recut-director`）。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
