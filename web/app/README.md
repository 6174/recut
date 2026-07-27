# web/app/

> L2 | 父级: /web/README.md

成员清单
layout.tsx: 工作台 HTML 外壳与全局元数据。
page.tsx: 固定桌面双栏本地工作台；Header 右侧提供设置入口，项目创建字段均有可见标签，左侧项目管理可独立滚动，右侧 Agent 对话栏可拖拽调宽并持久化宽度。
media/: 平台级素材库系统应用；左侧按类型管理跨项目媒体资产，提交创建后立即展示并轮询生成中卡片，以紧凑下拉框选择已连接 Provider 模型、在独立缩略图选择弹框中按需添加参考图，并引导添加缺失 Provider；右侧复用标准 Agent 会话，Provider 和用途模型仍在全局设置中管理。
projects/[id]/page.tsx: 固定桌面项目详情路由；Header 展示当前加载的 App 版本与项目身份，左侧全高 iframe 承载 App UI，右侧为独立滚动且可拖拽调宽、持久化宽度的 Agent 对话栏。
globals.css: 工作台的全局设计 token：白色画布、黑色内容、明亮品牌绿操作，以及状态色、圆角、阴影与基础排版。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
