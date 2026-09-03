# assets/

> L2 | 父级: /apps/editor/README.md

成员清单
assets-panel-store.tsx: 素材面板状态与顶层入口元数据，持久化媒体视图和排序偏好；AI 生成内容统一归入素材。
tabbar.tsx: 紧凑的固定宽度顶部导航，按素材、文本、特效、组件、音频顺序切换核心能力；空间足够时不显示“更多”，否则将尾部入口收进始终贴右的“更多”菜单，绝不横向滚动。
index.tsx: 素材面板容器，按当前入口直达资源内容视图。
views/assets.tsx: 素材资源视图，统一在顶栏导入并展示媒体与组件 asset；空态保持组件素材库挂载（不可见）以监听 recut:components-changed，AI 创建组件后即时出卡，不再依赖刷新。
draggable-item.tsx: 可拖入时间线的统一资源卡片；以单一 16:9 比例提供缩略图、名称、预览和拖拽反馈，所有资源类型共享。
views/: 各顶层能力的具体内容视图与通用面板骨架；成员与预览路由见 `views/README.md`。

导航层级保持单向：`assets-panel-store.tsx` 定义顶层入口 → `tabbar.tsx` 呈现导航 → `index.tsx` 选择内容视图。所有能力均直接进入顶层，不保留二级导航，也不再以“组件库”作为中间层；AI 创作的图、视频和音频属于素材，不设 AI 独立分类。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
