# src/

> L2 | 父级: /apps/vox-broll/ui/README.md

成员清单
main.tsx: 资源管理器编排层，按项目能力完成事件刷新当前资源集合。
resource-card.tsx: 资源卡片，展示摘要并打开预览。
resource-dialogs.tsx: 资源预览与新建请求弹窗，收集创作要求和依赖资源。
recut-sdk.ts: iframe 与宿主的 MessageChannel 边界，发布项目事件。
ui.tsx: 基于 Tailwind、Radix Dialog 的 shadcn 风格 UI 原子。
style.css: Tailwind v4 入口与 Vox B-roll 设计令牌；与宿主共享白底、黑字、明亮品牌绿主题。

依赖关系
`main.tsx` 聚合资源状态；卡片和弹窗只接收数据与回调；`ui.tsx` 不了解资源业务。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
