# web/app/

> L2 | 父级: /web/README.md

成员清单
layout.tsx: 工作台 HTML 外壳与全局元数据。
page.tsx: 两栏本地工作台，左侧项目管理、右侧终端会话管理与 Daemon 状态轮询。
projects/[id]/page.tsx: 通用项目详情路由，按 App manifest 装载其 UI iframe 与项目范围终端，不包含 App 业务界面。
globals.css: 工作台的全局视觉变量与响应式布局。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
