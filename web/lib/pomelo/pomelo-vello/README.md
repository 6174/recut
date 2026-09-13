# pomelo-vello

> L2 | 父级: /web/lib/pomelo

pomelo 的 vello-native 渲染适配层：把 pomelo 的 vdom/block 生命周期接到 `pomelo-tiles` 瓦片管线，
经 `VelloGpuRasterizer`(WebGPU) 或 `Canvas2DRasterizer`(软件回退) 上屏。

## 分层

| 文件 | 职责 |
|---|---|
| `pomelo-vello-adapter.ts` | `VelloRendererAdapter extends PomeloRendererAdapter`：接管 vdom diff/patch 后的 block 树，汇总 `VelloBlock` 绘制为 chunk，驱动 `TileController`；优先 vello，回退 Canvas2D；`ensureImage`/`getImageSize`/`getImageElement` 提供图片注册与 cover-fit 所需尺寸/元素；`setTransform` 广播 `onTransformEvent` 并按 `renderOnZoom` 重绘 |
| `vello-element.ts` | `VelloElement implements IElement`（block 树容器，不做绘制） |
| `vello-block.ts` | `VelloBlock extends PomeloBlock`：`renderBlock()` 产出 vello op（+ 可选 Canvas2D painter）；`render()`/`reposition()` 分别标记内容/位置版本供增量失效；`reposition()` 对内嵌世界坐标做平移（拖拽不滞后/闪动），`blockStateSelector` 忽略 x/y。**内核不感知任何业务 block** |
| `demo-blocks.ts` | 示例 `DemoCardBlock`（M2 验证用） |
| `op-bridge.ts` | JS→WASM 绘制 op 编码（与 `pomelo-vello-wasm/src/ops.rs` 对齐） |
| `canvas2d-rasterizer.ts` / `vello-rasterizer.ts` | `TileRasterizer` 的两种实现 |

> 业务 block（实体卡/便签/World 节点/媒体/关系线等）不再放在内核里：位于
> `world-canvas/blocks/vello-world-blocks.ts`（`EntityCardBlockV` 等 + `entityCardRectV`），
> 由 app 组合根显式注入 `blockTypes`。内核目录不得反向依赖 `world-canvas`/`app`。


## 增量协议

- 首选：`PomeloRendererAdapter.onBlockInvalidated(blockId, "content"|"position"|"removed")` 钩子由
  `BlockPatcher`（`pomelo-virtual.ts`）在 create/update/replace/remove 时广播；适配器收集 dirty/moved/removed
  集合做**精确增量**失效。
- 兜底：`VelloBlock.render()`/`reposition()` 递增 `drawVersion`/`boundsVersion`，适配器在 `syncChunks()` 比对版本。
- chunk 变更 → `contentGeneration++`；瓦片失效按 bounds 相交精确到块。

## 验证

- `/dev/pomelo-vello`：3 个 `demo-card` block 经适配器渲染。
- `node scripts/e2e-pomelo-vello.mjs`：7/7（挂载、光栅器、chunk 数、像素、transact 位移、无报错）。
- 系统 Chrome + WebGPU 下同页 `rasterizer=vello` 亦可渲染（见 `e2e-vello-gpu` 同款 CDP 手法）。

## 尚未迁移

正式 World Canvas 仍走 `PixiRendererAdapter`。剩余两项需要解耦 PIXI：
1. **Overlay 走 DOM/SVG**：`CanvasBindsPlugin` 的选区/手柄/引导线现为 `PIXI.Graphics`，需改为 DOM/SVG 覆盖层。
2. **`canvas-pomelo.tsx` 切换 adapter**：`canvas-pomelo.tsx`（约 1k 行）与 5 个插件（Grid/Viewport/Selection/
   Connection/Keyboard）目前直接依赖 pixi 类型与 `adapter.app.stage`；切换前需先完成第 1 项与插件解耦。

验证入口：`/dev/pomelo-vello`、`/dev/world-vello`；`scripts/e2e-pomelo-vello.mjs`、`scripts/e2e-world-vello.mjs`。
