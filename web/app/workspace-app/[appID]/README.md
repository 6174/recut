# [appID]/

> L2 | 父级: /web/app/workspace-app/README.md

成员清单
page.tsx: 可静态导出的工作区 App 路由壳。
standalone-app-client.tsx: 独立 App 宿主；从 `workspace-store` 共享读取 hidden workspace scope 与 App，从 `media-configuration-store` 读取已连接 Provider 的媒体模型；转发 iframe operation、Agent、媒体生成与`media.pick`请求及项目事件（含 shell job 实时日志）；直接生成被绑定到当前 scope，设置可由 App 定位到 AI 服务商分类，`agent.compose` 仅回填 Agent 输入草稿，`agent.send` 复用全局按 scope 缓存的会话列表并在创建后局部回写，并复用可调宽 Agent 面板。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
