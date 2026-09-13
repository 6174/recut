# 调研报告：Vello × open-pencil 瓦片策略 × pomelo-vello-adapter

> 日期：2026-09-13 ｜ 状态：调研（未实施）
> 缘起：World Canvas 现用 pixi v7 + 粗糙的瓦片/快照优化；`/tmp/open-pencil` 的瓦片渲染策略性能极佳；`mello` 曾尝试用 vello 做瓦片渲染但未完成；`/tmp/react-vello` 让 vello 更可用。
> 关联上游：`rfc/2026-09-08-canvas-rendering-skia-vs-tiles.md`（方案一 Skia vs 方案二 pixi+tiles）、`rfc/2026-09-08-canvas-pixi-tiles-implementation.md`（方案二落地）。
> 本报告只做事实核验与架构判断，不替代决策 RFC。
>
> **决策（2026-09-13，已采纳）**：**不做 pixi + vello 双栈混用**。走 **vello-native**——直接以 vello 改造 pomelo 渲染层，`VelloRendererAdapter` 整体替换 `PixiRendererAdapter`。理由：双栈的跨 GPU-API 纹理共享成本会吃掉收益，且两套 block/文本/字体/交互栈长期维护差；单栈架构更干净、上限更高。本报告中所有「形态 B（vello 光栅 + pixi 合成）」相关内容仅作为**被否决的备选**保留。

## 0. 结论摘要（TL;DR）

1. **你的直觉是对的：vello 不是 Skia 的等量替换。** 差别不在「支不支持瓦片」，而在**缓存的粒度**：Skia 的 `SkPicture` + `makeImageSnapshot` 是「栅格级」缓存——录一次、便宜重放、便宜出纹理；vello 的 `Scene` 是「drawcall/编码级」缓存——缓存它**只省下 CPU 把绘制命令编进 Scene 的成本，省不下光栅化**。每次 `render_to_texture` 都会把整个编码重新走一遍 CPU 分箱 + GPU coarse/fine raster。这是本报告最重要的判断，详见 §2.5。

2. **已决定走 vello-native 单栈**（不用 pixi + vello 混合）。既然 Scene 缓存不省光栅（第 1 点），那么**瓦片位图缓存就是避免「每帧全量重光栅」的唯一手段**——open-pencil 的 layer 3（`TileImageCache` + scheduler + planner）因此成为 vello 架构的**必需件，而非可选优化**。合成也留在 vello：每帧把命中瓦片用 `Scene::draw_image` 拼成一个合成 Scene 渲染上屏（同一 WebGPU 上下文，无跨 API 纹理问题）。

3. **open-pencil 真正值钱的是与渲染器无关的算法层**（`TileScheduler` 5ms/32job、双 generation、EMA 成本、`TileImageCache` 128MB LRU+bounds 失效、`planTiles`、`navigationActive` defer）。这部分可以直接移植，是 vello-native 架构的地基；它不依赖 Skia 也不依赖 vello。

4. **mello 的尝试（不必在意其对错）给我们的线索**：瓦片合成路径被 `if false` 关掉、每帧仍全量直绘；`register_texture` 的 `COPY_SRC` 坑、多 zoom stale 累积、纯平移误失效、瓦片缝/缩放错位，都是真实会踩的坑。它 vendored 的 vello 0.5 自改 `register_texture` 补丁，在 vello 0.7 已上游化，**新做不必 fork**。

5. **`/tmp/react-vello` 只有「JS↔WASM 边界」参考价值**（二进制 op buffer + `apply_and_render` + React reconciler + 软件回退），**不能作为内核**：它每帧全量重编码、全量重渲染，没有场景保留/缓存/partial update。

6. **vello-native 的最大工程面不是渲染，而是「重建 pomelo 的 block 绘制 + CJK 文本 + 交互 overlay」**；最大风险是 WebGPU 覆盖（去掉 pixi 后没有现成降级路径，需靠 `vello_hybrid` 的 WebGL 后端或 Canvas2D 软件回退兜底）。**建议分阶段：先抽 open-pencil 算法层 → vello 静态子集 spike（含中文文本）→ 瓦片路径 → 全量 block/交互迁移。**

---

## 1. 事实核验

### 1.1 open-pencil 的瓦片策略（源码级）

> 说明：`/tmp/open-pencil` 的 checkout 不完整（`.git/objects` 只有空的 `pack`，源码目录为空），无法本地读码。以下直接读 **GitHub `open-pencil/open-pencil@master`** 的 `packages/core/src/canvas/renderer/tiles/*`，以代码为准（其官网 comparison 页仍写「不需要 tiling」，与代码不符，以代码为准）。

瓦片目录 9 个文件，职责清晰，总代码量很小（scheduler 5.6KB、controller 11KB、planner 2.8KB、render 3.5KB、cache 3KB、geometry 1.6KB、surface-pool 0.8KB、telemetry 1.8KB）：

| 文件 | 关键事实 |
|---|---|
| `geometry.ts` | `TILE_DEVICE_SIZE = 256`（**设备像素**）；`TILE_LEVEL_STEP = 0.25`，`tileLevel(scale)` 把 `zoom*dpr` 量化到 0.25 步长的 **LOD 层级**（小于 0.25 时按 2 的幂细分，下限 step/16）；`TileKey = {pageId, level, x, y}`；`tileWorldSize = 256/level` |
| `surface-pool.ts` | Surface 复用池，避免每瓦片分配/释放抖动 |
| `cache.ts` | `TileImageCache`：按 **字节数 LRU**（默认 128MB），`install/evict`；失效协议是 **generation + bounds 相交**：`advanceGeneration` 全量推进版本、`invalidateBounds` 只删相交瓦片 |
| `scheduler.ts` | `budgetMs=5`、`MAXIMUM_TILE_JOBS_PER_FRAME=32`；任务优先级 `mandatory / visible / overscan`；**双代**（`navigationGeneration` + `contentGeneration`）作废 stale jobs；`estimatedCost` EMA（controller 里 `0.7*old + 0.3*new`）；`fallbackAvailable` 允许超预算跳过而非掉帧 |
| `planner.ts` | 可见瓦片 `contentGeneration` 一致 = fresh；否则入队（有旧瓦片或有全局 fallback 时为 `visible`，否则 `mandatory`）；**只有可见瓦片全部命中才去规划 overscan** |
| `render.ts` | `renderTile`：`surfacePool.acquire` → `clear` → `scale(level)` → `translate(-bounds)` → `clipRect(tile bounds)` → 对相交 chunk 先查 `RenderChunkPictureCache`（SkPicture），命中 `drawPicture`，未命中 `drawRenderChunkDirect`（atomic blur 特例）→ `flush` → `makeImageSnapshot` |
| `controller.ts` | `TiledSceneController`：`navigationActive = pan/zoom/momentum/settling`，导航期间**全部 defer**（`deferActiveJobs`），只贴旧瓦片 + 全局 fallback；`prepareGeneration` 里 `setGeneration` 清 stale 队；`applyPendingInvalidations` 用 chunk 索引做「节点 → 相交 chunk → 相交 tile」的精确失效；`drawVisibleTiles` 用 `drawImageRectOptions(..., Linear, Src)` 贴瓦片 |

**两级缓存的本质**：
1. `RenderChunkIndex` + `RenderChunkPictureCache`：**chunk 级指令录制缓存**（chunk = 节点/子树的绘制命令），失效粒度 < 整场景；
2. `TileImageCache`：**瓦片级位图缓存**，稳态帧只做 quad blit。

**导航/拖拽时的关键纪律**：`navigationActive` 期间不栅格化任何瓦片，只贴旧瓦片；变换结束（settling）后再按 5ms 预算补作业。这解释了「拖拽/缩放不卡」——**帧内 GPU 只做合成，不做光栅化**。

### 1.2 recut 现状（pixi）

- 渲染分层：`canvas-store`（语义真相）→ `syncDocFromCanvasStore` 全量重建 pomelo 文档 → vdom diff/patch → `PixiBlock.render`（`RENDERING-NOTES.md` §三）。
- 已落地的优化：
  - **demand-driven flush**（`pomelo-pixi-adapter.ts`：`autoStart:false`，变化只置 `#dirty`，ticker `update` 相每帧至多一次 `app.renderer.render`）；
  - **拖拽会话全屏快照（M1）**：`beginContentSession(excludedBlockIds)` 把被拖块 + 相连箭头 reparent 进 LiveLayer，其余场景栅格成一张全屏 RenderTexture；
  - `reposition()`（仅 x/y 变）避免拖拽每 move 全量重建。
- **未落地**：RFC `2026-09-08-canvas-pixi-tiles-implementation.md` 的 **M2 瓦片调度（`TileStore`/`ChunkCache`/`PixiTileScheduler`）尚未实现**；当前只有「一张全屏快照」，没有瓦片、没有空间失效、没有预算调度。
- 契约面：`PomeloRendererAdapter` 抽象方法仅 `setTransform / setContainerSize / createIElement`（外加基类里的 vdom diff/patch/layout）。`PomeloBlock` 通过 `adapter.createIElement` 构造 `hostElement/contentElement/childrenElement`（类型是 `IElement`），**这一层是 renderer 中立的**。
- **耦合点**：具体 Block（`web/lib/pomelo/world-canvas/blocks/*` 与 `PixiBlock`）的 `renderBlock()` 直接返回 `PIXI.Container/Graphics`，`PixiBlock.render()` 把 `.el` 塞进 `contentElement.el`。`web/lib/pomelo` 下 21 个文件 import `pixi.js`。**任何非 pixi backend 都要重写这层 block 绘制。**

### 1.3 前序 vello 尝试（mello，作为线索）

> 说明：这是你之前的探索，不一定正确，本报告只把它当「哪些坑真实存在」的经验来源，不作对错评判。

- **已完成且有效**：vello + WebGPU 渲染器（surface / render_to_texture / blit）、`Scene` 元素转换、颜色解析（`VELLO_RENDERER_IMPLEMENTATION.md`）。
- **瓦片部分未收口（线索价值高）**：
  - `TileRenderer` 有完整的 `tile/tile_cache/tile_scheduler/task_manager/viewport_transform` 模块（`TILE_SIZE=512`，离散 zoom levels，LRU 100 tiles，双 renderer 架构）；
  - 瓦片合成在 `render_to_surface()` 里被 `if false { ... 瓦片合成 } else { 直接渲染可见元素 }`（`src/tile_renderer/tile_renderer.rs:328`）包裹，运行时走 else；而 `ensure_tiles_rendering` 仍每帧栅格化瓦片；
  - 瓦片栅格是**同步**的（注释「For simplicity in WASM, render tiles synchronously for now」），`RenderTaskManager` 的 6 并发异步未接入，5ms 预算调度不存在；
  - 文档内部有两种未统一的主张：`VELLO_TILE_COMPOSITING_ANALYSIS.md` 主张「不要 texture，直接 `Scene::append` 合并、单次渲染」，`TILE_RENDERING_STRATEGY.md` 又主张「大场景 texture 缓存快 10 倍」——这个未解的矛盾正是本报告 §2.5/§2.2 要回答的：**两者解决不同问题，Scene 缓存省 CPU 编码、不省光栅，瓦片位图才是"不重光栅"的唯一路径。**
- **它踩过的真实坑**（对我们有直接价值）：
  - `COPY_SRC` flag 缺失导致黑屏（`register_texture` 要求 `Rgba8Unorm + COPY_SRC`）；
  - 多 zoom level 的 stale tile 累积导致 tile 数翻倍、越缩越卡（`TILE_PERFORMANCE_FIX.md`：`get_visible_tiles` 必须按 zoom 过滤，且每帧清理 stale）；纯平移不得 invalidate（误用 `invalidate_outdated_tiles` 每帧全量失效）；
  - 瓦片缝隙（`TILE_GAP_FIX.md` / 合成时 `overlap_world = 0.4/zoom` 外扩）、缩放/变换错位（`TILE_ZOOM_FIX.md` / `TILE_TRANSFORM_FIX.md`）。
- **依赖债**：mello vendored `vello-main`（workspace 0.5.0）并自改 `lib.rs` 加 `register_texture`/`image_overrides`。**这是无效负债**——见 1.4。

### 1.4 vello 现状（关键变化）

- 上游 changelog：**`register_texture` / `unregister_texture` 在 0.7.0（2026-01-13）公开**（#1161），0.10.0 为当前最新（2026-08-14）。`Scene::append(other, Option<Affine>)` 一直是公开的 O(N) 合并 API；`Renderer::render_to_texture` 是官方推荐路径（先渲中间纹理再用 `TextureBlitter` blit 到 surface）。→ **不需要 fork，只要 vello ≥ 0.7。**
- 架构分叉（很重要）：
  - **vello classic**（compute-centric）：性能上限最高，`register_texture` 支持成熟，但依赖 WebGPU compute；浏览器覆盖有限（Safari 18+ / Firefox 实验性）。
  - **`vello_hybrid`（sparse strips）**：官方定位「**production use-cases 的主力实现**」，CPU 做路径预处理、GPU 做合成，**带 WebGL backend**（`webgl` feature），并已支持 **external texture**（`set_paint` 集成外部纹理，#1824）。设备覆盖与可控性更好。
  - **`vello_cpu`**：纯 CPU、多线程 + SIMD，适合无 GPU/降级；API 是 `RenderContext + Pixmap`，**可以放进 Web Worker 离线栅格化瓦片**。
- sparse strips 本身就是「tiling + sorting + sparse strip」，与瓦片思路同源。

### 1.5 react-vello（`/tmp/react-vello`）

- 结构：`crates/rvello`（Rust/WASM，vello **0.6** + wgpu 26）、`packages/react-vello`（React reconciler + `BinaryWriter` op 编码 + `wasmBridge`）、`apps/web`（Next 演示）。
- 边界范式值得抄：JS 侧把一帧渲染编码成二进制 op 流，直接写进 **WASM 线性内存**，只把「长度」传过边界（`ops_reserve(required) -> Uint8Array`，`apply_and_render(length)`），避免逐调用跨界；带 `canvas2d` 软件回退；自带 hit-test / drag session。
- **不适合直接采用**：`renderContainer` 每次 rAF 都从 React 树重新编码**全量** op 并全量重渲染；没有 Scene 保留、没有 chunk/tile 缓存、没有 partial update、没有 LOD；vello 版本也旧。→ **只借鉴 encoder 与 React 集成方式，不借鉴渲染循环。**

---

## 2. 核心判断：vello 能否吃下 open-pencil 的瓦片策略

### 2.1 概念映射（不能 1:1 照搬）

| open-pencil（Skia） | vello 对应物 | 备注 |
|---|---|---|
| `SkPicture`（chunk 指令录制） | `vello::Scene`（保留的编码指令） | `append` 可 O(N) 合并；`Scene` 可 `Clone`/缓存。**这是 chunk 缓存最自然的映射** |
| `surface.makeImageSnapshot()`（瓦片位图） | `Renderer::render_to_texture` → `wgpu::Texture` → `register_texture` → `ImageData` | 必须 `Rgba8Unorm + STORAGE_BINDING + COPY_SRC`；`render_to_texture` 不清空 Scene，需显式 `Scene::reset` |
| `canvas.drawImageRect`（贴瓦片） | `Scene::draw_image(ImageBrush, Affine)` | 走 `image_overrides` GPU→GPU 零拷贝（mello 文档已拆解） |
| `TileSurfacePool` | 自己的 wgpu texture 池 + texture view 复用 | vello 无现成池 |
| `RenderChunkIndex` | 自建空间索引（块 bbox → chunk → tile 反查） | renderer 无关，pomelo 已有 block rect，直接可用 |
| `drawPicture` 单 pass 重放 | `Scene::append` 合并后**一次** `render_to_texture` | 见 2.2 的关键取舍 |
| `navigationActive` defer | 同款：导航/拖拽期间只贴旧瓦片 | 可直接照搬 |

### 2.2 关键取舍：Scene 合并 vs 瓦片位图

mello 的两份笔记各执一词，其实**两者解决的是不同问题，必须都做**：

- **chunk 级 Scene 缓存（保留指令）→ 单 pass `append` + 一次 render**
  - 优点：符合 vello「Scene 是命令不是像素」的设计；**merge 后跨 chunk 由 vello 统一 binning/AA，无瓦片缝、质量最好**；无中间纹理、无 `register_texture` 开销；实现最简。
  - 致命点：**每帧仍要重放整棵可见场景**（append + render）。稳态/首帧没问题，但**拖拽时仍然全量重光栅化**——正是 recut 现在的问题。所以它只能替代 open-pencil 的 layer 1（ScenePicture），**不能替代 layer 3（瓦片）**。
- **瓦片位图缓存 → 每帧只 blit**
  - 优点：稳态与交互帧 GPU 极省（拖拽只贴旧瓦片 + 活渲染被拖块，等价于现有 M1 快照但更细粒度、支持 LOD/overscan）。
  - 代价：N 个 `render_to_texture` pass、纹理显存、`register_texture` 管理、**瓦片边界 AA 缝**（mello 反复修的坑）、失效协议复杂。

**结论架构（推荐）——两级都要，顺序是先 Scene 后 tile：**

```
pomelo Block 变更(diff)
  └─ onBlockInvalidated(blockId, kind)          ← 复用现有 diff 结果（reposition vs render）
        ├─ ChunkSceneCache:  只重建受影响 chunk 的 vello::Scene（CPU 编码，便宜）
        └─ 标记相交 tile 为 stale（bounds 相交，同 open-pencil invalidateBounds）

每帧 (ticker update 相):
  1. TileScheduler.setGeneration(navGen, contentGen)   ← stale job 作废
  2. planTiles(visible(+overscan1))                    ← fresh 直接用，否则按优先级+EMA成本入队
  3. 若 navigationActive：defer 全部 job，只贴旧 tile（无旧 tile 的区块用 chunk Scene append 直绘兜底）
     否则：runFrame(预算 5ms / 最多 32 job)
            每个 job = 取相交 chunk Scene → append → render_to_texture(256×256) → register_texture → install
  4. drawVisibleTiles: Scene::draw_image(所有命中 tile)
  5. overlay（选区/手柄/箭头标签）每帧直绘，不进缓存
```

- **纯稳态**（无 tile 或小场景）：走「chunk Scene append + 单 pass」快捷路径，省掉瓦片。
- **交互/大场景**：瓦片路径接管。
- 这与 open-pencil 的 `planTiles(..., cachedOnly=navigationActive)` / `deferActiveJobs` 完全同构。

### 2.3 文本（最大风险）

open-pencil 用 CanvasKit Paragraph + FontMgr；pixi 的 Text 已经内置 CJK/回退/atlas。**vello 侧的 CJK 文本是全新栈**：`skrifa` 解析 + `Scene::draw_glyphs` / `glyph_run` + 自管字形图集与字体回退。`react-vello` 只带了 Space Grotesk 单字体，不能作为 CJK 方案。这是「重写文本栈」级别的工作，也是 mello 只做到 rect/circle、文本列为 TODO 的原因（`VELLO_RENDERER_IMPLEMENTATION.md` 已知限制）。**必须在 spike 里优先验证中文实体卡文本（混排、换行、缩放清晰度、导出确定性）。**

### 2.4 图像 / 媒体

World Canvas 有大量实体图（evidence → cover sprite）。vello classic 走 `register_texture`/ImageData（mello 已验证）；`vello_hybrid` 已支持 external texture（**WebGL2 后端尚不支持**）。图片相对 text 风险低。

### 2.5 关键判断：vello 的缓存是「drawcall/编码级」，不是 Skia 的「栅格级」

这是本报告要回答你直觉的核心，也是决定「能不能等量替换 Skia」的地方。

**Skia 的模型（open-pencil 的前提）**
- `SkPicture` = 录制的绘制指令；GPU 侧有 `GrDirectContext` / `SkSurface`，`drawPicture` 可被 GPU 高效重放；`makeImageSnapshot()` 产出 `SkImage`（底层就是 GPU texture）。
- 关键是：**「绘制到 surface 的任意子矩形」和「把一块 surface 内容取成纹理」都是一等公民且便宜**。所以 open-pencil 的两级缓存（SkPicture + 瓦片 Image）能自然成立。

**vello classic 的模型**
- `Scene` / `Encoding` 是 `path_tags` / `path_data` / `draw_tags` / `draw_data` / `transforms` / `styles` / `resources` 的**命令流**（mello 文档已拆解）。
- `Renderer::render_to_texture(scene, texture)` 每次调用都完整跑一遍：
  1. **CPU**：`render_encoding` 把命令解析成分箱（bins）、排序、生成 line/path buffer（这就是 vello 内部的分箱/瓦片）；
  2. **GPU**：coarse rasterize（compute，逐 bin）→ fine rasterize（compute，逐 tile）→ blend。
- **没有「GPU 保留的 replay」**：把 `Scene` 缓存下来再 render，省的是「你重新构造命令」的 CPU 成本，**光栅化一分不省**。`Scene` 渲染后还不清空（要显式 `Scene::reset`），正说明 vello 把 Scene 当「待渲染的命令流」，不是「已渲染产物」。
- `register_texture` 也不是「绑一张纹理进去」的零成本：vello 内部 `WriteImage` 遇到 override 时是 `copy_texture_to_texture`，把外部纹理**拷进 vello 自己的 image atlas**。用 `draw_image` 合成 N 张瓦片 = N 次 atlas 拷贝 + 一次全场景 render——**不是免费的 quad blit**。
- vello 内部确实有 tiling（classic 的 bins/coarse tile；sparse strips 的 4×4 tile + wide tile），但那是**单次 render 内的并行分箱**，没有公开的「只重渲这一块、其余保留」的 API。

**不同 vello 形态的缓存能力对比**

| 形态 | 保留的缓存单元 | 缓存它省什么 | 能否便宜复用像素 | 备注 |
|---|---|---|---|---|
| Skia（对照） | SkPicture + SkImage | 指令重放 + 栅格产物 | ✅ `drawPicture` / `makeImageSnapshot` | open-pencil 的前提 |
| vello classic | `vello::Scene`（编码） | 仅 CPU 命令编码 | ❌ 必须自己 `render_to_texture` 出纹理 | WebGPU compute，上限最高 |
| vello_hybrid / "Vello GPU" | `Scene`（CPU 预处理产物：flatten/tile/strip/paint） | CPU 预处理（最贵一段） | ❌ 目标纹理仍每帧重光栅 | 官方定位**生产主力**，带 WebGL 后端、external texture（WGPU） |
| vello_cpu | `RenderContext` + Pixmap（像素） | 全部 | ✅ 产物就是像素 | 可进 Worker 离线栅格，CPU 吞吐为限 |

**Vello 的仓库现状也印证了方向**（2026 上半年重构）：classic vello 被移到 `research/`，README 明确「**Vello GPU**（即 sparse strips / hybrid）heavy pre-processing on CPU、most work on GPU，aims to be the **main Vello implementation for production**」。也就是说，**官方自己承认"纯 compute 的一次性重放"不是生产形态**，生产形态是"CPU 预处理可保留 + GPU 只做光栅"。

**结论**：vello 的缓存粒度是**命令编码**，Skia 是**栅格产物**。这带来两个不可回避的事实：
1. open-pencil 的 **layer 1（ScenePicture 每帧重放）在 vello 里没有便宜对应**——`append` 合并后仍要整棵重光栅；
2. open-pencil 的 **layer 3（瓦片位图）必须完全自建**，且每 tile 一次完整 vello pass（含固定开销）+ `register_texture` 的 atlas copy，比 Skia 的「drawPicture 进子矩形 + snapshot」重得多。

### 2.6 已决策：vello-native 单栈（不做混用）

**决定**：不用 pixi。渲染、合成、overlay 全部收进 vello（WebGPU）世界。`VelloRendererAdapter` 整体替换 `PixiRendererAdapter`。

**被否决的「形态 B：vello 光栅 + pixi 合成」及原因**
- vello 是 WebGPU、pixi v7 是 WebGL2，**不能共享 GPU 纹理**，跨 API 只能「离屏 canvas → `ImageBitmap` → 上传」，读回/上传有成本且异步，瓦片更新频率一高就穿帮；
- 双栈意味着两套 block/文本/字体/交互栈长期并存，维护面翻倍；
- 结论：**收益被互操作成本吃掉，架构也更差。** 明确否决。

**vello-native 的渲染模型（all-vello）**

```
每帧（ticker update 相，单 WebGPU 上下文）:
  1. open-pencil 算法层决定「哪些 chunk/tile 变脏」（复用 pomelo diff: reposition vs render）
  2. 变脏的 chunk：重建其 vello::Scene（编码缓存在 WASM 侧，JS 只传变脏 chunk 的 op）
  3. 变脏的 tile：render_to_texture 到该 tile 纹理（256×256, Rgba8Unorm+STORAGE+COPY_SRC）
                  → register_texture 拿到 ImageData 句柄
  4. 合成：新建一个 composite Scene，对所有命中瓦片 Scene::draw_image(brush, tileTransform)
  5. renderer.render(compositeScene) → surface
  6. 导航/拖拽中：defer 步骤 2/3，只贴旧瓦片；被拖块 + 相连箭头作为「活 Scene」直接 append 进 composite
  7. overlay（选区/手柄/引导线）：独立 overlay Scene 每帧直绘（或见 §3.4 的 DOM 方案）
```

- 关键：**每帧的常规成本 = 一次 composite render（N 个 image quad）+ 少量 dirty tile 的 render_to_texture**，而非「整棵场景重光栅」——这正是 §2.5 结论要求的形态。
- `register_texture` 的 atlas copy 成本：命中瓦片每帧会被拷进 vello image atlas。N≈30 时可接受；若成为瓶颈，可在同一 wgpu 上下文内用自定义 blit pass 贴瓦片（仍是 vello 世界，不引入 pixi），或改用 `vello_hybrid` 的 external texture 路径。

**变体选择（vello 内部，不是双栈）**

| 选项 | 何时选 | 代价 |
|---|---|---|
| **vello classic**（WebGPU compute） | 上限优先、只支持 WebGPU 可接受 | `register_texture` 成熟、有 mello 先例；但设备覆盖窄，`render_to_texture` 固定开销 |
| **vello_hybrid / "Vello GPU"**（sparse strips；WGPU + WebGL2） | 需要设备覆盖/WebGL 降级、CPU 预处理可缓存 | 官方定位生产主力；external texture 仅 WGPU、WebGL2 不支持；API 较新 |
| vello_cpu（Worker 离线栅格 → 像素） | 无 GPU 降级、或想把瓦片栅格移出主线程 | CPU 吞吐为限；产物是像素，需上传/合成 |

- 建议：**主选 `vello_hybrid`（覆盖 + 生产定位 + CPU 预处理可保留）**，`classic` 作为性能上限对照；`vello_cpu + Worker` 作为降级/离主线程栅格的备选。三者都是 vello，不是双栈。
- ⚠️ 去掉 pixi 后**没有现成降级路径**：若目标浏览器无 WebGPU，必须靠 hybrid 的 WebGL 后端或 Canvas2D 软件回退（`react-vello` 的 software renderer 可借鉴其形状，但不能直接用）。这是 vello-native 必须正面解决的一条。

---

## 3. 建议架构：vello-native pomelo-vello-adapter

### 3.1 分层

```
world-canvas blocks (entity-card / media / note / relation-arrow)
        │  renderBlock() 产出 vello 绘制命令（append 进所属 chunk 的 vello::Scene）
        ▼
pomelo-core（vdom diff/patch / transact / block 双 record 数据纪律 —— 不变）
        │
        ▼
VelloRendererAdapter implements PomeloRendererAdapter   ← 整体替换 PixiRendererAdapter
   ├─ VelloElement implements IElement      容器节点（host/content/children，替代 PixiElement）
   ├─ VelloBlock extends PomeloBlock        renderBlock → vello 绘制（替代 PixiBlock）
   ├─ PomeloTiles（renderer 无关）          scheduler / planner / TileImageCache /
   │                                        generation 失效 / chunk 空间索引 / surface pool / EMA
   ├─ VelloRaster                            render_to_texture + register_texture + wgpu 资源池
   ├─ VelloCompositor                        composite Scene：draw_image 命中瓦片 + 活块 Scene
   └─ OpBridge                               JS 二进制 op → WASM（借鉴 react-vello 的 ops_reserve/apply_and_render）
```

**原则 1：算法层保持 renderer 无关。** `PomeloTiles`（scheduler/planner/cache/generation index）不 import vello，单独可测；它是 open-pencil 策略的直译，也是这次能真正落地的部分。

**原则 2：block 绘制是最大工程量。** `PomeloBlock` 的 `host/content/children` 已是 `IElement` 抽象，容器部分干净；但 4 个 world-canvas block 的 `renderBlock()` 目前返回 raw PIXI，**必须重写为 vello 绘制命令**（§3.3）。

**原则 3：交互/命中不依赖渲染器。** `RENDERING-NOTES.md` 已确认命中/选区/箭头几何全部走文档投影（`entityCardRect()` / attrs），与渲染树解耦。因此**命中、选区、拖拽判定可原样保留**，只有「画」要换。

### 3.2 JS↔WASM 边界

- 复用 react-vello 的模式：JS 把 **一个 chunk** 的绘制 op 编码进 WASM 线性内存（chunk 只在变脏时编码），WASM 侧解析进一个**保留的 `vello::Scene`** 并缓存；每帧只对脏 chunk 重建 Scene、对脏 tile 做 `render_to_texture`。
- 跨边界成本与「变脏 chunk 数」成正比，而非整场景——这正是 react-vello 缺的、open-pencil 有的那一步。
- 需要一个 **blockId → chunk → tile 的反查**（open-pencil `RenderChunkIndex` 直译）。pomelo patch 已经区分 `reposition()`（仅 x/y）与 `render()`（内容变），在 `PomeloRendererAdapter.handleBlockUpdate` / `render` 处把 `onBlockInvalidated(blockId, kind)` 广播给 `PomeloTiles` 即可，**不改数据纪律**。

### 3.3 Block 绘制迁移（all-vello 的核心工作）

新增 `VelloBlock`（对照 `PixiBlock`，但 `renderBlock()` 返回 vello 绘制命令 / 追加到 chunk Scene，而不是 `PIXI.Container`）：

- **entity-card-block**：圆角矩形底 + 描边 + cover 图（mask 圆角）+ 标题/正文 CJK 文本 + 属性行；
- **media-node-block**：图片/视频封面 + 边框（宽高比锁定逻辑保持不变）；
- **note-and-world-blocks**：便签/文本/世界根节点；
- **relation-arrow-block**：`arrow-geometry` 的二次贝塞尔 + 节点内虚线段 + 箭头 + label（已有纯几何函数，**直接复用，只需把输出喂给 vello path**）。

**文本是最大单项**：需要建 `skrifa` 字体解析 + 字形 shaping + 字形图集 + CJK 回退字体链（`vello` 的 `Scene::draw_glyphs` / `glyph_run`）。现有 pomelo rich-text 的**测量/换行**逻辑可能可复用，但**栅格化必须是 vello**。建议先只覆盖实体卡用到的有限排版（单/多行、截断、基本样式），不要一次做全富文本。

**图片**：实体图走 `register_texture`/`ImageData`（classic，mello 已验证）或 `vello_hybrid` external texture；图片加载/缓存可沿用现有 `canvas-image.ts` 的 URL 级缓存思路。

### 3.4 交互 overlay 与命中

选区框、四角 resize 手柄、「+」手柄、引导线、吸附指示圈目前是 `CanvasBindsPlugin` 里的 `PIXI.Graphics`，每帧屏幕空间直绘。vello-native 下二选一：

- **DOM/SVG overlay（推荐）**：这些元素本就是屏幕空间、量小、需要精确命中；用绝对定位的 DOM/SVG 覆盖在 canvas 上，避免重写一套 Graphics，也天然支持点击命中与可访问性。**这不是引入第二渲染栈**——DOM 不是 pixi。
- **vello overlay Scene**：单独一个 overlay Scene 每帧直绘，适合希望导出/预览与交互完全同源的场景，但要重写全部手柄绘制。

无论哪种，**命中逻辑仍在 JS 文档投影上**（不变）。建议先用 DOM/SVG overlay 快速追平交互，后续再评估是否并入 vello Scene。

### 3.5 导出 / Preview 一致性

vello-native 的额外收益：编辑与导出可共用同一套「chunk Scene → 合成」指令流（`preview == export` 的确定性目标更容易达成）。瓦片只是交互时的缓存，导出时可按需改为「直接渲染整场景一次」以保证像素无瓦片缝。

### 3.6 是否引入 react-vello 做「用户自定义组件」扩展？

**结论：不引入 react-vello 作为依赖；但要自建一个同形的「声明式场景 API」。**

react-vello 的实际扩展面（读码 `packages/react-vello/src/{index,components}.tsx`）：
- 公开 API 是**固定的 10 个 host 组件**（`Canvas/Group/Rect/Path/Text/Image/LinearGradient/RadialGradient/Mask/ClipPath`）；`HostType` 是封闭联合，`createInstance` 按固定类型建节点，**没有自定义 host 组件注册/插件机制**——用户的「自定义组件」只能是这些原语的 React 组合，扩展性有限。
- 它自持 `createVelloRoot(canvas)` → 自己的 WASM 实例、自己的 vello **0.6**、自己的 rAF **全量重编码**循环；**无法与你的 vello runtime 共用 device/Scene，也无法参与 chunk/tile 缓存**。
- 在渲染主循环里跑任意 React，与 recut 现有「组件在沙箱 iframe（html/react/r3f）+ `@recut/runtime`」的信任边界冲突。

因此不建议引入，原因：版本/实例重复（vello 0.6 vs 0.10/hybrid，两套 WASM）、封闭原语集、全量重编码破坏瓦片策略、沙箱/性能/内存边界不满足平台要求。

**建议（第一方扩展面）**：
1. **声明式场景 API（自建）**：用 `react-reconciler` 同形模式，作用于**你自己的 op IR / chunk 编码**，与 vello runtime 同版本、同 device、可缓存、可沙箱。用户在受限原语（rect/path/text/image/gradient/clip/mask）上组合，产出可被 chunk 化的 draw program。
2. **两个扩展面，边界清晰**：编辑器内部 block 走原生 tile-aware 路径；用户/自定义组件走声明式场景 API（要进场景、随画布 pan/zoom/导出）或既有 iframe 组件沙箱（只要 DOM 层）。**不要在主渲染循环里直接跑不可信 React。**
3. **性能纪律**：用户组件必须声明 chunk 归属与失效（内容变 → 只重建该 chunk / 相交瓦片）；不可信或重型组件渲染到独立纹理再合成，避免逐帧重编码拖垮瓦片策略。

若未来确实想要 React 书写体验，**把 react-vello 当参考实现抄 reconciler 模式，而不是当依赖**。

---

## 4. 风险清单与验证口径

| 风险 | 说明 | 缓解/验证 |
|---|---|---|
| WebGPU 覆盖（去掉 pixi 后无现成降级） | Safari 18+、Firefox 实验性；企业/旧设备不可用 | 主选 `vello_hybrid`（含 WebGL2 后端）；无 WebGPU 时用 Canvas2D 软件回退（形状参考 `react-vello` 的 software renderer，不可直接用）。**这是 vello-native 必须正面解决的一条** |
| CJK 文本 | 字体回退/图集/换行/缩放清晰度/导出确定性全新 | spike 第一优先项；先只覆盖实体卡有限排版；对照 pixi 截图 |
| WASM 体积/内存 | vello wasm + 字体资源；mello 未收敛此项 | 首屏与加载面规划；按需加载 |
| 瓦片缝 | mello 反复踩（gap/zoom/transform） | 瓦片渲染外扩 1~2px bleed；导出时改「整场景一次渲染」规避；e2e 像素级验证 |
| `render_to_texture` 成本 | 每 tile 一个 pass（classic 是 compute，有固定开销） | 只栅格化 dirty tile；导航期 defer；预算调度兜底 |
| `register_texture` atlas copy | 命中瓦片每帧被拷进 vello image atlas | N≈30 可接受；瓶颈时同上下文自定义 blit，或 hybrid external texture |
| 显存预算 | 瓦片 + chunk 缓存 | 照搬 128MB LRU + generation 失效；telemetry 暴露字节数 |
| Block/文本/交互重写 | 4 个 block + CJK 文本栈 + overlay 全部要重写/迁移 | 分阶段：spike 只做 entity-card；overlay 先用 DOM/SVG 追平 |
| 规模错配 | recut 当前数百实体，vello 甜点在万级+ | 架构建制已定；先用 spike 量化收益，控制首期迁移范围，不要一次全量 |

**验证口径**（沿用现有 RFC）：
- `PERF_HEADED=1 node scripts/e2e-world-canvas.mjs`：drag gaps=0、longtasks=0、无 page errors；
- DevTools 帧轨：**GPU 合成块 ≤3ms**、稳态无贴线红帧；
- `__pomeloPerf.summary()`：`frame.drift`≈0、`ticker.frame` 均值下降；
- 瓦片边界像素对照 + 文本截图对照无回归；
- **Preview == Export 确定性**：同一 Scene 两次渲染逐字节一致（vello 的优势项，应作为验收项）。

---

## 5. 分阶段建议（vello-native，带决策门）

- **M0（算法层，低风险）**：把 `rfc/2026-09-08-canvas-pixi-tiles-implementation.md` 的算法（`scheduler` / `planner` / `TileImageCache` 语义 / `generation` 失效 / surface pool / EMA 成本 / 5ms·32job 预算）抽成 **renderer 无关**的 `PomeloTiles`，配单元测试。可临时挂到现有 pixi adapter 做「行为正确性对照」，但**不作为交付形态，只是测试夹具**。
- **M1（spike A，1~2 周）**：`VelloRendererAdapter` 只渲染静态 World 子集（entity-card：圆角矩形 + cover 图 + **中文文本** + bezier/虚线箭头），验证 `VelloElement`/`VelloBlock`/OpBridge 通路。同时对比 **vello classic vs vello_hybrid**（API、设备覆盖、文本/图像支持）。**决策门**：① 中文文本达标；② 选定 variant（建议 hybrid 主选、classic 对照）；不过则停止 vello 方向、回退上游方案一（CanvasKit/Skia）。
- **M2（spike B，瓦片路径）**：接 `PomeloTiles`，实现 `render_to_texture` → `register_texture` → composite `draw_image`，以及 `navigationActive` defer。**决策门**：拖拽帧稳定 ≤3ms、无瓦片缝、atlas copy 不成为新瓶颈。
- **M3（交互与覆盖）**：overlay 用 DOM/SVG 追平（选区/手柄/引导线）；命中/选区/拖拽判定保留；迁移剩余 block（media/note/world/arrow label）。**决策门**：功能 e2e 全绿、`__pomeloPerf` 无回归。
- **M4（降级与交付）**：无 WebGPU 的软件回退（hybrid WebGL / Canvas2D）；导出走「整场景一次渲染」保证无瓦片缝；Preview==Export 确定性验收；此时再移除 pixi 依赖。

**范围控制**：不要一次全量迁移。首个可运行里程碑 = 「world-canvas 只读渲染 + 单实体拖拽」，其余编辑功能可在 DOM 层先行兜底。

---

## 6. 对三个来源的直接回答

- **open-pencil 的 tile 策略**：是 vello-native 的**地基**。其调度/缓存/失效/预算/导航 defer 与渲染器无关，直接移植为 `PomeloTiles`；但它「快」的一半来自 Skia 的**栅格级缓存**（SkPicture + `makeImageSnapshot`），vello 给不了等价物，因此瓦片位图路径在 vello 上**必须自建**（每 tile 一次完整 vello pass + atlas copy），这是 vello-native 的必需件。
- **vello**：**不是 Skia 的等量替换**，但决定作为**唯一渲染栈**直接改造。它是「drawcall/编码级缓存 + 单场景一次性光栅」的引擎，质量上限高、AA 无采样缝、确定性好；生产形态是 sparse strips 的 hybrid（"Vello GPU"）。用法是「chunk Scene 编码缓存 + 自持瓦片纹理 + composite Scene 合成」；不要背「每帧全场景重放」的包袱。用 ≥0.7（推荐 0.10），不要 fork；classic vs hybrid 在 M1 决策。
- **react-vello**：对**边界与 React 集成**有参考价值（二进制 op buffer、软件回退、hit-test），对**缓存/瓦片/性能架构没有帮助**，不可作为内核；其 software renderer 形状可作无 WebGPU 降级的参考。

---

## 附：证据索引

- open-pencil 瓦片源码（master）：
  - `packages/core/src/canvas/renderer/tiles/{geometry,cache,scheduler,planner,render,controller,surface-pool}.ts`
  - URL: `https://github.com/open-pencil/open-pencil/tree/master/packages/core/src/canvas/renderer/tiles`
- recut：
  - `rfc/2026-09-08-canvas-rendering-skia-vs-tiles.md`
  - `rfc/2026-09-08-canvas-pixi-tiles-implementation.md`
  - `web/app/worlds/[worldID]/canvas/RENDERING-NOTES.md`
  - `web/lib/pomelo/pomelo-core/pomelo-pixi/pomelo-pixi-adapter.ts`（demand flush + M1 快照）
  - `web/lib/pomelo/pomelo-core/pomelo-renderer/pomelo-renderer-adapter.ts`、`pomelo-block.tsx`
  - `web/lib/pomelo/pomelo-core/pomelo-pixi/pomelo-pixi-block.tsx`、`pomelo-pixi-element.ts`
  - `web/lib/pomelo/world-canvas/blocks/*`
- mello（`/Users/chenxuejia/ws/2026/morro/packages/mello`）：
  - `TILE_RENDERING_STRATEGY.md`、`VELLO_TILE_COMPOSITING_ANALYSIS.md`、`VELLO_INTEGRATION_PLAN.md`、`VELLO_RENDERER_IMPLEMENTATION.md`、`TILE_RENDERER_IMPLEMENTATION.md`、`TILE_GPU_COMPOSITING_EXPLAINED.md`、`TILE_PERFORMANCE_FIX.md`、`TILE_GAP_FIX.md`、`TILE_ZOOM_FIX.md`、`TILE_TRANSFORM_FIX.md`
  - `src/tile_renderer/tile_renderer.rs:328`（`if false` 关键证据）、`src/tile_renderer/tile_scheduler.rs`（`TILE_SIZE=512`）
  - `vello-main/`（vendored vello 0.5.0，自改 `register_texture`）
- react-vello（`/tmp/react-vello`）：
  - `AGENTS.md`、`packages/react-vello/src/{wasmBridge,runtime,encoder,binaryWriter}.ts`、`crates/rvello/{Cargo.toml,src/lib.rs}`
- vello 上游：
  - `https://github.com/linebender/vello`：仓库已重构，**classic vello 移至 `research/`**；README 明确三分：Vello（classic，实验）、Vello CPU（纯 CPU/SIMD）、**Vello GPU（即 hybrid/sparse strips，= 生产主力）**
  - CHANGELOG：`register_texture` / `unregister_texture` 于 **0.7.0（2026-01-13）公开**；0.10.0 为 2026-08-14 最新；wgpu 已到 v29
  - classic 渲染语义（bins/coarse/fine、Scene 不清空需 `reset`）：docs.rs `vello::Scene` / `Renderer::render_to_texture`
  - `register_texture` 的 override 是 `WriteImage` → `copy_texture_to_texture` 拷入 vello image atlas（非零成本引用）
  - vello_hybrid：CPU flatten/tile/strip + paint 编码，GPU 光栅；multi-atlas image cache；**external texture 支持 WGPU、WebGL2 后端尚不支持**（#1824，2026-08）
  - vello_cpu：`RenderContext` → `Pixmap`（像素），纯 CPU 多线程 + SIMD，可进 Worker
  - sparse strips 的 tile 是 4×4 像素（分析用）+ wide tile（coarse），属于**单次 render 内部**分箱，非跨帧保留
