# worlds/[worldID]/canvas/

> L3 | 父级: ../README.md

Recursive World Canvas（RFC 2026-09-07）的全屏画布模式：pomelo（pixi + 插件机制）为交互底座，zustand store 为唯一数据源。语义真相只在 `world_entities` + `world_relations`；pomelo 文档是 `world_canvas` 的内存投影（可重建），画布变更永不产出 revision。

成员清单

canvas-store.ts: 画布 zustand 状态层；会话配置（open）、当前上下文（全局/实体容器）的实体/画布元素/关系/类型目录、视图状态（缩放/选中/连线草稿/对话框）与全部写动作；语义写带 revision 冲突重试，附几何工具函数与尺寸常量。
canvas-toolbar.tsx: 画布工具组（CanvasToolbarItems，无浮动容器）：由 canvas-top-bar.tsx 渲染进页面最顶 Header 的世界画布行——选择/抓手模式（panMode 读自 canvas-store，全画布平移 overlay 由 canvas-pomelo.tsx 的 PanOverlay 承载）、连线工具（canvas-store.linkMode → CanvasBindsPlugin 点击节点拖出引导线，一次性后自动回选择模式）、独立插入（图片/音频/视频=无属性边的 attr 元素、文本=自由文本，经 addFreeElement 落在视口中心）、undo/redo（内存投影）、缩放菜单（放大/缩小/50%/100%/200%/适应项目/适应所选内容/对齐到网格开关）与帮助面板。pomelo 编辑器实例由 canvas-pomelo 挂载后经 setEditor 登记进 canvas-store。全局 Header 同时保留返回/面包屑与实体/便签创建。
canvas-pomelo.tsx: pomelo 底座（替代 canvas-tldraw.tsx）：canvas-store → pomelo 文档全量重建（buildPomeloRecords，block id 与原 shape id 约定对齐）；ViewportPlugin 平移缩放 + CanvasBindsPlugin 交互绑定；底部浮动工具栏 CanvasFloatingToolbar；自由元素 note/text/shape→FreeElementBlock，绑定两实体的自由箭头复用 RelationArrowBlock 投影。canvas-tldraw.tsx 保留为历史参考（不再挂载）。
canvas-pomelo-plugin.ts: 画布交互绑定层：点击命中 → CanvasSelection 解析（驱动右侧面板）；拖拽位移 + 四角 resize 经 moveElement + persistGeometry（400ms 去抖）持久化；双击实体卡进入容器；Delete/Backspace 删关系/草稿；选区 overlay 屏幕 space 绘制。
canvas-detail-panel.tsx: 右侧详情面板（统一架构：选中即面板）；World 核心节点/实体节点/语义关系边/自由草稿四类选中体，含进入容器、建立关系、Promote 与删除操作。
canvas-dialogs.tsx: 对话框层；新建实体（type 目录）、受控关系确认（RelateDialog）、Promote 确认。
index.tsx: 组合根；经 portal 挂载到工作台内容区（#workspace-content-region，避让全局 Header 与左侧 Chat），组合 toolbar + pomelo host + panel + dialogs，WorldCanvas 唯一出口。

依赖边界

- 数据流：组件只读 `useWorldCanvasStore` 快照并触发动作，绝不直接调用 recut-worlds-client 写接口。
- pomelo block id 约定：实体 `entity:<entityId>`（元素 id 仍为 `shape:<entityId>`）、World 节点 `shape:world`、自由元素直接用 world_canvas 元素 id、语义关系边 block id = `arrow:<relationId>`。
- pomelo 文档是内存投影：拖拽/resize 增量提交仅在文档内，pointerup 落回 canvas-store 持久化，异常时可随时全量重建。
- 画布元素写入不产 revision；实体/关系/Promote 写入产出 revision，冲突时 refreshRevision 重试一次。
- pomelo host 经 index.tsx 的 next/dynamic（ssr:false）挂载，禁止在服务端组件直接 import canvas-pomelo。
- 已知 v1 差异（相比 tldraw 版）：未绑定两端实体的自由箭头暂不渲染；连线锚点/弯曲拖拽只在内存投影内，不持久化；画布内文本内联编辑改由详情面板与 Promote 流程承担。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
