# projects/[id]/

> L2 | 父级: /web/app/projects/README.md

成员清单
page.tsx: 静态项目详情路由壳；提供导出所需占位参数并挂载客户端容器。
editable-project-name.tsx: 项目名称内联编辑控件；悬停后提示可编辑，Enter 或失焦保存，Escape 取消，并在保存后刷新项目目录。
project-detail-client.tsx: 项目工作台客户端；从 `workspace-store` 共享读取项目详情、App 与安装状态，Header 通过可编辑名称、HeaderActions 组合 service 状态、全局设置和 App 版本升级入口，并承载 App iframe；子页就绪信号与所有 iframe MessageChannel、项目事件均以 iframe `src` 推导消息目标 origin，成功诊断仅以 debug 输出，`media.pick` 支持图片、视频、音频与转写稿，及按类型上传、详情、单选/多选，`agent.compose` 经全局 `lib/agent-panel-context` 只回填左侧输入草稿（不再提供 `agent.send` 直发）；Agent 面板由根布局全局挂载为单一全局会话，本页只声明素材上传上下文。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
