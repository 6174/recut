# web/components/

> L2 | 父级: /web/README.md

成员清单
video-frame.tsx: 视频展示原子；列表和卡片以 `srcDoc` iframe 创建真实的静音循环 `<video>` 子文档，详情以 `iframe` 打开原片 URL 的浏览器媒体文档；封面鼠标事件穿透给卡片详情操作，素材库首屏限制媒体导航数量以避免解码器争用。
webgl-studio-hero.tsx: Studio Header 的纯客户端 WebGL 背景；用 Three.js 绘制圆角、渐变磨砂的分层玻璃视频卡、播放符号和漂浮几何体，并由 GSAP 编排入场与低频浮动，遵守减少动态效果偏好且离屏暂停渲染。
audio-waveform-player.tsx: 音频预览原子；原生 `HTMLAudioElement` 先加载元数据并开放播放、定位、静音与下载，wavesurfer.js 随后共享该媒体元素在后台解码和绘制波形，波形失败时不阻塞播放。
generation-duration.tsx: 媒体生成耗时原子；活跃任务本地逐秒计时，终态只显示后端持久化的最终耗时，不发起状态请求。
use-media-asset-events.tsx: Recut 媒体 SSE 缓存边界；以首次快照和增量 Asset 事件维护唯一前端真相，嵌套入口复用已有连接且绝不轮询 Atlas 或单个素材；保留 ASR 转写 bundle 的 `transcript` 与可跨项目研究资料的 `reference` 类型。
asset-preview-dialog.tsx: 跨页面统一素材详情模态框；素材库与 Agent 对话都通过它预览图片、按需视频播放器、可定位波形音频、转写 bundle（源声音播放、分段列表、SRT/JSON parts 预览下载）和无本地二进制的 `reference` 资料链接，从共享 Asset 缓存原位更新运行/终态与生成耗时，查看提示词与参考素材，并复制符合 `<media>` 协议的素材上下文给 Agent。
asset-reference-picker.tsx: 资源引用交互层；解析素材库复制的 `<media>` 协议，提供 @ 快速候选、项目/素材库全局选择面板与可移除引用 token；选择面板使用正常高度真实预览卡，直接显示名称、类型、来源、创建时间、提示词/时长，并分离“详情”和“选择”操作。
platform-media-picker.tsx: iframe App 的平台级素材桥；复用带元信息、详情预览与明确选择操作的全局素材面板，返回指定类型（含转写稿）、完成态素材的稳定 assetId 与展示元数据；转写稿选择只从库中读取，避免错误上传类型。
agent-message-content.tsx: Agent 回复的受控 XML 媒体节点渲染器；解析 `<media type="image|video|audio|transcript|reference" assetid="..."/>` 为紧凑可点击卡片，从共享 Asset 缓存显示实时/最终生成耗时；完成的图片和视频显示真实画面，资料链接点击打开详情。
tool-result-assets.tsx: Agent 工具结果中的媒体适配层；从含嵌套 JSON 字符串的 `assetIds` 提取结果，图片和视频直接显示真实预览，视频统一复用 `VideoFrame` 的 iframe 子文档模式与素材详情模态框。
agent-panel-types.ts: Agent 对话的共享数据契约；集中 Session、Turn、事件、运行时配置、默认值、展示标签、service 连接阶段与泛化的消息上下文（MessageContext：media/page/未来类型，含 PageContext 与构造/归一化辅助），消除面板控制器、视图和输入区的类型耦合。
agent-panel-views.tsx: Agent 对话展示层；渲染会话时间线、历史列表、加载态、CLI 调试弹框与 CLI 恢复面板，调试与工具详情弹框经 Portal 脱离侧栏堆叠上下文，在用户消息上方同时展示素材附件与自动附带的当前页面上下文 chip，并在展开的工具结果中挂载 Asset 预览，归并 SSE 增量事件而不发起会话请求。
agent-composer.tsx: Agent 对话输入层；处理自动增高且上限为 192px 的文本、素材引用、上传、自动附带且可移除的当前页面上下文 chip、Codex/OpenCode 配置与新会话 runtime 选择，所有状态变更通过控制器回调上送。
agent-panel-host.tsx: 根布局唯一挂载的全局工作台壳；顶部固定 64px Header 横贯全宽，其下 Body 左侧单一全局 Agent 对话栏、右侧内容区与拖动手柄共同读取 `--side-panel-width`，拖拽中同步响应且跨路由持久化；壳自身以固定 Header 高度定位左栏，页面只通过 `lib/agent-panel-context` 声明 projectID/草稿/当前页面上下文，路由切换不重建面板、不重连 SSE 也不切换会话；连接阶段原样传给左栏，避免把连接中误报为不可用。
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
use-app-installation-events.tsx: App 安装目录事件桥；根工作台壳订阅后台 Git 检查完成事件后显式刷新唯一 workspace 快照，不用页面级轮询，远端更新与本地修改同时存在时也会显示保护状态。
create-app-dialog.tsx: Apps 顶部的新建应用引导；交付指向公开架构与 Recut API 标准的可复制 AI Prompt，不直接改写用户的应用目录。
install-git-app-dialog.tsx: Apps 顶部的 Git 安装入口；将 GitHub 仓库交给本地 service 校验并安装，成功后通知目录刷新。
use-resizable-side-panel.ts: 桌面双栏工作台的拖拽调宽 hook；逐帧更新共享 CSS 宽度变量，左侧对话栏、右侧内容与手柄即时响应，暴露拖动状态以遮蔽 iframe，松手后才持久化宽度，避免渲染拥塞或跨文档丢失指针事件；当前只被根布局全局挂载的 Agent 面板宿主消费。
terminal-panel.tsx: 基于 xterm.js 的可恢复 CLI 终端面板，负责 Daemon 引导、CLI 探测、一键启动、失败反馈，以及展示最新输出摘要、只读历史与原生 Agent 恢复入口的会话浮层。
Agent 调试流：`project-agent-panel.tsx` 的右上角终端入口订阅当前会话 `/cli-stream`；弹框只显示 Agent runner 已捕获的有界内存 stdout/stderr，不能附着或重放服务重启前的进程，也不取代结构化对话时间线。
vox-broll-workflow.tsx: 已废弃的 AI 短片纵向资源管理器；当前短片流程由 App iframe 自己承载，此文件仅保留历史说明。
world-card.tsx: Worlds 列表与 Studio 区域的 World 卡片；显示名称、类型、定位、最近更新与实体计数摘要，可选渲染已完成素材封面，点击整卡进入 `/worlds/{id}`；卡片只消费摘要，不请求实体正文。
world-picker.tsx: World picker 弹框；搜索与类型筛选后选择只发出结构化 `{ type: "creation_world", worldId }` 引用，供 Chat attachment 与生产 App 的 World 选择使用，绝不把 Canon 复制进消息。
world-entity-picker.tsx: Entity picker 弹框；先选定 World 再按 kind/搜索过滤实体，选择发出 `{ type: "creation_entity", worldId, entityId }`；entityId 永远与 worldId 一起验证，绝不跨 World 复用。
ui/: 按 shadcn/Mira 契约实现的可复用交互原子组件。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
