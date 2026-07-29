# web/components/

> L2 | 父级: /web/README.md

成员清单
video-frame.tsx: 原始视频预览原子；卡片直接静音循环播放 MP4/M4V，不做首帧 seek 或缩略图中转，详情保留带控件播放器，并在失败时提供状态兜底。
audio-waveform-player.tsx: 基于 wavesurfer.js 的音频波形播放原子；处理解码、波形绘制、点击定位、播放、静音与下载，错误时回退浏览器原生音频控件。
generation-duration.tsx: 媒体生成耗时原子；活跃任务本地逐秒计时，终态只显示后端持久化的最终耗时，不发起状态请求。
use-media-asset-events.tsx: Recut 媒体 SSE 缓存边界；以首次快照和增量 Asset 事件维护唯一前端真相，嵌套入口复用已有连接且绝不轮询 Atlas 或单个素材。
asset-preview-dialog.tsx: 跨页面统一素材详情模态框；素材库与 Agent 对话都通过它预览图片、视频首帧/播放器和可定位波形音频，从共享 Asset 缓存原位更新运行/终态与生成耗时，参考视频也展示真实画面，兼容缺少生命周期字段的历史 Asset，查看提示词与参考素材，并复制符合 `<media>` 协议的素材上下文给 Agent。
asset-reference-picker.tsx: 资源引用交互层；解析素材库复制的 `<media>` 协议，提供 @ 快速候选、项目/素材库全局选择面板与可移除引用 token；消费共享 Asset 缓存实时显示状态/时长，并把名称、类型、来源/提示词直接标注在真实图片和视频缩略图上。
agent-message-content.tsx: Agent 回复的受控 XML 媒体节点渲染器；解析 `<media type="image|video|audio" assetid="..."/>` 为紧凑可点击卡片，从共享 Asset 缓存显示实时/最终生成耗时；完成的图片与视频显示真实画面，未知节点保留为纯文本。
project-agent-panel.tsx: 项目与素材库共用的固定高度 Agent 对话侧栏；支持 @ 引用项目资源或素材库资源、粘贴 `<media>` 上下文自动转引用、图片/视频/音频上传及预览 token；为内部媒体卡、详情和引用选择器接入共享 Asset SSE，Agent 会话本身仍使用自己的事件流并在读取到失效 session 时自动收敛为空态，新建或点击输入框设置入口均可配置 Codex 模型和推理强度。
agent-onboarding.tsx: 新建 Codex 或 Claude 会话的非空引导空态；读取当前项目解析出的 App/全局/平台兜底卡片，点击只写入显式 prompt。
agent-onboarding-settings.tsx: 全局新对话引导设置；维护用户级卡片标题、说明与 prompt，不修改 App manifest。
settings-panel.tsx: Header 右侧的全局设置面板；可展示并复制本机 service 安装命令、验证并保存本地或远程 service 根地址，也以带能力说明的 Popover 连接多 Provider BYOK 凭据，并按图片、视频、语音用途选择模型；字段均有可见标签。
header-actions.tsx: 工作台 Header 右侧的统一操作组合；在页面流中汇集 service 状态、全局设置与可选页面上下文操作，首页与项目详情共用。
service-control.tsx: Header 内的 service 控制入口；通过 Zustand 初始化并刷新唯一 endpoint 的全局状态，本地已安装 daemon 才允许网页执行升级或 launchd 重启，远程 service 只展示连接状态。
app-version-control.tsx: App 版本与升级交互原子；项目 Header 和 Apps 目录复用，系统自带 App 只显示身份与版本，Git App 升级经 Radix Portal 确认并保留 dirty Git 工作树保护。
create-app-dialog.tsx: Apps 顶部的新建应用引导；交付指向公开应用标准的可复制 AI Prompt，不直接改写用户的应用目录。
use-resizable-side-panel.ts: 桌面双栏工作台的拖拽调宽 hook；逐帧直接更新 DOM，暴露拖动状态以遮蔽 iframe，松手后才持久化宽度，避免渲染拥塞或跨文档丢失指针事件。
terminal-panel.tsx: 基于 xterm.js 的可恢复 CLI 终端面板，负责 Daemon 引导、CLI 探测、一键启动、失败反馈，以及展示最新输出摘要、只读历史与原生 Agent 恢复入口的会话浮层。
vox-broll-workflow.tsx: Vox B-roll 纵向资源管理器，展示创作方向的 AI 候选版本，并在创建资源时以弹窗选择依赖和补充意图。
ui/: 按 shadcn/Mira 契约实现的可复用交互原子组件。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
