# [appID]/

> L2 | 父级: /web/app/apps/README.md

成员清单
page.tsx: 静态导出 App 详情路由壳；Worker 将任意 `/apps/<app-id>` 映射到该壳。
app-detail-client.tsx: App 详情客户端；复用主工作台框架，在 App 标题下提供返回入口，读取安装身份，创建普通项目型 App 的项目，并保护系统 App 不被作为项目模板使用。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
