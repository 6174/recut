# lib/pomelo — tldraw 替代：pomelo core + pixi renderer + plugins

从 `/Users/chenxuejia/ws/2025/pomelo` 迁移的编辑器内核，作为 world 无限画布的自研底座（替代 tldraw 的 license 方案）。

## 结构

- `pomelo-core/`：编辑器内核（原样迁移 + strict TS 适配）
  - `pomelo-editor.ts`：Editor 封装（container/plugin DOM/renderer/状态层/插件生命周期）
  - `pomelo-state/`：yjs 数据层（BlockTree、transact、undo/redo）
  - `pomelo-renderer/`：渲染协调（virtual-dom diff + BlockPatcher 增量挂载/更新/删除）
  - `pomelo-pixi/`：PixiRendererAdapter + PixiElement + PixiBlock（渲染底层适配器）
  - `pomelo-plugin/`：插件机制（PomeloPlugin / PomeloReactPlugin）
- `pomelo-world-canvas/`（`world-canvas/`）：Recursive World Canvas 的 pomelo 实现（demo）
  - `blocks/`：entity-card / note / world-node / relation-arrow（tldraw arrow-binding 思路的简化实现：绑定关系存 store，几何在渲染期解析）
  - `plugins/`：viewport（滚轮平移/⌘滚轮缩放/空格拖拽）、selection（点选/拖拽位移/连线命中）、connection（连线模式）、keyboard（Delete/Escape/⌘Z）
  - `doc-sync.ts`：store → 编辑器文档的映射与全量重建
  - `demo-store.ts`：demo 内存数据源（无后端）
- `pomelo-apps/`、`pomelo-plugins/`：原仓库存量 demo/插件，依赖 `@pixi/react`（与 React 19 不兼容），已在 `tsconfig.json` exclude 中排除，待 React 19 兼容后再启用。

## Demo 路由

`app/dev/pomelo-canvas/page.tsx` → `/dev/pomelo-canvas`（dynamic ssr:false）。

交互：点选/拖拽卡片与便签、滚轮平移、⌘/Ctrl+滚轮缩放、空格+拖拽平移、「连线」模式拖卡建关系、Delete 删除、⌘Z 撤销；右侧详情面板编辑（loomic 交互结构锚定：选中 → 面板）。

## 迁移中修过的 core 问题

- `#addBlock` 未传 parentId 时父子关系记成 `null`，导致 removeBlock 找不到父数组、文档越滚越大 → 现挂到 `rootBlockId` 并记录正确关系。
- `PixiBlock.render` 的 `appendChild` → pixi 应用 `addChild`。
- editor.destroy 未断开 ResizeObserver / 未销毁 pixi app → 补齐（StrictMode 双挂载安全）。
- `PomeloEditor.onInit` 加 destroyed 保护（异步恢复后不再挂插件到已销毁 adapter）。

## 正式画布接入（后续）

`app/worlds/[worldID]/canvas` 仍走 tldraw（canvas-tldraw.tsx）。接入时把 `canvas-tldraw` 换成本目录的组合根，`canvas-store`（world_canvas/relations API）替换 `demo-store` 即可，插件与 block 结构不变。
