# web/components/

> L2 | 父级: /web/README.md

成员清单
video-frame.tsx: 视频展示原子；列表和卡片以 `srcDoc` iframe 创建真实的静音循环 `<video>` 子文档，详情以 `iframe` 打开原片 URL 的浏览器媒体文档；封面鼠标事件穿透给卡片详情操作，素材库首屏限制媒体导航数量以避免解码器争用。
card-more-menu.tsx: 实体卡片统一的 More 操作原子；项目和素材共用轻量 context menu、重命名弹框与不可逆删除确认，点击菜单外或按 Esc 自动收起，不持有领域 API 或缓存。
webgl-studio-hero.tsx: Studio Header 的纯客户端 WebGL 背景；用 Three.js 绘制圆角、渐变磨砂的分层玻璃视频卡、播放符号和漂浮几何体，并由 GSAP 编排入场与低频浮动，遵守减少动态效果偏好且离屏暂停渲染。
marketing-hero-atmosphere.tsx: 官网 Hero 的纯客户端 WebGL 材质层；以低频噪声、品牌渐变、指针光晕和颗粒暗角替代平面背景，遵守低功耗 DPR、减少动态效果偏好与离屏暂停渲染。
audio-waveform-player.tsx: 音频预览原子；原生 `HTMLAudioElement` 先加载元数据并开放播放、定位、静音与下载，wavesurfer.js 随后共享该媒体元素在后台解码和绘制波形，波形失败时不阻塞播放。
generation-duration.tsx: 媒体生成耗时原子；活跃任务本地逐秒计时，终态只显示后端持久化的最终耗时，不发起状态请求。
use-media-asset-events.tsx: Recut 媒体 SSE 缓存边界；以首次快照和增量 Asset 事件维护唯一前端真相，嵌套入口复用已有连接且绝不轮询 Atlas 或单个素材；保留 ASR 转写 bundle 的 `transcript` 与可跨项目研究资料的 `reference` 类型。
asset-preview-dialog.tsx: 跨页面统一素材详情模态框；素材库与 Agent 对话都通过它预览图片、按需视频播放器、可定位波形音频、转写 bundle（源声音播放、分段列表、SRT/JSON parts 预览下载）和无本地二进制的 `reference` 资料链接，从共享 Asset 缓存原位更新运行/终态与生成耗时，查看提示词与参考素材，并复制符合 `<media>` 协议的素材上下文给 Agent。
asset-reference-picker.tsx: 资源引用交互层；解析素材库复制的 `<media>` 协议，提供 @ 素材候选与进入全局世界观/素材选择器的统一入口；素材选择面板使用正常高度真实预览卡，直接显示名称、类型、来源、创建时间、提示词/时长，并分离“详情”和“选择”操作。
platform-media-picker.tsx: iframe App 的平台级素材桥；复用带元信息、详情预览与明确选择操作的全局素材面板，返回指定类型（含转写稿）、完成态素材的稳定 assetId 与展示元数据；转写稿选择只从库中读取，避免错误上传类型。
agent-message-content.tsx: Agent 回复的受控 XML 媒体节点渲染器；解析 `<media type="image|video|audio|transcript|reference" assetid="..."/>` 为紧凑可点击卡片，从共享 Asset 缓存显示实时/最终生成耗时；完成的图片和视频显示真实画面，资料链接点击打开详情。
tool-result-assets.tsx: Agent 工具结果中的媒体适配层；从含嵌套 JSON 字符串的 `assetIds` 提取结果，图片和视频直接显示真实预览，视频统一复用 `VideoFrame` 的 iframe 子文档模式与素材详情模态框。
agent-panel-types.ts: Agent 对话的共享数据契约；集中 Session、Turn、事件、运行时配置以及宿主签发的 Work Surface、App 补充的完整 Work Focus 和泛化 MessageContext，iframe 不能覆盖目标。
agent-panel-views.tsx: Agent 对话展示层；渲染会话时间线、历史、调试与工具结果，并按原始结构展示素材、Work Surface 和 Focus。
agent-composer.tsx: Agent 对话输入层；处理文本、素材、世界观、上传、Work Surface 和独立可移除的 Focus，以及 runtime 配置。
agent-panel-host.tsx: 根布局唯一挂载的域名级路由边界与工作台壳；SSR 与浏览器 Host 未确认时透明输出页面本身，不生成任何固定高度、Chat skeleton 或工作台容器；Marketing Host 在浏览器前端路由时自行映射 `/`、`/apps`、`/apps/:id` 到官网组件，未知或工作台路由只显示官网 404，绝不依赖 Worker 重请求、更不会挂载 Workspace；App Host 才使用顶部固定 64px Header、左侧单一全局 Agent 对话栏、右侧内容区与共享 `--side-panel-width`，拖拽中同步响应且跨路由持久化。官网使用无固定高度、可纵向滚动的普通文档流，且绝不挂载 Agent 面板、拖拽手柄或 App SSE；cloud mode 首次离线 Landing Page 同样无面板。
 marketing-site.tsx: 官网共享展示层；提供按 Hero→核心应用→创作底座→三步开始→适合谁→与云端对比→文章→FAQ→CTA 编排的 Landing、Docs、Blog、Header/Footer 与跨域「打开工作台」链接；Hero 挂载 `marketing-editor-demo.tsx` 展示 Agent 与剪辑器的产品闭环，并用 GSAP 轮换高亮 Codex、Claude Code、OpenCode，文章数据由服务端页面经 props 注入，Blog 详情用 `MarkdownContent` 渲染 MDX 正文并提供分享条；线上指向 `app.recut.video`，`localhost` 自动改为同端口 `app.localhost`，不读取 service 或工作台状态。
marketing-editor-demo.tsx: 官网 Hero 的可交互抽象工作台；以 GSAP 循环驱动预览场景和时间线播放头，保留真实 Editor 的素材/预览/属性/多轨时间线骨架，并提供可暂停的播放器演示。
marketing-feature-illustrations.tsx: 官网核心能力卡的 GSAP + SVG 叙事层；以时间线、世界观节点、语音波形与 App 组合四种循环切片替代纯文字介绍，遵守减少动态效果偏好。
app-product-visual.tsx: 官网 App 画廊与详情页复用的动态产品工作流视觉层；按 App id 展示转写波形、封面候选、深度估计、代码渲染、B-roll 分镜或时间线，替代通用骨架。
app-landing/: 五个非 Editor App 的真正独立 Landing 组件与静态 registry；每个文件依据对应 App 的 manifest、README、UI 与 operation 契约表达自身核心工作流，registry 只做 appId 分发。
marketing-jsonld.tsx: 官网 JSON-LD 结构化数据服务端组件；输出 Organization、WebSite、SoftwareApplication（含首页增强版）、Blog 列表与 BlogPosting（publisher 携带 logo，支持文章富结果）、BreadcrumbList、逐 App 的 SoftwareApplication/FAQPage、应用市场 ItemList 与首页 FAQPage，只允许在服务端页面渲染（React 19 要求客户端 `<script>` 带 async），构建期随静态导出写入 HTML。
posthog-analytics.tsx: 全站 PostHog 埋点骨架；内置项目 token（`phc_` 公开客户端 token，可用 `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` 覆盖），以 `https://us.i.posthog.com` 直连上报，覆盖官网与工作台两个 Host。职责分四层：① 初始化开启 `autocapture`（general 点击/输入）与 `capture_exceptions`（未捕获错误与 Promise rejection）；② 随客户端路由与工作台原生 pushState 标签切换上报 `recut_page_viewed`（site=marketing/app、页面分组、脱敏路由 `/blog/[slug]`、`/apps/[appID]`、`/projects/[id]`、`/worlds/[id]`、实体 id、来源 `s`/utm/`ref`/referrer，并注册 initial_*/current_* super properties）；③ 导出 `trackEvent` 供语义事件复用（安装/打开工作台/分享/Docs/GitHub 等）；④ iframe App 内部交互不在顶层捕获范围。
marketing-apps.tsx: 官网公开应用层；提供 `/apps` 应用市场目录与 `/apps/:appID` 详情 SEO 落地页，App 数据一律由服务端页面经 props 注入（本文件不引入内容加载器）；详情使用统一官网内容容器，按 App 注册的 Showcase/Landing 组件编排 Hero、功能叙事、FAQ、设备要求与相关应用内链，CTA 引导到工作台。
markdown-content.tsx: 官网共享正文渲染器；把 markdown/mdx 正文渲染为段落、`##`/`###` 标题、`-`/有序列表、`**加粗**`、行内代码与围栏代码块，Blog 详情与 App 详情共用，保证两处排版一致。
project-agent-panel.tsx: 全局单一 general 会话的固定高度 Agent 对话侧栏，由 `agent-panel-host.tsx` 在根布局挂载；运行时、模型、onboarding、会话摘要、当前会话和详情快照由 `lib/agent-store` 去重共享，SSE 连接仍由面板拥有并将增量回写缓存，路由切换不做按页面的会话过滤。连接中的左栏只渲染骨架；默认本地 service 离线时直接提供可复制的安装/启动命令，已配置远程 service 离线时才只说明连接不可用；OpenCode 模型目录仅在该 CLI 可用后读取，重新检查发现它可用时才强制刷新。发送时把当前页面上下文与用户选择的素材合并为 `contexts` 泛化消息上下文（media 沿用 assetId 契约，page 携带标题/路径/选中/内容），当前页面 chip 默认自动附带、可在发送前移除；已出现回复的 Turn 不显示过期的停止提示。右上角 Debug 入口复制当前会话的版本化 JSON（身份、配置、turn 元数据与最近 100 条结构化事件；不含用户或 Agent 聊天正文）。存在可用 runtime 的空态允许直接输入并在首条消息发送时创建默认 Codex 会话；App iframe 只能回填输入草稿，不能自动提交 turn。无可用 runtime 时只显示安装入口，安装完成后的重新检查强制刷新运行时快照。
agent-onboarding.tsx: 新建 Codex、OpenCode 或 Claude Code 会话的非空引导空态；无论项目或 general scope，均读取当前项目或全局解析出的 App/全局/平台兜底卡片，点击只写入显式 prompt。仅在 `runtimeStatus` 报告无任何可用本地 Agent CLI 时显示 1–3 张必要安装卡；至少一个 runtime 就绪后只显示目标引导卡，不在首页推广额外 CLI。
agent-onboarding-settings.tsx: 全局新对话引导设置；维护用户级卡片标题、说明与 prompt，不修改 App manifest，新增卡片 ID 不依赖安全上下文 UUID。
agent-install-guide.tsx: 本地 Agent CLI 共享三步（安装、登录/验证、重新检查）正文；同时被现有恢复面板（CLI 缺失分支）与新增主动安装对话框消费，checking / checkFailed 由调用方管理，复制到剪贴板与失败兜底统一在内。
agent-install-dialog.tsx: 主动引导用户安装本地 Agent CLI 的共享模态对话框；经 Portal 脱离侧栏堆叠上下文，供空态安装卡、RuntimePicker 未就绪项与未来 settings 本地 Agent 分类复用，关闭即清空、Esc 关闭、背景点击关闭，完成 recheck 且 CLI 已在 backend 可用时由父级自动关闭并刷新 runtimeStatus。
settings-panel.tsx: Header 右侧的全局设置面板；仅展示已可用的 Service、Recut Skill、Recut MCP 和 AI 服务商设置，可展示并复制本机 service 安装命令、验证并保存本地或远程 service 根地址，也以带能力说明的 Popover 连接多 Provider BYOK 凭据并经确认后删除已连接服务商（连带清理其用途模型路由），并通过 Recut Skill Tab 挂载 daemon 管理的跨 Agent Skill 链接；API Key 草稿只在表单本地保存。
recut-skill-settings.tsx: Recut Skill 全局设置子面板；读取 daemon 启动时自动维护的唯一 Skill 来源、各 Agent 链接状态与 MCP 注册状态，只请求后端安全修复异常项，不在浏览器直接写用户目录；服务路由缺失或返回非 JSON 时给出可执行的重启提示。
header-actions.tsx: 工作台 Header 右侧的统一操作组合；在页面流中汇集项目 GitHub 主页外链、service 状态、全局设置与可选页面上下文操作，首页与项目详情共用。
service-control.tsx: Header 内的 service 控制入口；通过 Zustand 初始化并每 30 秒刷新唯一 endpoint 的全局状态，展示 health 提供的进程启动时间，并在启动时间变化后确认升级或 launchd 重启完成；所有已连通 service 均提供新标签页诊断日志入口，查看 CLI 解析、PATH 与近期 service 日志，接口仍由 service 限制在本地网络；发现本地 service 更新时将 Header 状态切换为醒目的更新操作，核心工作区保持可用；本地已安装 daemon 才允许网页执行这些操作，远程 service 只展示连接状态。
app-version-control.tsx: Git App 版本交互原子；项目 Header 和 Apps 目录复用，单项升级经确认执行，且仅在存在可升级、无本地修改条目时提供一键更新，始终保留 dirty Git 工作树保护。
app-identity-icon.tsx: App 身份视觉原子；按 App ID 解析唯一图标，并以首页一致的浅绿图标徽标供应用中心、详情、工作区与 Agent 引用复用。
agent-reference-card.tsx: Agent 回复中的项目与 App 引用卡；App 引用通过统一身份图标保留与工作台相同的应用语义。
use-app-installation-events.tsx: App 安装目录事件桥；根工作台壳订阅后台 Git 检查完成事件后显式刷新唯一 workspace 快照，不用页面级轮询，远端更新与本地修改同时存在时也会显示保护状态。
create-app-dialog.tsx: Apps 顶部的新建应用引导；交付指向公开架构与 Recut API 标准的可复制 AI Prompt，不直接改写用户的应用目录。
install-git-app-dialog.tsx: Apps 顶部的 Git 安装入口；将 GitHub 仓库交给本地 service 校验并安装，成功后通知目录刷新。
use-resizable-side-panel.ts: 桌面双栏工作台的拖拽调宽 hook；逐帧更新共享 CSS 宽度变量，左侧对话栏、右侧内容与手柄即时响应，暴露拖动状态以遮蔽 iframe，松手后才持久化宽度，避免渲染拥塞或跨文档丢失指针事件；当前只被根布局全局挂载的 Agent 面板宿主消费。
terminal-panel.tsx: 基于 xterm.js 的可恢复 CLI 终端面板，负责 Daemon 引导、CLI 探测、一键启动、失败反馈，以及展示最新输出摘要、只读历史与原生 Agent 恢复入口的会话浮层。
Agent 调试流：`project-agent-panel.tsx` 的右上角终端入口订阅当前会话 `/cli-stream`；弹框只显示 Agent runner 已捕获的有界内存 stdout/stderr，不能附着或重放服务重启前的进程，也不取代结构化对话时间线。每个发送 Turn 固定保存 Work Surface；Focus 在同一 Turn 内是完整但可独立移除的选择态。
ai-short-film-workflow.tsx: 已废弃的 AI 短片纵向资源管理器；当前短片流程由 App iframe 自己承载，此文件仅保留历史说明。
world-card.tsx: Worlds 列表与 Studio 区域的 World 卡片；显示名称、类型、定位、最近更新与实体计数摘要，可选渲染已完成素材封面，点击整卡进入 `/worlds/{id}`；卡片只消费摘要，不请求实体正文。
world-picker.tsx: World picker 弹框；搜索与类型筛选后选择只发出结构化 `{ type: "creation_world", worldId }` 引用，供 Chat attachment 与生产 App 的 World 选择使用，绝不把 Canon 复制进消息。
world-entity-picker.tsx: Entity picker 弹框；先选定 World 再按 kind/搜索过滤实体，选择发出 `{ type: "creation_entity", worldId, entityId }`；entityId 永远与 worldId 一起验证，绝不跨 World 复用。
ui/: 按 shadcn/Mira 契约实现的可复用交互原子组件。
app-demo/: App 的 UI 演示体系；`AppDemo` 按 `appId` 从 `registry` 选择专属演示 module，并据 `mode` 渲染整体 UI（full）、局部 UI（panel）或集合用的极简 skeleton，未注册 App 按 `kind` 推断 layout 走通用骨架；`app-demo-editor.tsx` 是第一个完整实现的 App（homepage hero、App Store、App 详情与营销页共用），新增 App 只需在 `registry.ts` 登记自己的 module。
app-showcase/: App 的「小官网」式模块展示；`AppShowcaseView` 按 `appId` 从 `registry` 直接渲染整体 App UI（复用 AppDemo full、自身是唯一工作台 frame）加逐节功能模块（每节标题/描述 + 局部 UI 演示，左右交替），未注册 App 回退 `fallback`（blog/文档模式）；`showcases/editor-showcase.tsx` 列出 editor 的资源模块、自定义组件、字体与排版、AI 导演等特性，新增 App 只在 `registry.ts` 登记自己的 showcase。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
