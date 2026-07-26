# src/

> L2 | 父级: /apps/vox-broll/ui/README.md

成员清单
main.tsx: B-roll 工作台编排层；以固定的多面板画布同时展示七个阶段，并按项目能力完成事件刷新资源。
stage-panel.tsx: 工作台单层创作分区；仅提供标题线、资源画布、空状态和创建入口，不包裹第二层卡片。
resource-card.tsx: 固定宽度的素材缩略图；卡片只保留预览与标题，悬停轻放大并显示三点操作菜单。
resource-dialogs.tsx: iframe 内受控资源详情模态框、受确认的删除入口与新建请求弹窗；详情只呈现标题和资源内容，视觉风格展示参考图与 prompt。
resource-view.tsx: 资源展示语义层；按阶段把内部 JSON 翻译为图文、镜头卡与清单，绝不直接向用户展示 JSON。
recut-sdk.ts: iframe 与宿主的 MessageChannel 边界，发布项目事件。
ui.tsx: 基于 Tailwind、Radix Dialog / Dropdown Menu 的 shadcn 风格 UI 原子。
style.css: Tailwind v4 入口与 Vox B-roll 设计令牌；与宿主共享白底、黑字、明亮品牌绿主题。

依赖关系
`main.tsx` 聚合资源状态；卡片和弹窗只接收数据与回调；`ui.tsx` 不了解资源业务。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
