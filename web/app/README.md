# web/app/

> L2 | 父级: /web/README.md

成员清单
layout.tsx: 工作台 HTML 外壳与全局元数据。
page.tsx: 固定桌面双栏本地工作台；左侧项目管理可独立滚动，右侧 Agent 对话栏可拖拽调宽并持久化宽度。
projects/[id]/page.tsx: 固定桌面项目详情路由；Header 展示项目元信息，左侧全高 iframe 承载 App UI，右侧为独立滚动且可拖拽调宽、持久化宽度的 Agent 对话栏。
globals.css: 工作台的全局视觉变量与基础排版。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
