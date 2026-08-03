# web/components/

> L2 | 父级: /web/README.md

成员清单
video-frame.tsx: 原始视频预览原子；卡片直接静音循环播放 MP4/M4V，不做首帧 seek 或缩略图中转，详情保留带控件播放器，并在失败时提供状态兜底。
audio-waveform-player.tsx: 基于 wavesurfer.js 的音频波形播放原子；处理解码、波形绘制、点击定位、播放、静音与下载，错误时回退浏览器原生音频控件。
generation-duration.tsx: 媒体生成耗时原子；活跃任务本地逐秒计时，终态只显示后端持久化的最终耗时，不发起状态请求。
use-media-asset-events.tsx: Recut 媒体 SSE 缓存边界；以首次快照和增量 Asset 事件维护唯一前端真相，嵌套入口复用已有连接且绝不轮询 Atlas 或单个素材。
asset-preview-dialog.tsx: 跨页面统一素材详情模态框；素材库与 Agent 对话都通过它预览图片、视频首帧/播放器和可定位波形音频，从共享 Asset 缓存原位更新运行/终态与生成耗时，参考视频也展示真实画面，兼容缺少生命周期字段的历史 Asset，查看提示词与参考素材，并复制符合 `<media>` 协议的素材上下文给 Agent。
asset-reference-picker.tsx: 资源引用交互层；解析素材库复制的 `<media>` 协议，提供 @ 快速候选、项目/素材库全局选择面板与可移除引用 token；选择面板使用正常高度真实预览卡，直接显示名称、类型、来源、创建时间、提示词/时长，并分离“详情”和“选择”操作。
platform-media-picker.tsx: iframe App 的平台级单选素材桥；复用带元信息、详情预览与明确选择操作的全局素材面板，只返回指定类型、完成态素材的稳定 assetId 与展示元数据。
agent-message-content.tsx: Agent 回复的受控 XML 媒体节点渲染器；解析 `<media type="image|video|audio" assetid="..."/>` 为紧凑可点击卡片，从共享 Asset 缓存显示实时/最终生成耗时；完成的图片与视频显示真实画面，未知节点保留为纯文本。
tool-result-assets.tsx: Agent 工具结果中的媒体适配层；从含嵌套 JSON 字符串的 `assetIds` 提取结果，直接显示真实图片/视频预览并复用素材详情模态框。
agent-panel-types.ts: Agent 对话的共享数据契约；集中 Session、Turn、事件、运行时配置、默认值与展示标签，消除面板控制器、视图和输入区的类型耦合。
agent-panel-views.tsx: Agent 对话展示层；渲染会话时间线、历史列表、加载态、CLI 调试弹框与 CLI 恢复面板，并在展开的工具结果中挂载 Asset 预览，归并 SSE 增量事件而不发起会话请求。
agent-composer.tsx: Agent 对话输入层；处理文本、素材引用、上传、Codex/OpenCode 配置与新会话 runtime 选择，所有状态变更通过控制器回调上送。
project-agent-panel.tsx: 项目与素材库共用的固定高度 Agent 对话侧栏；首页无项目时以 `scope=general` 自动进入隐藏 general scope，存在可用 runtime 的空态允许直接输入并在首条消息发送时创建默认 Codex 会话，支持 App iframe 通过宿主回填输入草稿但绝不自动创建会话或发送消息，支持 @ 引用项目资源或素材库资源、粘贴 `<media>` 上下文自动转引用、图片/视频/音频上传及预览 token；作用域切换或打开会话时先同步清除旧数据并显示 Loading，使用作用域与详情版本拒绝迟到响应/SSE 回写，避免短暂展示上一项目的失败历史。面板加载即查询 Agent CLI 可用性：当前 runtime 不可用时整块右侧面板切换为中性的三步安装、登录、验证和刷新流程，已有该 runtime 但最近一次启动失败时切换为原始错误与可复制的对应排障任务；已恢复可用的 CLI 不会被历史“未安装”失败事件再次阻断。恢复模式不显示会话、历史或输入框，重新检查通过后才恢复对话。`/v1/agents` 确认没有任何可用 runtime 时，空态也只显示 Codex / OpenCode / Claude Code 三项安装入口，不渲染无法提交的目标引导和输入框；安装完成后对话框自动关闭并刷新 runtimeStatus。Agent SSE 在 queued、running 与终态间即时同步 User Turn，避免已开始的消息仍显示待发送；OpenCode 模型连接重试会显示真实阶段；历史失败以中性信息条保留。会话历史副标题固定先显示 Agent 类型（Codex / OpenCode / Claude Code），再显示其运行时可配置的模型与推理强度。User 气泡 hover 展示发送时间，成功回复的操作行展示完成时间与总耗时。重新检查会禁用并旋转按钮、显示检查中状态；安装与诊断的复制操作兼容不安全 HTTP origin，成功或权限拒绝均会显示可见反馈；工具卡严格分离调用参数、执行结果/错误与成本信息，识别 `assetIds` 后在展开状态下直接显示可点击的真实图片/视频预览，并提供完整查看和复制；为内部媒体卡、详情和引用选择器接入共享 Asset SSE，Agent 会话本身仍使用自己的事件流并在读取到失效 session 时自动收敛为空态。新建菜单按 runtime 分组列出 Codex / OpenCode / Claude Code 三项；输入区设置首层按 runtime 渲染，Codex 显示模型与推理强度，OpenCode 直接读取本机 TUI 的全部 provider/model、自动分组并按 provider/model 即时搜索，Claude Code 不可配置。
agent-onboarding.tsx: 新建 Codex、OpenCode 或 Claude Code 会话的非空引导空态；无论项目或 general scope，均读取当前项目或全局解析出的 App/全局/平台兜底卡片，点击只写入显式 prompt。在 `runtimeStatus` 报告无任何可用本地 Agent CLI 时，仅显示 1–3 张安装卡，点击同样打开共享安装对话框；至少一个 runtime 就绪后才显示目标引导卡。
agent-onboarding-settings.tsx: 全局新对话引导设置；维护用户级卡片标题、说明与 prompt，不修改 App manifest，新增卡片 ID 不依赖安全上下文 UUID。
agent-install-guide.tsx: 本地 Agent CLI 共享三步（安装、登录/验证、重新检查）正文；同时被现有恢复面板（CLI 缺失分支）与新增主动安装对话框消费，checking / checkFailed 由调用方管理，复制到剪贴板与失败兜底统一在内。
agent-install-dialog.tsx: 主动引导用户安装本地 Agent CLI 的共享模态对话框；供空态安装卡、RuntimePicker 未就绪项与未来 settings 本地 Agent 分类复用，关闭即清空、Esc 关闭、背景点击关闭，完成 recheck 且 CLI 已在 backend 可用时由父级自动关闭并刷新 runtimeStatus。
settings-panel.tsx: Header 右侧的全局设置面板；可展示并复制本机 service 安装命令、验证并保存本地或远程 service 根地址，也以带能力说明的 Popover 连接多 Provider BYOK 凭据，并按图片、视频、语音用途选择模型；配置请求完成前展示明确加载态，图片可选无需密钥的 Codex 原生生图，字段均有可见标签。
header-actions.tsx: 工作台 Header 右侧的统一操作组合；在页面流中汇集项目 GitHub 主页外链、service 状态、全局设置与可选页面上下文操作，首页与项目详情共用。
service-control.tsx: Header 内的 service 控制入口；通过 Zustand 初始化并刷新唯一 endpoint 的全局状态，展示 health 提供的进程启动时间，并在启动时间变化后确认升级或 launchd 重启完成；所有已连通 service 均提供新标签页诊断日志入口，查看 CLI 解析、PATH 与近期 service 日志，接口仍由 service 限制在本地网络；发现本地 service 更新时将 Header 状态切换为醒目的更新操作，核心工作区保持可用；本地已安装 daemon 才允许网页执行这些操作，远程 service 只展示连接状态。
app-version-control.tsx: Git App 版本交互原子；项目 Header 和 Apps 目录复用，单项升级经确认执行，且仅在存在可升级、无本地修改条目时提供一键更新，始终保留 dirty Git 工作树保护。
create-app-dialog.tsx: Apps 顶部的新建应用引导；交付指向公开架构与 Recut API 标准的可复制 AI Prompt，不直接改写用户的应用目录。
install-git-app-dialog.tsx: Apps 顶部的 Git 安装入口；将 GitHub 仓库交给本地 service 校验并安装，成功后通知目录刷新。
use-resizable-side-panel.ts: 桌面双栏工作台的拖拽调宽 hook；逐帧直接更新 DOM，暴露拖动状态以遮蔽 iframe，松手后才持久化宽度，避免渲染拥塞或跨文档丢失指针事件。
terminal-panel.tsx: 基于 xterm.js 的可恢复 CLI 终端面板，负责 Daemon 引导、CLI 探测、一键启动、失败反馈，以及展示最新输出摘要、只读历史与原生 Agent 恢复入口的会话浮层。
Agent 调试流：`project-agent-panel.tsx` 的右上角终端入口订阅当前会话 `/cli-stream`；弹框只显示 Agent runner 已捕获的有界内存 stdout/stderr，不能附着或重放服务重启前的进程，也不取代结构化对话时间线。
vox-broll-workflow.tsx: Vox B-roll 纵向资源管理器，展示创作方向的 AI 候选版本，并在创建资源时以弹窗选择依赖和补充意图。
ui/: 按 shadcn/Mira 契约实现的可复用交互原子组件。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
