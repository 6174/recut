# worlds/[worldID]/canvas/

> L3 | 父级: ../README.md

Recursive World Canvas（RFC 2026-09-07）的全屏画布模式：以 tldraw 为交互底座，zustand store 为唯一数据源。语义真相只在 `world_entities` + `world_relations`；tldraw 场景与 `world_canvas` 互为持久化镜像，画布变更永不产出 revision。

成员清单

canvas-store.ts: 画布 zustand 状态层；会话配置（open）、当前上下文（全局/实体容器）的实体/画布元素/关系/类型目录、视图状态（缩放/选中/连线草稿/对话框）与全部写动作；语义写带 revision 冲突重试，附几何工具函数与尺寸常量。
canvas-toolbar.tsx 已移除：工具栏功能并入 tldraw 顶部同一行（canvas-tldraw.tsx 内 CanvasTopPanel/CanvasSharePanel 覆盖）。
canvas-tldraw.tsx: tldraw 底座；自定义 EntityCardShape/WorldNodeShape，便签/文本/形状/箭头复用原生 shape；store.listen(user/document) 单一同步点（rebuild 屏蔽窗 + 去抖持久化），删除同步 world_relations/world_canvas，实体间箭头绑定打开受控关系确认；UI 覆盖：TopPanel（返回/面包屑/新建实体便签，与 MenuPanel 同行）、SharePanel（右上「设定视图」切换入口）、PageMenu=null 隐藏 pages。
canvas-detail-panel.tsx: 右侧详情面板（统一架构：选中即面板）；World 核心节点/实体节点/语义关系边/自由草稿四类选中体，含进入容器、建立关系、Promote 与删除操作。
canvas-dialogs.tsx: 对话框层；新建实体（type 目录）、受控关系确认（RelateDialog）、Promote 确认。
index.tsx: 组合根；经 portal 挂载到工作台内容区（#workspace-content-region，避让全局 Header 与左侧 Chat），组合 toolbar + tldraw host + panel + dialogs，WorldCanvas 唯一出口。

依赖边界

- 数据流：组件只读 `useWorldCanvasStore` 快照并触发动作，绝不直接调用 recut-worlds-client 写接口。
- shape id = world_canvas 元素 id；关系边派生投影 id = `shape:rel-<relationId>`；实体投影 id = `shape:<entityId>`。
- 画布元素写入不产 revision；实体/关系/Promote 写入产出 revision，冲突时 refreshRevision 重试一次。
- tldraw 经 index.tsx 的 next/dynamic（ssr:false）挂载，禁止在服务端组件直接 import canvas-tldraw。

[PROTOCOL]: 变更时更新此头部，然后检查 README.md
