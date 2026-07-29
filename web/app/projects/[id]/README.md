# projects/[id]/

> L2 | 父级: /web/app/projects/README.md

成员清单
page.tsx: 静态项目详情路由壳；提供导出所需占位参数并挂载客户端容器。
project-detail-client.tsx: 项目工作台客户端；Header 通过 HeaderActions 组合 service 状态、全局设置和 App 版本升级入口，并承载 App iframe 与 Agent 面板；仅在校验 iframe 来源与窗口身份后响应其就绪握手并交付 MessageChannel。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
