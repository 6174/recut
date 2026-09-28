# community/

> L2 | 父级: /web/components/README.md

成员清单
community.tsx: 社区容器 `Community`：按 section 渲染首页概览 / 应用分区 / 世界分区，统一渲染可扩展的分区子导航（数据来自 `lib/community-sections`）；首页 Hero + 各分区预览（平台 World 与市场 App）。
apps-section.tsx: 应用分区 `AppsSection`（已安装 + 可添加市场，含加载/离线/失败/空态）与可复用的 `MarketplaceAppCard`；导出 `InstallationLoadState` 供工作台壳复用。
worlds-section.tsx: 世界分区 `PlatformWorldsSection`（PGC/平台世界搜索、类型筛选与卡片网格）与 `usePlatformWorlds` 钩子，供首页预览复用；只消费 `worlds-store` 的 platform 段。

依赖边界

只消费父层注入的状态与 `worlds-store` / `workspace-store` 缓存，不直接读取 service；文案经 `lib/i18n` 的 `community.*` / `apps.*` / `worlds.*` 键。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
