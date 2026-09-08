# 方案二落地：pomelo pixi adapter 内部瓦片/快照渲染（含 M0 demo 验证页）

> 日期：2026-09-08 ｜ 状态：提案 ｜ 上游 RFC：`rfc/2026-09-08-canvas-rendering-skia-vs-tiles.md`
> 硬约束：**上层调用体验不变**——pomelo 的 transact→diff→patch 数据纪律、各 Block 的渲染代码、
> world-canvas 插件（CanvasBindsPlugin/Viewport/Grid）、canvas-pomelo 组装层全部不动；
> 一切改动收敛在 `pomelo-core` 的 adapter/ticker 层，插件最多增加一次可选 API 调用。

## 0. 总体形态：adapter 是唯一的改动面

```
PomeloEditor
 ├── state（不变）
 ├── ticker（已实现：input → update → overlay 三相）
 └── renderAdapter: PixiRendererAdapter   ←←← 全部新代码在这里
       ├── 渲染循环改为「脏才 flush」（demand-driven）
       ├── TileScene（stage 私有重组，开发者无感）
       │    ├── TileLayer        视口瓦片（RenderTexture 精灵），承载 99% 静态内容
       │    ├── LiveLayer        活块：拖拽会话中被排除的块 + 其依赖块（如箭头）
       │    └── InteractionLayer 现有 overlay Graphics（不变）
       ├── SnapshotController    拖拽会话级全屏快照（M1），是瓦片的降级/兜底路径
       └── TileScheduler         open-pencil 算法直译（任务/预算/取消见 §4）
```

原则：插件照旧只调 `transact + drawOverlay`；adapter 在内部决定「这一帧 GPU 究竟画多少」。

## 1. 第一步：需求驱动的渲染 flush（M0 前置，~100 行）

现状：pixi Application 默认 ticker 每 vsync 全画布 render 无论有没有变化。
改动（`pomelo-pixi-adapter.ts`）：

- `new PIXI.Application({ autoStart: false, ... })`，`app.ticker.stop()`；
- `render()`（PomeloRenderer vdom patch 后回调）体量不变，但结尾只置 `#dirty = true`；
- ticker `update` 相开头：`if (#dirty) { app.renderer.render(stage); #dirty=false; pomeloPerf.record("flush", …) }`；
- `setTransform` / `setContainerSize` 同样只置脏（transform 变化后文字分辨率 debounce 见 §3）。

效果：空闲零 GPU；同一帧内 N 次数据变更合并为 1 次 flush。这是纯内部改动，接口零变化。

## 2. M0：dev/demo-pencil 验证页（半天，算法骨架先行）

目的：在写正式协议之前，先把 open-pencil 三个算法文件（tiles/scheduler.ts、planner、surface-pool）
翻译成 pixi 语境跑通——假内容、无文档耦合：

- 路由 `web/app/dev/demo-pencil/page.tsx`（dev-only，不进生产 build 白名单）；
- 场景：300 个假卡片（Graphics+Text）生成随机布局，作为 TileScene 的内容源；
- 独立实现 `PixiTileScheduler`（§4 直译）+ `TileStore`（RT 池），关掉连续渲染；
- 屏上 MSE 指标：每帧 tile job 数 / 超预算次数 / RT 显存字节数；`frame.drift` 采点；
- 验收：拖一张假卡帧内只有 1 个 tile 重栅格 + 30 个 quad blit；GPU 块 < 3ms。

**算法直译清单（从 open-pencil 源码逐条对照）**：

| open-pencil 行为 | 常量/语义 | pixi 翻译 |
|---|---|---|
| `TILE_FRAME_BUDGET_MS=5`,`MAXIMUM_TILE_JOBS_PER_FRAME=32` | 每帧 GPU 栅格预算 | 同数值；尖刺帧强制只跑 1 个 mandatory |
| 任务优先级 `mandatory/visible/overscan` | 排序执行；fallback 可用时预算内跑不下就顺延 | 翻译进 `scheduler.enqueue` 排序即可 |
| navigationGeneration/contentGeneration 双代 | 变换中产生的 job 变换结束后全部作废 | `isStale` 判定 + `setGeneration` 清队，行为直译 |
| `measuredCosts` EMA `0.7/0.3` | 下次规划估算依据 | 直译 |
| `TileSurfacePool` | Surface 复用 | RT 池：释放的瓦片 RT 回收复用，避免 `RenderTexture.create` 抖动 |
| `TILE_OVERSCAN=1` | 视口外包一圈 | 直译；LRU 里 overscan 瓦片最便宜 |

## 3. M1：拖拽会话全屏快照（真实画布首次验收）

新增 `SnapshotController`（adapter 私有），对外只有两个方法加一个会话参数：

```ts
interface PixiRendererAdapter {
  // 插件 pointerdown 时调用；excludedBlockIds 的块容器在快照期间移入 LiveLayer
  beginContentSession(excludedBlockIds: string[]): void
  endContentSession(): void
}
```

- `beginContentSession`：
  1. excluded 块容器 reparent 到 LiveLayer（渲染顺序不变——同一 stage 树内平移，z 序按原 depth 保持近似）；
  2. 把 mountpoint（除 excluded）渲成一张全屏 `RenderTexture`（`app.renderer.render(mountpoint, { renderTexture, transform: 世界矩阵+dpr })`），
     ContentLayer 隐藏，快照精灵上台（GPU 每 帧 = 1 quad + LiveLayer 小量绘制 + overlay）；
  3. 拖拽中 `setTransform` 被视为语义错误（插件本来拖拽期间不动视口），出现则直接 `endContentSession` 回退全量路径，绝不闪错。
- `endContentSession`：恢复 reparent、释放 RT、置脏。
- 契约与失败兜底：任何一步失败（RT 分配失败/结构突变）都回退现状全量渲染路径，功能向上兼容。
- **受影响元素问题不解决而蒸发**：箭头是独立 block，糊排进快照会跟不上拖动；规则——插件把
  「被拖块 + 与其相连的 relation arrow 的 blockId」一并传 `excludedBlockIds`（此刻此列表插件本来就有；
  snapshot 后这些块由 pixi 自动每帧照常重画——因为 LiveLayer 在快照之上正常参与每帧 render）。
  「活块谁算」的复杂度被折叠成插件已有信息的一个集合传参。

验收（真实 World 画布）：GPU 块 ≤ 3ms、无貼线红帧、e2e 全绿、截图无拼接异常。

## 4. M2：瓦片调度（TileScene 正式版）

快照盈利验证后，把「单张全屏快照」升级为「视口瓦片 + 块级 chunk 缓存」，全面替换 dict：

### 4.1 数据结构

```ts
// chunk = 块级位图（open-pencil RenderChunkPictureCache 的 pixi 直译）
// 渲染方式零穿越：app.renderer.render(blockContainer, { renderTexture, transform, })
//   —— pixi v7 的 render(displayObject, { renderTexture, transform }) 不需要 reparent
class ChunkCache {
  ensure(blockId): ChunkTexture           // 惰性建 RT（含 dpr 缩放）
  invalidate(blockId)                     // 块内容变 → RT 待重建 + 相交瓦片置脏
  evict(notVisible): void                 // LRU：出视口 2s 释放，RT 池接管
}
class TileStore {
  // 512 逻辑×dpr2 设备像素，key `${tx}:${ty}`（首期单 LOD）
  get(tx,ty): Sprite | null               // miss/null → 上屏 fallback 全场景直绘帧兜底
  install(key, composedTexture, generation)
}
```

### 4.2 失效协议（显式，不依赖 pixi 隐式失效）

- `PomeloRenderer` patch 阶段已区分 `reposition()`（仅 x/y）与 `render()`（内容变）；
  在两者处钩一个回调：`tileScene.onBlockInvalidated(blockId, { kind: 'position' | 'content' })`；
  - `position`：只挪 block 的 chunk 精灵 transform，零栅格；其 chunk 所在瓦片**不需要重画**
    （因为瓦片只是 chunk 图的拼贴册——等同 open-pencil chunk→tile 的两级）；
    同时把「覆盖这个新位置的瓦片」置脏（逐出旧、补新瓦片是个位图搬运，也是 quad blit）；
  - `content`：块 chunk RT 重绘（<1 tile 大小）→ 相交瓦片置脏；
- 拖拽会话内（M1 语义保留）：瓦片 job 全部 defer（`navigationActive`），旧瓦片+快照层接管。
- 命中：`hitTest/selection/箭头几何` 不依赖瓦片层，全部仍走文档投影，行为不变。

### 4.3 渲染帧循环（renderFrame 直译 controller.ts）

```
每 vsync（ticker update 相）：
  1. generation 推进/作废 stale jobs（scheduler.setGeneration 直译）
  2. planTiles：视口(+overscan1) 求可见瓦片 → 命中直用 / miss 则按
     priority + estimatedCost(EMA) 入调度队列；viewport 未覆盖有 chunk 的瓦片先全场景直绘兜底
  3. runFrame：按预算跑 job（每 job：块 chunk RT → 拼贴进瓦片 RT → install）
  4. drawVisibleTiles：所有命中瓦片 quad 绘制；LRU 收视口+0.5 邻域外释放
```

### 4.4 显存预算（常数，与节点数无关）

瓦片覆盖 ≈ 视口 × (1 + 0.5 overscan + 邻域 LRU 富余)；3200×1800@2x ≈ **~25-30MB 常驻**
（chunk RT 是瓦片原料，LRU 上限同瓦片覆盖面）。300 块 & 30 块同帧 GPU 操作数一致。

## 5. 落地文件清单

| 文件 | 动作 |
|---|---|
| `pomelo-pixi-adapter.ts` | demand-driven flush、stage 三层重组、TileScene/Snapshot 接入 |
| `pomelo-core/pomelo-tiles.ts`（新） | TileStore / ChunkCache / PixiTileScheduler / SurfacePool / planner |
| `pomelo-ticker.ts` | tile job 预算计数与 job 帧执行（input/update 分相已具备） |
| `pomelo-renderer.ts` | patch 处 `onBlockInvalidated(kind)` 广播（仅加一行回调） |
| `canvas-pomelo-plugin.ts` | 仅两处调用：begin/endContentSession 传 excluded 列表 |
| `web/app/dev/demo-pencil/page.tsx` | 新增演示页（dev-only） |
| `e2e` 脚本 / RENDERING-NOTES.md | 新增 GPU 曲线断言与文档沉淀 |

## 6. 风险与逃生门

1. **pixi `renderer.render(blockContainer, {renderTexture, transform})` 的矩阵行为**——M0 里第一个验证
   （若 transform 语义有坑，退路 = reparent 策略，仍是 adapter 内部事）；
2. 瓦片 RT 撞显存预算：LRU 上限 + 全局 fallback 表（open-pencil `globalFallbackAvailable` 同款）；
3. 排版双 record 副作用在 reparent 时暴露：M1 里 excluded 集合的命中/选中几何全部出自
   `entityCardRect()`/attrs（不变），已与渲染树解耦，不会错位；
4. e2e 开发模式下 React StrictMode 双跑：TileScene 用 generation 兜底幂等。
