# projects/[id]/

> L2 | 父级: /web/app/projects/README.md

成员清单
page.tsx: 静态项目详情路由壳；提供导出所需占位参数并挂载客户端容器。
project-detail-client.tsx: 项目工作台客户端；从 `workspace-store` 共享读取项目详情、App 与安装状态，Header 通过 HeaderActions 组合 service 状态、全局设置和 App 版本升级入口，并承载 App iframe；父页面记录 iframe MessageChannel 的连接、请求和回包诊断，`media.pick` 支持按类型上传、详情、单选/多选，`agent.compose` 经全局 `lib/agent-panel-context` 只回填右侧输入草稿，`agent.send` 复用全局按项目 scope 缓存的会话列表并在创建后局部回写；Agent 面板由根布局全局挂载为单一全局会话，本页只声明素材上传上下文。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
