# web/components/

> L2 | 父级: /web/README.md

成员清单
video-frame.tsx: 真实视频首帧展示原子；卡片与详情统一用浏览器解码视频画面，并在加载或读取失败时提供非误导性的状态兜底。
generation-duration.tsx: 媒体生成耗时原子；活跃任务本地逐秒计时，终态只显示后端持久化的最终耗时，不发起状态请求。
use-media-asset-events.tsx: Recut 媒体 SSE 缓存边界；以首次快照和增量 Asset 事件维护唯一前端真相，嵌套入口复用已有连接且绝不轮询 Atlas 或单个素材。
asset-preview-dialog.tsx: 跨页面统一素材详情模态框；素材库与 Agent 对话都通过它预览图片、视频首帧/播放器和音频，从共享 Asset 缓存原位更新运行/终态与生成耗时，参考视频也展示真实画面，兼容缺少生命周期字段的历史 Asset，查看提示词与参考素材，并复制符合 `<media>` 协议的素材上下文给 Agent。
asset-reference-picker.tsx: 资源引用交互层；解析素材库复制的 `<media>` 协议，提供 @ 快速候选、项目/素材库全局选择面板与可移除引用 token；消费共享 Asset 缓存实时显示状态/时长，并把名称、类型、来源/提示词直接标注在真实图片和视频缩略图上。
agent-message-content.tsx: Agent 回复的受控 XML 媒体节点渲染器；解析 `<media type="image|video|audio" assetid="..."/>` 为紧凑可点击卡片，从共享 Asset 缓存显示实时/最终生成耗时；完成的图片与视频显示真实画面，未知节点保留为纯文本。
project-agent-panel.tsx: 项目与素材库共用的固定高度 Agent 对话侧栏；支持 @ 引用项目资源或素材库资源、粘贴 `<media>` 上下文自动转引用、图片/视频/音频上传及预览 token；为内部媒体卡、详情和引用选择器接入共享 Asset SSE，Agent 会话本身仍使用自己的事件流，新建或点击输入框设置入口均可配置 Codex 模型和推理强度。
settings-panel.tsx: Header 右侧的全局设置面板；以带能力说明的 Popover 连接多 Provider BYOK 凭据，并按图片、视频、语音用途选择模型；字段均有可见标签，官方 Provider 使用内置端点，只有 OpenAI Compatible 显示自定义 API 地址。
use-resizable-side-panel.ts: 桌面双栏工作台的拖拽调宽 hook；逐帧直接更新 DOM，暴露拖动状态以遮蔽 iframe，松手后才持久化宽度，避免渲染拥塞或跨文档丢失指针事件。
terminal-panel.tsx: 基于 xterm.js 的可恢复 CLI 终端面板，负责 Daemon 引导、CLI 探测、一键启动、失败反馈，以及展示最新输出摘要、只读历史与原生 Agent 恢复入口的会话浮层。
vox-broll-workflow.tsx: Vox B-roll 纵向资源管理器，展示创作方向的 AI 候选版本，并在创建资源时以弹窗选择依赖和补充意图。
ui/: 按 shadcn/Mira 契约实现的可复用交互原子组件。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
