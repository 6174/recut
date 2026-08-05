# apps/

> L2 | 父级: /web/app/README.md

成员清单
[page.tsx]: `/apps` 独立 App 入口；复用主工作台并激活 Apps，负责安装、升级和目录浏览。
[appID]/: 静态 Catalog 与 service 本地 App 的语义详情路由；应用市场条目不依赖本机安装即可显示，手动安装条目仅由 service 发现，随后读取安装状态；项目型 App 可创建用户项目，工作区型 App 直接打开稳定的独立工作台。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
