# app-showcase/

> L2 | 父级: /web/components/README.md

成员清单

types.ts: Showcase 特性与局部 Demo 的契约。
registry.ts: appId 到专属 Showcase 的静态分发注册表。
editor-showcase.tsx: Editor 小型 Landing Page 的模块文案与功能顺序。
app-showcase-view.tsx: 在上层统一产品 Hero 之后，直接展示 App 自己的完整工作台 frame，再用左右交替模块呈现每项能力；不额外包一层重复浏览器框或标题栏。

依赖边界

本目录只编排营销展示；整体 UI 复用 app-demo，功能图形由各 App 自己提供，不触碰工作台运行时状态。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
