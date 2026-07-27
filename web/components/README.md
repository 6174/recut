# web/components/

> L2 | 父级: /web/README.md

成员清单
project-agent-panel.tsx: 项目与素材库共用的固定高度 Agent 对话侧栏；输入法组合输入期间不会误发 Enter，支持选择或粘贴图片上传为当前项目资产、发送前移除和时间线预览，用户消息、待发送消息、assistant 消息和去重后的工具调用按真实时间统一排序。
settings-panel.tsx: Header 右侧的全局设置面板；管理多 Provider BYOK 凭据，并按图片、视频、语音用途选择已连接 Provider 下的模型，可由素材创建流程直接打开。
use-resizable-side-panel.ts: 桌面双栏工作台的拖拽调宽 hook；逐帧直接更新 DOM，暴露拖动状态以遮蔽 iframe，松手后才持久化宽度，避免渲染拥塞或跨文档丢失指针事件。
terminal-panel.tsx: 基于 xterm.js 的可恢复 CLI 终端面板，负责 Daemon 引导、CLI 探测、一键启动、失败反馈，以及展示最新输出摘要、只读历史与原生 Agent 恢复入口的会话浮层。
vox-broll-workflow.tsx: Vox B-roll 纵向资源管理器，展示创作方向的 AI 候选版本，并在创建资源时以弹窗选择依赖和补充意图。
ui/: 按 shadcn/Mira 契约实现的可复用交互原子组件。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
