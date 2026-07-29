# [appID]/

> L2 | 父级: /web/app/apps/README.md

成员清单
page.tsx: 静态导出 App 详情路由壳；Worker 将任意 `/apps/<app-id>` 映射到该壳。
app-detail-client.tsx: App 详情客户端；从静态 Catalog 读取身份，复用主工作台框架并只向 service 查询安装状态；市场 App 在此安装、已安装项目型 App 可创建项目，系统 App 不被作为项目模板使用。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
