# pomelo-tiles

> L2 | 父级: /web/lib/pomelo/pomelo-core

renderer 无关的瓦片渲染算法层。逐模块直译 open-pencil 的 production 瓦片系统
（`packages/core/src/canvas/renderer/tiles/*`），只把「光栅化后端」抽象成 `TileRasterizer` seam。

## 模块

| 文件 | 职责 |
|---|---|
| `geometry.ts` | `TILE_DEVICE_SIZE=256` / `TILE_LEVEL_STEP=0.25` / LOD 量化 / 可见瓦片枚举 |
| `tile-cache.ts` | 瓦片字节 LRU（默认 128MB）+ `advanceGeneration` / `invalidateBounds` |
| `planner.ts` | `planTiles`：fresh 判定 + mandatory/visible/overscan + cachedOnly（导航期） |
| `scheduler.ts` | 5ms 预算 / 32 job 上限 / 优先级 / navigation+content 双代 / 成本 EMA |
| `chunk-index.ts` | chunk 注册与按世界矩形查询 + 节点→chunk 反查 |
| `controller.ts` | `TileController.renderFrame` 编排（失效应用/plan/执行/合成）；direct 模式保留场景底图（内容不变时平移/缩放只贴底图；覆盖不足分帧增量重建、内容变化一次性重建）与拖拽内容会话（静态内容只渲一次，会话帧只重渲 live chunks） |
| `telemetry.ts` | 帧指标与全局计数（供 e2e 读取） |

## 约定

- 不 import vello / pixi / DOM；纯 TS，可在浏览器与 Node 测试环境运行。
- 光栅器实现 `TileRasterizer<TTarget, THandle>`：当前实现为 vello(WebGPU/WASM)，
  接口保持渲染后端无关（见 `rfc/2026-09-13-vello-native-rendering-implementation.md`）。
- `RenderChunk.payload` 是光栅器私有内容：vello 为绘制 op 列表。
