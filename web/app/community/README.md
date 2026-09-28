# community/

> L2 | 父级: /web/app/README.md

成员清单
page.tsx: `/community` 社区一级入口；复用工作台 Header 与 Agent 面板，挂载 `Community` 容器，默认渲染可扩展分区首页（Hero + 各分区预览）。
apps/page.tsx: `/community/apps` 应用分区壳；渲染已安装扩展与可添加市场，详情页仍走 `/apps/[appID]`。
worlds/page.tsx: `/community/worlds` 世界分区壳；只展示平台精选 PGC Worlds，详情页仍走 `/worlds/[worldID]`。

定位

社区是「公共可发现内容」面：PGC Worlds（平台目录）与 Apps 目录。用户自己的 World 与项目属于工作台资产，留在 Projects/Studio 混排，绝不出现在社区。分区清单见 `lib/community-sections.ts`，新增板块只需在注册表加一条。

依赖边界

页面壳只调用工作台的 `Workspace`（`../page`）并传入 `initialTab="community"` 与 `communitySection`；内容组件在 `web/components/community/`，数据来自 `worlds-store`（platform 段）、`workspace-store`（installations/marketplace）与 `lib/appstore`。不新增数据源、不直接访问 service。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
