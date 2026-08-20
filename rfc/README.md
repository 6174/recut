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
2026-08-16-i18n-zh-en.md: 全站多语言（zh/en）整体方案：语言枚举与两种语言真相（官网 URL 驱动、工作台/Service/App 偏好驱动）、官网多路由与 Worker 重写映射、逐语言 metadata/hreflang/sitemap/canonical、内容模型 locale-keyed、轻量类型化字典、工作台偏好端点与 Accept-Language 传递、manifest.localized 契约、ctx.locale 注入、iframe 语言注入与 Agent guide/MCP 语言一致化。
2026-08-16-marketing-content-plan.md: 视频创作主题域内容计划：AI 视频生成/视频制作科普/工具文/创作方法论四个主题簇的选题库（Google 全球 + Google 中文视角）、内容形态配比（权威 60% / 承接 40%）、zh/en 双语言生产模型（对齐 i18n RFC）、P0–P2 执行顺序与榜单时效更新机制；P0 打样第一篇为「AI 视频生成后怎么剪辑」。
2026-08-16-i18n-zh-en.md: 全站 zh / en 双语言整体方案：两种语言真相（官网 URL 驱动、工作台/Service/App 偏好驱动）、官网多路由与 Worker 重写映射、逐语言 metadata/hreflang/sitemap/canonical、`lib/i18n` 类型化字典、`/v1/preferences` 偏好端点、Service 的 Accept-Language 传递、manifest `localized` 契约、`ctx.locale` 注入 background.js、iframe `?locale=` + 宿主桥 page.context.locale、Agent guide/MCP 语言一致化。
2026-08-16-editor-font-system.md: 编辑器字体系统：Recut 自有 CDN 自托管字体（cdn/fonts/google，fetch-fonts.mjs 编制上传，运行期零 Google 依赖）、service /v1/fonts 目录与字体文件 API（首次从自家 CDN 抓取 + 内容寻址缓存 + 离线可用）、Google Fonts / Local Fonts 双 Tab 面板、中文 CJK 家族与 unicode-range 按需加载、本机字体枚举（queryLocalFonts + SYSTEM_FONTS 扩充）、用户上传字体（FontFace 注册 + 持久化）、渲染/导出一致性，以及基于 Playwright 的分层 E2E（L1 Go httptest / L2 编辑器 fixtures mock / L3 全链路）。
2026-08-16-canonical-assets-opfs-cache.md: Canonical Assets：用户设备上 Recut Assets Service 是图片/视频/音频唯一真相源，App 经 `recut.assets` SDK 获取/上传素材，OPFS/IndexedDB 是按 `(assetId, contentHash)` 可重建缓存；规定跨域名/跨设备按需同步、渐进 Loading、离线状态、删除墓碑（“资源已删除”）与分阶段验收。
2026-08-16-agent-work-surface-context.md: Agent Work Surface Context：将当前页面从自由文本附件升级为宿主签发的目标绑定，并与 App 局部 Focus 分层；定义项目/World/素材/App 全页面语义、用户引导、领域 Skill 提示、迁移、测试与可观测性，不改变既有权限范围。
2026-08-16-editor-component-asset-workflow.md: 编辑器组件素材工作流：组件先入库、默认不落轨；模板化快速创建与平台可信验证；MCP/UI 统一时间线避碰 placement，并以原子批量放置消除同轨重叠。
2026-08-18-remotion-studio-music-font-finetunes.md: remotion-studio 音乐与字体微调：复用 Recut CDN（audio/fonts catalog 与编辑器同一份数据）与 catalog-first 架构，不做代码复用；音乐「选择即导入」为媒体资产走 composition.assets 物化管道、字体经 CDN 自托管 {id}.css 注入（caption 主题 palette.font 覆盖）、预览静音门控，MusicFineTune/FontFineTune 两模块与 Prompt 契约、选择持久化与 workflow.context 资源可见性，及分阶段实施与分层验证。
2026-08-18-subagent-task-card-ws.md: 子 Agent 任务卡片与全局预览：核心原则是子 Agent 与通用 Agent 会话同构（落 agent_sessions/agent_events 账本、复用 handleCodexEvent 事件解析与 agent channel），差异仅在受限工具面——执行一次性但记录持久化、可审计、可实时观察（修正"stdout 丢弃、无账本"的设计缺陷）。chat 工具事件携带 subagentId 判别字段（服务端注册表注入 tool.completed payload）→ 前端自动渲染任务卡片（状态/阶段/实时耗时 counter）→ 点击弹全局视图（本质就是复用 Conversation 渲染子会话 + subagent Meta 头）；子会话活动走 agent channel(childSessionId)、job 生命周期走新增 subagent channel(jobId)（账本回放、终态 available:false）。含 schema 迁移、三阶段 phase、REST cancel、审计链 parent→job→child，及"向子 Agent 发消息"的交互边界（同会话续谈 Phase 2 可行，运行中插话不可行）。
2026-08-18-editor-component-create-trace-issues.md: 第二次「Hello React 组件」创建链路事故的问题梳理：组件 verified 但素材库不显示（排版分两区 → 已合并单一网格）、`<app appid>` 引用标签在 prose 中被渲染成卡片、`recut.job.wait` 同步长轮询触发 MCP EOF、工具结果预览把 `component:` 资产当媒体资产导致永久 Loading、组件卡片无预览图（封面 harness 离屏 iframe 导致 rAF 挂死 → 已修复并验证，含复用 WorldRenderer 渲染路径的评估）。
2026-08-19-editor-component-create-resilience-and-compositing.md: 六组件产品介绍会话（7a13e308）复盘与架构修复方案，四堵墙：单一事实源（job 事件日志 + 状态机投影，终态一律 finalize）、边界分层（作者契约/错误面/验证权杖各归其位）、平台拥有框架模型只拥有内容（脚手架生成 + 结构化契约 + 构建闸=运行安全非类型卫生）、证据驱动验证（信任阶梯 build/render/composite + 证据戳）。覆盖 6 个问题：①90s 超时 + create 不抗杀（**已决策超时 90s→30min** + `recut.job.cancel` + 事件日志 + 杀后仍 finalize）；②作者契约与 strict typecheck 失配（脚手架自带类型、typecheck 降级，消除整批 TS7006）；③MCP 错误面（统一错误信封 kind/code/hint、终态即结果、wait 改事件订阅）；④失败账本不可见（事件日志 SSOT，一切视图是投影）；⑤上下文层偏离（session digest 投影 + 合成上下文平台推导注入契约，默认透明）；⑥快速路径验证是代码级自证（统一验证管线 + 证据戳，取消 update 自证）。
2026-08-19-platform-communication-op-bus.md: 平台通讯架构：把 WS/HTTP 桥/MCP/shell job/事件账本五套方言收敛为统一 Op 总线契约——标准信封（id/correlationId/from/to/version）、对称原语（on/call/publish/handle）、统一异步 Handle（async_ops，shell/media/deferred 三类统一由 recut.job.* 观察）、App→UI RPC（ctx.project.callUI + rpc.reply + iframe recut.on）。preview.frame 是首个验收消费者：Agent 一次调用返回 jobId，recut.job.wait 直接拿 {imageUrl}，无专用轮询/请求表。稳定契约见 docs/platform-comms-contract.md。

2026-08-19-editor-ai-video-authoring-quality.md: Editor AI 成片质量重构：实际对照 ChatCut plugin 0.2.21 的 scenario/router、A-roll/B-roll/MG、生成镜头与 verification skills，从文字时间线拼接升级为 route + treatment 编排；定义好视频的叙事、画面、镜头关系、视觉系统、节奏与交付证据，规定 CreativePlan、设计回执、依赖图、组件准入、原子 transaction、Op 总线增量同步、用户中断收敛和预览/导出门。
2026-08-20-editor-component-gsap-animation.md: 组件动画升级：GSAP Timeline + 运行时逐帧 seek(t) 作为 react/r3f 承载面主要动画模型（html 保持 anim.*）。确定性从「每帧渲染纯函数」演化为「构造确定性 + 驱动靠 seek」；r3f 复用同一 useTimeline/useGSAP 模式（目标是 Object3D ref）；useTimeline/useFrameContext API + 插件白名单 + 构建期确定性扫描扩展；gsap-skills 融合进 references/gsap.md 与作者契约；零强制迁移。

此目录保存尚未实施或分阶段实施的平台设计决策。RFC 定义目标、边界、数据与接口契约；获批实现后，代码与运行时文档必须反向更新以保持一致。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
