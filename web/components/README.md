# web/components/

> L2 | 父级: /web/README.md

成员清单
asset-preview-dialog.tsx: 跨页面统一素材详情模态框；素材库与 Agent 对话都通过它查看图片、提示词和参考素材。
agent-message-content.tsx: Agent 回复的受控 XML 媒体节点渲染器；解析 `<media type="image|video|audio" assetid="..."/>` 为紧凑可点击卡片，点击后打开统一素材详情模态框，未知节点保留为纯文本。
project-agent-panel.tsx: 项目与素材库共用的固定高度 Agent 对话侧栏；新建 Codex 对话可选择模型和推理强度并固定到该会话，输入法组合输入期间不会误发 Enter，支持选择或粘贴图片上传为当前项目资产、发送前移除和时间线预览；停止成功后立即刷新持久化终态，不依赖 SSE 到达，用户消息、待发送消息、assistant 消息和按 Turn 隔离去重的工具调用按真实时间统一排序；工具详情以不遮挡侧栏的行内卡片呈现参数、结果/错误和耗时。
settings-panel.tsx: Header 右侧的全局设置面板；以带能力说明的 Popover 连接多 Provider BYOK 凭据，并按图片、视频、语音用途选择模型；字段均有可见标签，官方 Provider 使用内置端点，只有 OpenAI Compatible 显示自定义 API 地址。
use-resizable-side-panel.ts: 桌面双栏工作台的拖拽调宽 hook；逐帧直接更新 DOM，暴露拖动状态以遮蔽 iframe，松手后才持久化宽度，避免渲染拥塞或跨文档丢失指针事件。
terminal-panel.tsx: 基于 xterm.js 的可恢复 CLI 终端面板，负责 Daemon 引导、CLI 探测、一键启动、失败反馈，以及展示最新输出摘要、只读历史与原生 Agent 恢复入口的会话浮层。
vox-broll-workflow.tsx: Vox B-roll 纵向资源管理器，展示创作方向的 AI 候选版本，并在创建资源时以弹窗选择依赖和补充意图。
ui/: 按 shadcn/Mira 契约实现的可复用交互原子组件。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
