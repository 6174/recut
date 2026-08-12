# [appID]/

> L2 | 父级: /web/app/apps/README.md

成员清单
page.tsx: 静态导出 App 详情路由壳；Worker 将任意 `/apps/<app-id>` 映射到该壳。
app-detail-client.tsx: App 详情客户端；从浏览器真实 URL 取得 App ID，应用中心条目由静态 Catalog 立即解析，用户手动安装的条目从 `workspace-store` 本地目录发现；复用主工作台框架和安装状态，在安装操作前展示 Catalog 声明的设备/磁盘前置条件，市场 App 在此安装、已安装项目型 App 可创建项目、工作区型 App 直接打开独立工作台；原生素材库不经过此路由。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
