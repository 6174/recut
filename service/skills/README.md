# skills/

> L2 | 父级: /service/README.md

成员清单
recut/: Recut 对外平台 Skill 包；编译进 service，启动时原子同步到 `~/.recut/skills/recut`，供 Codex、Claude Code、OpenCode 和通用 Agent 软链接复用；支持的 Agent 同时注册匿名本机 Recut MCP。
recut-design-system/: 全局设计系统参考库；直接复用 Open Design 的抽象风格定义，供任意 App 的 Agent 按风格 ID 读取。
recut-create-app/: 全局「创建 App」参考库；指导从零打造标准 Recut App（manifest + background + 可选 iframe UI + 平台通讯契约），编译进 service 并同步到 `~/.recut/skills/recut-create-app`。
recut-worlds/: World 与 World Canvas 的通用操作技能；World Canvas 是没有独立安装包的第一公民 App，本技能回答「怎么调用 `recut.worlds.*`」——读/写实体、关系、类型、证据与画布 ops/promote，并在世界语境里把媒体生成接到 `recut-directing-generation-prompt`（STYLE LOCK + `<reference>` 锚定）。与 world.md（某个世界的内容/生产工作流）分层。
recut-directing-*/: 全局导演技能库（RFC: rfc/2026-08-29-global-directing-skills.md）；App 无关的导演决策知识，每个技能只回答一个唯一决策问题（SKILL.md 中文决策路由层 + references 原文搬运的深化知识）。已落地 15 个：director（唯一路由入口）/ story（故事编排）/ hooks（0–3s 钩子与留存）/ a-roll（说话内容取舍）/ b-roll（B-roll 选材与摆放）/ shot（镜头分镜含 20 导演风格库）/ generation-prompt（生成提示词形状与 `<reference>` 锚定）/ motion（元素动效）/ editing（节奏切点卡点）/ captions（字幕上屏）/ sound（VO/BGM/SFX）/ platform（平台规格与雷区）/ remix（长转短与爆款仿拍）/ short-drama（剧情生产编排）/ qc（失败诊断与验收门禁）。apps/editor 与 apps/remotion-studio 的 references 已瘦身为薄适配层（保留介质映射，决策指向全局）。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
