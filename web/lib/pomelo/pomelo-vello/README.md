# pomelo-vello

> L2 | 父级: /web/lib/pomelo

pomelo 的 vello-native 渲染适配层：把 pomelo 的 vdom/block 生命周期接到 `pomelo-tiles` 瓦片管线，
经 `VelloGpuRasterizer`(WebGPU) 或 `Canvas2DRasterizer`(软件回退) 上屏。

## 分层

| 文件 | 职责 |
|---|---|
| `pomelo-vello-adapter.ts` | `VelloRendererAdapter extends PomeloRendererAdapter`：接管 vdom diff/patch 后的 block 树，汇总 `VelloBlock` 绘制为 chunk，驱动 `TileController`；优先 vello，回退 Canvas2D |
| `vello-element.ts` | `VelloElement implements IElement`（block 树容器，不做绘制） |
| `vello-block.ts` | `VelloBlock extends PomeloBlock`：`renderBlock()` 产出 vello op（+ 可选 Canvas2D painter）；`render()`/`reposition()` 标记内容/位置版本供增量失效 |
| `demo-blocks.ts` | 示例 `DemoCardBlock`（M2 验证用） |
| `op-bridge.ts` | JS→WASM 绘制 op 编码（与 `pomelo-vello-wasm/src/ops.rs` 对齐） |
| `canvas2d-rasterizer.ts` / `vello-rasterizer.ts` | `TileRasterizer` 的两种实现 |

## 增量协议

`VelloBlock.render()` 递增 `drawVersion`（内容变），`reposition()` 递增 `boundsVersion`（仅位置变）。
适配器 `syncChunks()` 据此：内容变 → `invalidateChunk(payload+bounds)`；位置变 → `invalidateChunk(bounds)`；
新增/移除 → `addChunk`/`removeChunk`；任一变化 `contentGeneration++`。瓦片失效仍按 bounds 相交精确到块。

## 验证

- `/dev/pomelo-vello`：3 个 `demo-card` block 经适配器渲染。
- `node scripts/e2e-pomelo-vello.mjs`：7/7（挂载、光栅器、chunk 数、像素、transact 位移、无报错）。
- 系统 Chrome + WebGPU 下同页 `rasterizer=vello` 亦可渲染（见 `e2e-vello-gpu` 同款 CDP 手法）。

## 尚未迁移

正式 World Canvas 仍走 `PixiRendererAdapter`；M2 后续：4 个 world-canvas block 迁移为 `VelloBlock`、
`onBlockInvalidated` 接 pomelo diff、Overlay 走 DOM/SVG、`canvas-pomelo.tsx` 切换 adapter。
