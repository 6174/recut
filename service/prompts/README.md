# prompts/

> L2 | 父级: /service/README.md

成员清单
core-agents.md.tmpl: 平台级 Agent 模板（服务内建 bridge 渲染，`OutputFormat: xml`，**中文单语**，无双语分支）。结构固定为「静态在前、动态在后」五段——① **平台介绍与结构**（App/Project/Skill/World/Asset/Job/Canvas/Editor）→ ② **技能路由**（canvas→`recut-worlds`、editor 时间线/落轨→`recut-editor`、Motion Graphic 创作→`recut-motion-graphic`、导演方法→`recut-director`、设计系统→`recut-design-system`、其余按 `appId`，含 `skills.read/reference` 加载纪律）→ ③ **格式与规则**（上下文刷新协议、工具与目标解析、视频表达基线、媒体回复协议、统一任务观察与 48KB 输出预算、受控 XML 引用格式、App 管理与可选集成、Codex 原生图片、Creation Worlds 规则与 onboarding、文件系统与原生工具）→ ④ **动态配置**（`CapabilityJSON`：已安装 App、平台/App skills 元数据、媒体就绪、integrations；仅元数据不含 skill 正文）→ ⑤ **当前系统信息**（`SystemJSON`：session id/taskId/runtime/model + `.recut` 绝对 `paths` 与解析好的 `layout` 目录树）。动态两段由 `renderSessionGuide(session)` 在文末注入。**内建桥会话正常运行只走本 guide**：接口层按会话来源区分——内建会话的 `tools/list` 不含 `recut.context`、skills 清单不含外部专属的 `recut`；`recut.context` 对内建会话只回 session 身份（能力载荷不再重复搬运），完整能力载荷只服务**外部** MCP 客户端。第三方宿主对应的 `OutputFormat: url` 文档是独立文本 `service/skills/recut/SKILL.md`（只输出 `https://recut.video/...` 深链）；两者不是同一来源渲染，靠 recut_skill_test.go / bridge_prompt_test.go 的分叉不变量保持规则一致。领域规则仍留在各自 App 包的 SKILL.md，不注入任何 App 全文。
bridge-instructions.md: MCP `project_context` 与传统终端启动时使用的平台级简短操作提示。

该目录属于 Go 后端实现，编译时通过 `go:embed` 打入服务二进制。应用领域规则仍留在各自 App 包的 `AGENTS.md`。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
