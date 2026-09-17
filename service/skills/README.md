# skills/

> L2 | 父级: /service/README.md

成员清单
recut/: Recut 对外平台 Skill 包；编译进 service，启动时原子同步到 `~/.recut/skills/recut`，供 Codex、Claude Code、OpenCode 和通用 Agent 软链接复用；支持的 Agent 同时注册匿名本机 Recut MCP。
recut-design-system/: 全局设计系统参考库；直接复用 Open Design 的抽象风格定义，供任意 App 的 Agent 按风格 ID 读取。
recut-create-app/: 全局「创建 App」参考库；指导从零打造标准 Recut App（manifest + background + 可选 iframe UI + 平台通讯契约），编译进 service 并同步到 `~/.recut/skills/recut-create-app`。
recut-worlds/: World 与 World Canvas 的通用操作技能；World Canvas 是没有独立安装包的第一公民 App，本技能回答「怎么调用 `recut.worlds.*`」——读/写实体、关系、类型、证据与画布 ops/promote，并在世界语境里把媒体生成接到 `recut-director` 的 `references/generation-prompt`（STYLE LOCK + `<reference>` 锚定）。与 world.md（某个世界的内容/生产工作流）分层。
recut-reference/: 参考理解技能（RFC: rfc/2026-09-17-reference-understanding.md）。只回答「怎么读懂一支参考并留下可复用的证据与参考分析」：调用 `recut.media.*` 理解工具（probe/frames/contactSheet/boundaries/clip/measure 已实施；words 可选且默认关），把观察写参考素材的 `metadata.reference`、把分析按规范写 `attributes`（ref.*）与 `content`（富文本，可 @ 引用证据/World）。环境缺失时先 `recut.media.understand.status` 再 `understand.prepare`。不决定「换成什么」（归 `recut-director（references/remix）`）。
recut-clone/: 克隆执行技能（RFC 同上，§4/§5/§6）。只回答「给定参考与目标，怎么跑成一条可交付的新片」：S1 理解（recut-reference）→ S2 决定（remix）→ S3 计划（content-first 占位素材，`recut.media.asset.create` 已实施）→ S4 生成（recut.media.* / motion-graphic）→ S5 组装与交付（**直接用 timeline-editor / `recut.editor.*`**），五道门（G1 理解/G2 计划/G3 付费/G4 落轨/G5 交付 Done means watched）。
recut-editor/: 时间线编辑契约，随内置剪辑器 App 分发（`apps/editor/skills/recut-editor`）。编辑器 UI 已原生并入 web `timeline-editor`、op 已下沉 Go，但该技能仍由 App 包携带：surface `requiredSkill=recut-editor` 解析到 `appId=recut.editor`（`service/builtin_apps` 的 editor 包不再排除 `skills/`）。`recut-clone/references/placement.md` 依赖它。
recut-motion-graphic/: 全局 Motion Graphic 创作技能（appId=`recut.platform`，App 无关）：只回答「怎么把一个 viewer job 做成可复用、可验证的图形素材」——视觉语法与 surface 选择、`@recut/runtime` 组件创作、inputs/确定性动画、`motion-graphic.create/revise/update` 构建与 verified 素材、复用边界与目标帧验证。创作知识全局化，不私有于任何 App；导演取舍归 `recut-director（references/motion）`、时间线落轨归 `recut-editor`。原 `recut-editor/references/{motion-graphics,components,component-authoring,gsap}.md` 已迁入本技能（现为 `references/{material,authoring,gsap}.md`）。
recut-director/: 全局导演技能库（RFC: rfc/2026-08-29-global-directing-skills.md）的**唯一对外入口**；只回答「这次创作走什么链、按什么顺序」。14 个导演决策子技能以 references 文档内联：story / hooks / shot / motion / a-roll / b-roll / editing / captions / sound / platform / remix / short-drama / generation-prompt / qc（外加 references/modes/ 的已验证 Mode 工作流与 references/director-router-origin.md 原始路由）。Agent 先加载 `recut-director/SKILL.md` 定链，再按 `references/<子技能>/SKILL.md` 用 `recut.skills.reference` 逐环节加载；子技能内部的深化文档路径已统一为相对本技能根。apps/editor 与 apps/remotion-studio 的 references 已瘦身为薄适配层（保留介质映射，决策指向 `recut-director`）。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
