# rfc/

> L2 | 父级: /README.md

成员清单
2026-08-12-creation-worlds.md: Creation Worlds 顶级工作台、创作上下文绑定、版本化 Canon、跨 App / MCP 契约与 Remotion MVP 的实施 RFC。
2026-08-12-creation-worlds-technical-design.md: Creation Worlds 的 workspace SQLite、Go service facade、SDK/MCP、权限、Web/Remotion 接入、迁移与测试的技术实施 RFC。
2026-08-13-visual-runtime-component-system.md: Recut Visual Runtime 与 Component System：世界（场景图）+ 时间线创作表面、R3F 全权渲染、组件即代码对象、材质混合与排序规则、Preview/Export 统一与分阶段实施路线。
2026-08-14-editor-data-model-selection.md: 编辑器数据模型（DocumentData + EditorState + Ephemeral Layer + NodeState）与选区/元素定位架构：单一解析入口、实时渲染几何 bbox、Model API（含关键帧提交策略）、渲染路径收缩与 Chromium 自测方案。
2026-08-14-realtime-channel-ws.md: 平台实时通道的单 WS 收敛：一条长连接 + channels 订阅 + 心跳保活 + REST 首屏取数 + 单后台账本转发，以及 iframe App 的宿主桥/直连 WS 双链路传输抽象。
2026-08-14-ai-temp-components.md: AI 临时组件（Temp Components）：代码即项目内临时素材。surface 作者分级（html/react/r3f）、source+bundle 同版本持有、head 跟随语义、@recut/runtime 托管 SDK 与服务端构建工具链、安全边界与验证闭环。
2026-08-14-editor-ai-agent-surface.md: recut.editor 面向 AI 的完整 MCP 工具面与 Skill 契约。操作驱动取代文档驱动；Headless 共享 Model API 单写入口；统一 op 日志（snapshot undo 单一权威）；aiLock 会话锁 + baseVersion 乐观并发；版本号/op 广播双档前端同步；preview.frame 视觉验证闭环；headless 双模导出；SKILL.md + references 分层技能与端到端验证方案（L0-L4）。
2026-08-14-creation-worlds-product-reframe.md: Creation Worlds 面向完整用户产品的重构 RFC：以创作设定替代 Geek 数据表面，定义类型化编辑、完整生命周期、AI WorldBrief 与需确认的写回契约，并规划旧 Canon 的渐进迁移。
2026-08-15-editor-chatcut-adoptions.md: recut.editor 系统性吸收 ChatCut 对标结论：script-first 文稿剪辑面（script.read/apply/clean）、speech-track 转录来源、track role 自动 duck + audio.smooth、catalog-first 内置效果/SFX 目录、skill 工艺层（speech-editing/subject-protection/errors references）与验证/生成纪律，并明确不采纳边界（保留 op 日志、确定性关键帧、preview==export、本地渲染）。
2026-08-16-marketing-seo-social-share.md: 官网 SEO 与社交分享完整方案：逐路由元数据与默认 noindex、canonical/域名收敛（www 301、/marketing 别名、软 404）、robots.txt/sitemap.xml、Open Graph/Twitter Card 与微信/微博/X/LinkedIn 等平台分享预览、OG 图片静态生成、JSON-LD 结构化数据、工作台 noindex 隔离、Worker 边缘调整、图标集与 Blog 内容补强。

此目录保存尚未实施或分阶段实施的平台设计决策。RFC 定义目标、边界、数据与接口契约；获批实现后，代码与运行时文档必须反向更新以保持一致。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
