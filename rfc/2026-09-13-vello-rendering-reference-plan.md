# vello 渲染参考方案（对齐 open-pencil 完整 pipeline）

> 日期：2026-09-13 ｜ 状态：实施参考 ｜ 参考源码：`/Users/chenxuejia/Downloads/open-pencil-master`
> 前置：`rfc/2026-09-13-vello-tile-renderer-research.md`、`rfc/2026-09-13-vello-native-rendering-implementation.md`
> 动机：此前只学了一半（照搬 tiles 网格），把「整场兜底 + 缓存分层 + 增量失效」这些主干漏了，导致拖拽/缩放逐块填充、重复重画、体验问题。本方案先完整梳理 open-pencil，再定我们的分阶段落地。

---

## 一、open-pencil 真实渲染管线

### 1.1 分层与帧调度

- 两个独立 layer / loop：`scene` 与 `overlays`（`packages/core/src/canvas/renderer/pipeline.ts` 的 `RenderLayer`；`packages/vue/src/canvas/surface/render-loop.ts` 各自 rAF 合帧）。
- 帧调度是 **dirty + version 合帧**：`dirty` / `renderVersion` / `sceneVersion` / `selectedIds` 任一变化才重渲；订阅 `render:requested / viewport:changed / repaint:requested / selection:changed`。
- 未完成的工作会自驱下一帧：`tiledScenePending` → `markDirty()`；`sceneBackingNeedsCrispRender` → 定时到 `sceneBackingPreviewUntil` 再 `markDirty()`（`lifecycle.ts:106-112`）。

### 1.2 输入/导航状态机

- `vue/src/shared/input/wheel.ts`：wheel → `editor.setNavigationPhase('pan' | 'zoom')`；停手后 `'settling'`，再 `'idle'` + `requestRepaint()`。
- `editor/create.ts:116`：只有 `idle → active` 过渡时 `navigation.generation++`（双代作废的 nav 代）。
- 拖拽/属性变更走 **position preview**：`scene-graph/src/preview.ts:updateNodePreview` 每次改动 bump `graph.positionPreviewVersion`，并让 scenePicture/backing 失效（`volatile` 渲染，靠 node picture 缓存兜住）。

### 1.3 scene layer 的取捨顺序（`pipeline.ts:191-247`）

1. `tiledSceneEnabled`（选项 `sceneRenderer === 'tiled'`，**默认 false**）且无 position preview / volatile overlay：
   - `renderSceneBacking()` 先铺**保留底图**；没铺成 → 整场 `renderSceneContent()`（scenePicture 命中 / volatile / 重录）；
   - 再 `tiledScene.renderFrame()` 在底图**之上**叠瓦片；导航期瓦片 `deferActiveJobs` 且**一张都不画**；
   - 模式记 `tiled` / `tiled-fallback`。
2. 否则 `renderSceneBacking()`（底图-only）。
3. 都没有 → `renderSceneContent()`：`scenePicture`（整场 SkPicture 回放）/ volatile 全量 / 重录。

### 1.4 缓存层级（粗 → 细）

| 层 | 文件 | 作用 | 失效条件 |
|---|---|---|---|
| `scenePicture` | `pipeline.ts` | 整场 SkPicture，平时 `drawPicture` 回放（Skia 特有，vello 无等价物） | sceneVersion / font / page / positionPreview |
| `sceneBacking` | `retained-backing.ts` | **核心**：整场栅格成一张自适应大纹理 | 同上；导航期允许 stale-zoom |
| `subtreePictureCache` / `nodePictureCache` / `effectRasterCache` | `retained-backing.ts` / `effect-raster-cache.ts` | 子节点/节点/效果图元缓存，加速 backing 构建与 volatile 渲染 | 按依赖精确失效（`state.ts:invalidateNodePicture`） |
| `ChunkPictureCache` + `RenderChunkIndex` | `chunks/*` | 每 chunk（≤32 节点）SkPicture 与空间索引 | chunk 级失效 |
| `TileImageCache` + `tiledScene` | `tiles/*` | 256 设备像素瓦片 LRU（128MB）、5ms/32 job、双 generation | 瓦片级失效 |

### 1.5 retained scene backing 细节（最关键）

- 尺寸（`retained-backing.ts:sceneBackingGeometry`）：
  - `scale = clamp(sqrt(16_000_000 / (viewportW × viewportH × dpr²)), 1, 3)`
  - backing = 视口 × scale，多出的部分均分到两侧作为**平移 margin**。
- 构建（`recordSceneBacking` / `startSceneBackingBuild` + `stepSceneBackingBuild`）：
  - 只在内容版本/字体/positionPreview 变化或覆盖不足时重建；
  - 分片构建，每帧 `SCENE_BACKING_BUILD_BUDGET_MS = 6`；子节点用 `cachedSubtreePicture` 复用。
- 呈现（`drawSceneBacking`）：
  - 覆盖检查：crisp 要求 zoom 一致 + 世界矩形包含 live 视口；stale-zoom 只要求屏幕矩形包含视口；
  - 满足即 `drawImageRectOptions` 按 `zoom / backing.zoom` 缩放贴一张 quad；
  - 覆盖不足 → 返回 false，调用方回退整场直绘（**永不空白**）。
- preview 寿命（`retained-backing/preview.ts:previewIdleMs`）：按 backing 平均构建耗时 + 视口事件间隔，动态定 2–18 帧，运动期间只贴已提交 backing、取消重建；停下后 crisp 重建。

### 1.6 chunks（重复多画的根因）

- `chunks/index.ts`：`MAX_CHUNK_NODES = 32`；超限节点拆 `self` chunk、子节点递归；否则整棵子树一个 `subtree` chunk。
- `atomic`：opacity/blend/blur/mask 节点不可跨瓦片切（先渲独立纹理）。
- `RBush` 空间索引；`painterOrder` 显式绘制序；依赖索引 `getChunksDependingOnNode`（祖先+子孙）。
- 我们当前：整棵树一个 chunk、线性扫描、按 zIndex 排序 —— 大树/大图会被每个瓦片重复编码/重画。

### 1.7 结论

> 官网 demo「看不到加载过程」不是并行，而是 **scenePicture + retained sceneBacking 先把整屏铺满**，tiles 只是其上的精修缓存。
> 所谓「tile 尺寸平衡」本质是 **backing 的像素预算（16M）→ 一张自适应大小的“大 tile”**，不是调 `TILE_DEVICE_SIZE`。

---

## 二、我们的差距

| 机制 | open-pencil | 现状（pomelo-vello） |
|---|---|---|
| 整场底图（backing） | ✅ 预算+margin，增量构建 | ❌ 每帧 `render_frame` 全量重编码（`resolve_patches` 按整场重复） |
| 导航预览窗口 | ✅ previewIdleMs 自适应 | ❌ 固定 180ms + `renderDirect` 全量 |
| 内容/位置版本 | sceneVersion + positionPreviewVersion | 仅 contentGeneration（拖拽走 transact + 自建 content session） |
| chunk 粒度 | ≤32 节点、self/subtree、RBush、依赖索引、painterOrder、atomic | 单块整树、线性扫描、zIndex 排序 |
| 瓦片与底图关系 | 底图在下、瓦片在上；导航不跑瓦片 | 二选一；瓦片模式导航 eager 且逐块可见填充 |
| 进度可见性 | 看不到（底图先铺满） | 瓦片模式可见填充 |

---

## 三、参考方案（分阶段，P0 先保正确）

- **P0 兜底永远正确**：保留 direct 全量渲染作为「绝不空白/残缺」fallback（对应 `renderSceneContent`）。
- **P1 retained scene backing（核心，收益最大）**：
  - vello 把整场渲成一张自适应底图纹理（`scale = clamp(sqrt(16M/视口设备像素),1,3)` + margin）；
  - 内容版本不变时，平移/缩放按新 transform 贴这张纹理（单 quad，<1ms，不再重编码）；
  - 导航期 stale-zoom，落定后 crisp 重建；覆盖不足回退整场直绘；
  - 这一步同时解决 transform 卡顿、逐块填充、重复重画。**这就是“一个自适应大 tile”。**
- **P2 增量构建 + preview 时序**：底图按 ~6ms/帧分片构建；preview 寿命按实测构建耗时与输入间隔自适应。
- **P3 chunk index 升级**：`MAX_CHUNK_NODES=32` 拆分、RBush、依赖索引、显式 painterOrder、atomic 标记（`chunk-index.ts` 改造）。
- **P4 tiles 作为精修层（可选，默认关）**：底图之上叠瓦片；导航期全 defer、不画瓦片；落定后补。tile 仍 256，不调尺寸。
- **P5 拖拽**：用 `positionPreviewVersion` 语义（拖拽只 bump position 版本）+ live 层；现有 content session 保留并可并入 P3/P4。

### P1 接口草案

```ts
// TileRasterizer（可选能力）
buildSceneBacking?(chunks: RenderChunk[], backingViewport: Viewport): void;
presentSceneBacking?(viewport: Viewport, allowStaleZoom: boolean): boolean; // 返回是否覆盖
endSceneBacking?(): void;
```

- `backingViewport`（TS 侧算）：`panX - marginX, panY - marginY, zoom, width*scale, height*scale, dpr`。
- 控制器：`backingGeneration === contentGeneration && presentSceneBacking(...)` 命中则复用；否则搜 backing 世界矩形内的 chunks → `buildSceneBacking` → 立即 `presentSceneBacking(crisp)`。
- 结构失效（`invalidateStructure`）→ `endSceneBacking()` + `backingGeneration = -1`。
- Rust：`build_scene_backing`（渲到保留纹理）/ `present_backing`（按新 transform 贴，含覆盖判定）/ `end_content_session`。

---

## 四、验收

- 平移/缩放：热缓存每帧 <1ms；不出现逐块填充；首屏一次铺满。
- 覆盖不足/内容变化：自动回退整场渲染，**永不空白**。
- 拖拽：仅 live chunk 重渲（现有 content session）。
- `e2e-world-canvas-vello.mjs` 全绿；`__pomeloPerf` 无回归；截图无残影/缺图。

---

## 五、实施状态

### P1 保留场景底图 — 已完成（2026-09-13）

- Rust `runtime.rs`：`build_scene_backing`（渲到保留纹理）/ `present_backing`（按 transform 贴 + 覆盖判定）/ `end_scene_backing`；连同已有 content session。
- TS：`TileRasterizer` 增 `buildSceneBacking/presentSceneBacking/endSceneBacking`；`VelloGpuRasterizer` 实现；`TileController` direct 分支改为「命中底图 → 单 quad；未覆盖/内容变 → 重建」；`invalidateStructure` 释放底图。
- 实测（`?renderer=vello`，1200×749 CSS，dpr 3）：
  - 平移（余量内）：**0.2ms/帧，0 次重建**；越界才重建（p50 5.7ms）。
  - 缩放：约 0.9ms/帧 + 少量重建。
  - 拖拽：content session 40 帧 × 2 live chunk，p50 2.2ms；结束后 1 次底图重建（9ms）。
  - `e2e-world-canvas-vello.mjs` 7/7，非背景像素 49909（与 direct 基线 49439 相当），无 page error。
### P2 分帧增量底图构建 — 已完成（2026-09-13）

- Rust：`Compositor::render` 增 `load` 参数（累积用 LoadOp::Load）；`begin_scene_backing`（新建累积目标，**保留旧底图**）/ `step_scene_backing`（每步最多 1 个 batch，`BACKING_BUILD_BATCH_CHUNKS=6`，累积到同一纹理）/ `end_scene_backing`。
- TS：`beginSceneBacking/stepSceneBacking`；`TileController` 在「覆盖不足」时贴旧底图占位 + 分帧重建；adapter 依据 `result.pending` 续帧。
- 实测：内容变化的分帧重建每帧 ~4–6ms（对比一次性 9ms，避免单帧 spike）；平移余量内 0.3ms/帧、0 重建。

### 踩坑与修正（都已修）

1. **backing margin 方向**：backing 视口应为 `pan + margin`（向四周扩），写反会导致覆盖判定恒 false、每帧重建。
2. **格式不匹配**：compositor pipeline 的 target format = **surface format（如 BGRA8Unorm）**，底图累积纹理必须同格式；否则 wgpu 静默跳过 pass → 底图全空。
3. **拖拽松手“原位闪现”**：内容变化（generation 不符）时若贴旧底图占位 + 分帧重建，会短暂显示改动前的画面。修正：**内容变化 → 一次性重建（立即新内容）；仅覆盖不足（内容不变）才 stale 预览 + 分帧重建**。
4. **dev wasm 缓存**：wasm-pack 重建后浏览器缓存旧 wasm（缺新导出 → `xxx is not a function`）。dev 下给 wasm URL 加 `?v=` cache-bust（生产不加）。

### 未做（按设计暂缓）

- **P3 chunk index**（32 节点拆分/RBush/依赖索引/painterOrder/atomic）：只对 tile 路径有意义；当前 backing 主导，暂不需要。
- **P4 tiles 精修**：backing 已满足清晰度与“无逐块填充”；tiles 会引入此前体验 bug，默认关闭。
- **P5 position preview**：拖拽已由 content session 覆盖，语义等价，暂不改。
