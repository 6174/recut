# projects/[id]/

> L2 | 父级: /web/app/projects/README.md

成员清单
page.tsx: 静态项目详情路由壳；提供导出所需占位参数并挂载客户端容器。
editable-project-name.tsx: 项目名称内联编辑控件；悬停后提示可编辑，Enter 或失焦保存，Escape 取消，并在保存后刷新项目目录。
project-detail-client.tsx: 项目工作台客户端；从 `workspace-store` 读取项目/App，Host 从真实 projectId/appId/manifest 签发稳定 Work Surface；iframe 的 `focus.report`（旧 `page.context` 兼容）只能追加 Focus，不能覆盖目标；同时承载 iframe 素材、媒体选择与 Agent 草稿回填。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
