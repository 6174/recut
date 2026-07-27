# src/

> L2 | 父级: /apps/vox-broll/ui/README.md

成员清单
main.tsx: B-roll 工作台编排层；以两列等宽 panel 网格同时展示七个阶段，并按资源创建或原位更新的项目能力完成事件刷新资源。
use-media-asset-events.tsx: iframe 内 Recut Asset SSE 缓存边界；首次快照和增量事件维护唯一生命周期真相，资源卡、详情与引用缩略图不轮询素材状态。
stage-panel.tsx: 工作台单层创作分区；以统一边框卡片承载标题、资源画布、空状态和创建入口，避免与页面标题重复绘制顶部分隔线。
resource-card.tsx: 固定宽度的素材缩略图；Look 和 Keyframes 展示实际生成图，已完成 Scene 直接展示静音循环视频画面，运行或失败素材显示状态兜底，悬停显示三点操作菜单。
resource-dialogs.tsx: iframe 内受控资源详情模态框、受确认的删除入口与新建请求弹窗；引用资源展示实际图片、视频画面或文字摘要。
resource-view.tsx: 资源展示语义层；按阶段把内部 JSON 翻译为图文、缩略文本、视频画面、镜头卡与清单，优先读取独立 Scene 的 `video.assetId`，兼容历史 `scenes[]/shots[]` 项内的 `video.assetId` 或 `videoAssetId`；所有真实媒体从共享 Asset SSE 缓存读取状态，任何生成中的图片、音频或视频都显示实时计时，终态仅展示后端 `generationDurationMs`，历史素材绝不根据时间戳猜测生成耗时，也不直接向用户展示 JSON。
recut-sdk.ts: iframe 与宿主的 MessageChannel 边界，发布项目事件。
ui.tsx: 基于 Tailwind、Radix Dialog / Dropdown Menu 的 shadcn 风格 UI 原子。
style.css: Tailwind v4 入口与 Vox B-roll 设计令牌；与宿主共享白底、黑字、明亮品牌绿主题。

依赖关系
`main.tsx` 聚合资源状态；卡片和弹窗只接收数据与回调；`ui.tsx` 不了解资源业务。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
