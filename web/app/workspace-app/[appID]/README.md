# [appID]/

> L2 | 父级: /web/app/workspace-app/README.md

成员清单
page.tsx: 可静态导出的工作区 App 路由壳。
standalone-app-client.tsx: 独立 App 宿主；从 `workspace-store` 共享读取 hidden workspace scope 与 App，从 `media-configuration-store` 读取已连接 Provider 的媒体模型，并在工作区 Header 展示统一 App 身份图标；iframe 显式获 `fullscreen` 权限，所有 iframe operation、Agent、媒体生成、支持转写稿的 `media.pick` 请求及项目事件（含 shell job 实时日志）均以 iframe `src` 推导消息目标 origin；`background.call` 的宿主路由字段固定为 `operation`，仅剥离该字段并原样转发业务输入（包括角色 `name`）；直接生成被绑定到当前 scope，设置可由 App 定位到 AI 服务商分类，`agent.compose` 经全局 `lib/agent-panel-context` 只回填 Agent 输入草稿（不再提供 `agent.send` 直发）；Agent 面板由根布局全局挂载为单一全局会话，本页只声明素材上传上下文。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
