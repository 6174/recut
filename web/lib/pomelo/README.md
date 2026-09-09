# lib/pomelo — tldraw 替代：pomelo core + pixi renderer + plugins

从 `/Users/chenxuejia/ws/2025/pomelo` 迁移的编辑器内核，作为 world 无限画布的自研底座（替代 tldraw 的 license 方案）。

## 结构

- `pomelo-core/`：编辑器内核（原样迁移 + strict TS 适配）
  - `pomelo-editor.ts`：Editor 封装（container/plugin DOM/renderer/状态层/插件生命周期）
  - `pomelo-state/`：yjs 数据层（BlockTree、transact、undo/redo）
  - `pomelo-renderer/`：渲染协调（virtual-dom diff + BlockPatcher 增量挂载/更新/删除；注意顶层块 record.pid 为空，removeBlock/replaceBlock 需回退 mountpoint 取父，否则容器切换后舞台残留旧块——见 pomelo-virtual.ts 头部修复记录）
  - `pomelo-pixi/`：PixiRendererAdapter + PixiElement + PixiBlock（渲染底层适配器）
  - `pomelo-plugin/`：插件机制（PomeloPlugin / PomeloReactPlugin）
- `pomelo-world-canvas/`（`world-canvas/`）：Recursive World Canvas 的 pomelo 实现（demo）
  - `blocks/`：entity-card / note / world-node / relation-arrow（tldraw arrow-binding 思路的简化实现：绑定关系存 store，几何在渲染期解析）
  - `plugins/`：viewport（滚轮平移/⌘滚轮缩放/空格拖拽）、selection（点选/拖拽位移/连线命中）、connection（连线模式）、keyboard（Delete/Escape/⌘Z）
  - `doc-sync.ts`：store → 编辑器文档的映射与全量重建
  - `demo-store.ts`：demo 内存数据源（无后端）
- `pomelo-apps/`、`pomelo-plugins/`：原仓库存量 demo/插件，依赖 `@pixi/react`（与 React 19 不兼容），已在 `tsconfig.json` exclude 中排除，待 React 19 兼容后再启用。

## 画布移植（worlds/[worldID]/canvas 已切换 pomelo）

真实 World 画布（`app/worlds/[worldID]/canvas/canvas-pomelo.tsx` + `canvas-pomelo-plugin.ts`）已由 tldraw 方案替换为本方案：canvas-store 仍是唯一语义真相与持久化层（world_entities/world_relations/world_canvas，画布写不产 revision），pomelo 文档只是内存投影——`buildPomeloRecords` 把实体/World 节点/便签/文本/形状/绑定箭头/语义关系映射为 block（id 与原 shape id 约定对齐：`shape:<id>` / `arrow:<relationId>`），交互层经 `CanvasBindsPlugin` 解析 CanvasSelection 驱动右侧面板、拖拽/resize 经 `moveElement + persistGeometry` 去抖持久化、双击实体卡进入容器、Delete 删关系/草稿。旧 `canvas-tldraw.tsx` 保留为历史参考（不再被 index.tsx 挂载）。与 tldraw 版的 v1 差异：未绑定两端实体的自由箭头暂不渲染、连线锚点拖拽不持久化、内联文本编辑走面板。

## Demo 路由

`app/dev/pomelo-canvas/page.tsx` → `/dev/pomelo-canvas`（dynamic ssr:false）。

交互：点选/拖拽卡片与便签、滚轮平移、⌘/Ctrl+滚轮缩放、空格+拖拽平移、「连线」模式拖卡建关系、Delete 删除、⌘Z 撤销；右侧全高详情面板编辑（真实案例设计锚定：选中 → 侧栏分区：封面/标签/简介/基本信息/关系/参考资料/笔记，与画布实体卡同源自同份 store 数据，卡片封面/缩略图以 emoji 占位）。

## 真实案例式 UI（2026-09 对齐设计稿）

- 浅色画布（demo 覆盖 pixi 背景 0xf1efeb，不改引擎默认色）。
- 实体卡（entity-card-block）：白卡 + 类型色描边，头部封面对头（emoji 占位 + 标题/副标题），标签 pills + 两行简介 + 底部资料缩略图条；entity 增加 subtitle/tags/desc/fields/cover/photos/note 结构化字段（store 与面板同源）。
- 关系连线（relation-arrow-block）：按 relationType 的关系语义色着色（relationColors：师门紫红/朋友蓝/引用绿/出现于橙/位于玫红），中点标签 pill 与线同色。
- 详情面板（detail-panel.tsx）：全高右侧栏，分区展示 + 可编辑字段行、关系按类型分组并可点击跳转对端实体、参考资料/笔记区。

## 迁移中修过的 core 问题

- `#addBlock` 未传 parentId 时父子关系记成 `null`，导致 removeBlock 找不到父数组、文档越滚越大 → 现挂到 `rootBlockId` 并记录正确关系。
- `PixiBlock.render` 的 `appendChild` → pixi 应用 `addChild`。
- editor.destroy 未断开 ResizeObserver / 未销毁 pixi app → 补齐（StrictMode 双挂载安全）。
- `PomeloEditor.onInit` 加 destroyed 保护（异步恢复后不再挂插件到已销毁 adapter）。

## 正式画布接入（后续）

`app/worlds/[worldID]/canvas` 仍走 tldraw（canvas-tldraw.tsx）。接入时把 `canvas-tldraw` 换成本目录的组合根，`canvas-store`（world_canvas/relations API）替换 `demo-store` 即可，插件与 block 结构不变。
