# World Canvas vello-native 渲染实施 RFC

> 日期：2026-09-13 ｜ 状态：实施提案 ｜ 前置调研：`rfc/2026-09-13-vello-tile-renderer-research.md`
> 目标：把 World Canvas 渲染层从 pixi v7 迁移到 **vello-native 单栈**（单 wgpu 上下文，vello 负责矢量光栅），并移植 open-pencil 的 production 瓦片系统。上线后可移除 pixi 依赖。
> 本文只写**落实方案**，不回述技术选型背景。文中「设计修正」是自审后对前序结论的调整，直接生效。

---

## 1. 最终架构

```
┌─ canvas-store（语义真相，zustand）────────────────────────────────┐
│  transact → yjs → doc update                                     │
└───────────────┬──────────────────────────────────────────────────┘
                ▼
┌─ pomelo-core（数据纪律不变）──────────────────────────────────────┐
│  PomeloRenderer → vdom diff → BlockPatcher.updateBlock           │
│    positionOnly → VelloBlock.reposition()                        │
│    否则        → VelloBlock.render()                             │
└───────────────┬──────────────────────────────────────────────────┘
                │ onBlockInvalidated(blockId, kind, prevBounds)
                ▼
┌─ PomeloTiles（TS，renderer 无关，open-pencil 直译）───────────────┐
│  chunk-index / planner / scheduler / tile-cache / telemetry      │
│  输入：viewport + navigationGeneration + contentGeneration       │
│  输出：本帧要执行的 tile job 列表 + 要贴的 tile 集合             │
└───────────────┬──────────────────────────────────────────────────┘
                │ 命令协议（op / job）
                ▼
┌─ VelloRuntime（Rust/WASM，独占 wgpu device）──────────────────────┐
│  ChunkStore     vello::Scene 缓存（局部坐标 + per-chunk affine）  │
│  Rasterizer     render_to_texture(tile, size+bleed)              │
│  TexturePool    wgpu texture 池 + LRU 字节预算                   │
│  Compositor     自建 wgpu instanced-quad pass：tile + live + bg  │
│  VelloElement / VelloBlock 桥（OpBridge：op 流 → Scene）         │
└───────────────┬──────────────────────────────────────────────────┘
                ▼
        WebGPU canvas（HTMLCanvasElement）
                ▲
┌─ Overlay（DOM/SVG，屏幕空间）─────────────────────────────────────┐
│  选区框 / 四角 resize / 「+」手柄 / 引导线 / 吸附指示 / zoom 常量元素 │
└───────────────────────────────────────────────────────────────────┘
```

**职责边界**
- pomelo-core 的数据纪律（transact / yjs / vdom diff / block 双 record）**完全不动**；只新增 `onBlockInvalidated` 广播。
- `PomeloTiles` 不 import vello，纯 TS，可单测；是 open-pencil 算法的逐模块移植。
- `VelloRuntime` 独占 wgpu device / surface / vello Renderer，JS 只持有不透明句柄。
- Overlay 是 DOM/SVG，不是第二渲染栈（DOM ≠ pixi）。

---

## 2. 关键设计决定（自审修正对照）

| # | 前序结论 / 直觉 | 修正后 | 原因 |
|---|---|---|---|
| 1 | 合成用 vello `Scene::draw_image` 贴瓦片 | **自建 wgpu instanced-quad 合成 pass** | `register_texture` 每帧把每张瓦片拷进 vello image atlas（`WriteImage → copy_texture_to_texture`），N 张瓦片 = N 次拷贝。自建 pass 直接采样瓦片纹理，稳态 1 个 draw call，零 atlas 拷贝。仍是 wgpu 单栈，非 pixi |
| 2 | chunk Scene 在合成时统一变换 | **chunk Scene 用局部坐标录制 + 独立 per-chunk world affine** | 位置变更（`reposition()`）只更新 affine，O(1)，不重编码；对应 open-pencil `positionPreview`。内容变更才重编码 |
| 3 | 瓦片按 tile bounds 精确裁剪渲染 | **瓦片渲染尺寸 = TileSize + 2×bleed（2px），合成只取内区** | vello 解析 AA 在 clip 边界可能产生 1px 覆盖率不闭合缝；bleed 保证跨瓦片边缘覆盖率互补 |
| 4 | zoom 常量元素也走瓦片 | **zoom-constant 元素（屏幕尺寸不随缩放变）进 Overlay/Live，不进瓦片** | 否则每次 zoom 都使瓦片失效，违背瓦片缓存目的 |
| 5 | 瓦片纹理交给 vello 管理 | **TexturePool 自管，`unregister_texture`/drop 显式释放** | 防 GPU 资源与 vello atlas 泄漏；显存预算有界 |
| 6 | 导出与编辑同一瓦片输出 | **导出复用瓦片管线（大图超 max texture 也靠瓦片），语义为「整场一次」；不承诺跨 GPU 逐字节一致** | 瓦片是无缝的合成缓存；确定性只保证同机同 GPU |
| 7 | 主选 vello_hybrid | **v1 用 vello classic（WebGPU compute）**，hybrid 作为 M4 的设备覆盖替代，经 `Rasterizer` seam 可换 | classic 的 `Scene::append` + `render_to_texture` 语义最确定，mello 已证；hybrid 的多 Scene 合成能力未验证，不适合放进 tile 内循环 |
| 8 | chunk 只是缓存单元 | **chunk 带 `atomic | interruptible` 标记** | 跨瓦片的效果（blur 等）不能切分，atomic chunk 整块渲到独立纹理再作为瓦片内容；v1 内部 block 全部 interruptible |
| 9 | 用户组件走 react-vello | **自建声明式场景 API（v1 只留 seam，不实现）** | react-vello 原语封闭、自持 vello 0.6 与全量重编码，无法接入瓦片缓存 |
| 10 | no-WebGPU 时保留 pixi | **v1 = WebGPU only；M4 提供 hybrid WebGL / Canvas2D 两套 `Rasterizer`** | `PomeloTiles` 与光栅器解耦，换光栅器即可降级，无需第二套渲染框架 |

---

## 3. 渲染主循环

挂在 `PomeloTicker` 的 `update` 相（现有 `add(fn, "update")`）；Overlay 在 `overlay` 相。

```
每帧 update 相：
  A. 读取 viewport {panX, panY, zoom} 与 generation
       contentGeneration   = 文档结构/内容版本（vdom 结构或 block 内容变更时 ++）
       navigationGeneration = 导航代（pan/zoom/momentum/settling 开始时 ++）
       navigationActive     = viewport 处于 pan/zoom/momentum/settling

  B. tiles.setGeneration(navigationGeneration, contentGeneration)
       丢弃 stale job（双代不匹配）

  C. tiles.applyPendingInvalidations()
       blockKind=content  → chunk Scene 重编码；相交 tile 删缓存
       blockKind=position → 仅更新 chunk affine；相交 tile 删缓存（旧位置/新位置都要）

  D. planTiles(viewport, level, overscan=1, cachedOnly=navigationActive)

  E. if navigationActive:
        不跑任何 tile job；贴旧瓦片（按当前 zoom 用 quad 变换缩放，stale-zoom 预览）
        coverage 缺失区域：用 chunk Scene 直绘兜底（单 Scene append + render）
     else:
        scheduler.runFrame(5ms / 32 jobs)：
          每个 job = rasterizeTile(tileKey) → TexturePool 取纹理 → 标记 ready

  F. liveLayer.render()：被拖块 + 相连箭头 → 独立 vello Scene → 小范围 RT
  G. warp/Composite：
        compositor.draw({ tiles: 命中瓦片(带 stale 缩放), live: liveTexture, background })
  H. telemetry.emit({jobs, overBudget, tileBytes, covered, pending})
```

**导航代推进时机**：Viewport 插件进入 pan/zoom 时 `navigationGeneration++`；动量/回弹结束回到 idle 时再 `++`。拖拽（不改 viewport）不推进 navGen，走 LiveLayer。

---

## 4. 瓦片算法移植（open-pencil → PomeloTiles）

> open-pencil 是目前唯一 production-ready 的参考实现，**逐模块、逐常量直译**，只改渲染后端。源码：`packages/core/src/canvas/renderer/tiles/*`。

### 4.1 模块与文件

| open-pencil 文件 | PomeloTiles 文件 | 职责 |
|---|---|---|
| `geometry.ts` | `pomelo-tiles/geometry.ts` | `TileKey` / `TileWorldBounds` / `tileLevel` / `tileWorldSize` / `tileKeysForWorldBounds` |
| `cache.ts` | `pomelo-tiles/tile-cache.ts` | 瓦片字节 LRU + generation 失效 |
| `planner.ts` | `pomelo-tiles/planner.ts` | 可见/overscan 规划、mandatory/visible 判定 |
| `scheduler.ts` | `pomelo-tiles/scheduler.ts` | 5ms 预算 / 32 job / 优先级 / 双代 / 成本 EMA |
| `surface-pool.ts` | `pomelo-tiles/surface-pool.ts` | wgpu texture 池（Rust 侧实现，TS 侧只持句柄） |
| `render.ts` | `pomelo-tiles/render.ts` | `renderTile`：取池 → 建 tile Scene → render → 入缓存 |
| `controller.ts` | `pomelo-tiles/controller.ts` | `renderFrame` 编排 + `navigationActive` defer + 失效应用 |
| `telemetry.ts` | `pomelo-tiles/telemetry.ts` | 指标（接 `pomeloPerf`） |
| `chunks/*` | `pomelo-tiles/chunk-index.ts` | block/chunk 空间索引 + 反查 |

### 4.2 常量（原值直译，不得改动）

```ts
const TILE_DEVICE_SIZE = 256;        // 设备像素
const TILE_LEVEL_STEP = 0.25;        // LOD 量化步长
const MIN_TILE_LEVEL  = 0.25 / 16;
const TILE_FRAME_BUDGET_MS = 5;      // 每帧光栅预算
const MAXIMUM_TILE_JOBS_PER_FRAME = 32;
const TILE_OVERSCAN = 1;             // 视口外 1 圈
const TILE_CACHE_MAX_BYTES = 128 * 1024 * 1024; // 128MB
const COST_EMA_OLD = 0.7, COST_EMA_NEW = 0.3;
```

### 4.3 语义直译要点

- **LOD**：`level = tileLevel(zoom * dpr)`；`tileWorldSize = 256 / level`。zoom 变化取最近 level，旧 level 瓦片标 stale 但不立即删（供 stale-zoom 预览），新 level 就绪后逐块替换。
- **缓存 key**：`${pageId}:${level}:${x}:${y}`；`pageId` = world canvas document id。
- **失效**：`advanceGeneration(gen)` 全量推进版本；`invalidateBounds(pageId, bounds, gen)` 只删与该世界矩形相交的瓦片。position 失效时同时用「旧 bounds + 新 bounds」失效。
- **planner**：`fresh = tile.contentGeneration === contentGeneration`；无 fresh 才入队；`priority = (有旧瓦片 || globalFallbackAvailable) ? 'visible' : 'mandatory'`，`fallbackAvailable` 同；**仅当可见瓦片无 job 时才规划 overscan**。
- **scheduler**：`mandatory = priority==='mandatory' && !fallbackAvailable`；`jobsExecuted>0 && elapsed>=budget` 即停；首个 job 超预算时仍执行（interruptible）并记 `deadlineOverrunMs`；stale job 丢弃并计数；`enqueue` 按 `identity = page:level:x:y:contentGen` 去重、按优先级排序。
- **成本**：`estimatedCost` 用 chunk 的几何复杂度启发式（path 段数 / 面积），执行后 `ema = 0.7*ema + 0.3*renderMs`。
- **navigationActive = pan | zoom | momentum | settling** → `deferActiveJobs`，只贴旧瓦片。
- **atomic chunk**：`chunk.atomic`（含跨瓦片效果）→ 整块先渲到独立纹理，再作为瓦片内容贴；普通 block `interruptible`。

### 4.4 vello 适配差异（唯一需要改后端的地方）

| open-pencil | PomeloTiles/vello |
|---|---|
| `SkPicture` 录制 | `vello::Scene`（chunk 局部坐标） |
| chunk `drawPicture` | `tileScene.append(chunkScene, Some(chunk.affine))` |
| `canvas.scale(level); translate(-bounds)` | `Scene::push_layer(Mix::Normal, 1.0, Affine::scale(level)*translate(-origin), clip)` |
| `surface.makeImageSnapshot()` | `Renderer::render_to_texture(tileScene, tileTexture(size+2*bleed))` |
| `drawImageRect(..., Linear, Src)` 贴瓦片 | 自建 wgpu instanced-quad pass，`Linear` 采样，`Src`/`SrcOver` 混合 |
| `pageColor` clear | compositor 的 background clear |
| `surfacePool.acquire/release` | TexturePool（wgpu），字节预算 + LRU |

**关键点**：vello 每次 `render_to_texture` 都会完整重跑该 Scene 的 CPU 编码 + GPU 光栅；因此**只有 dirty tile 才被执行**，这是整个瓦片策略存在的意义。不要幻想缓存 chunk Scene 能省光栅。

---

## 5. 失效协议

单一入口：`VelloBlock` 在 `render()` / `reposition()` 完成时调用 `tiles.onBlockInvalidated(blockId, kind)`。

```
kind = 'content'  → chunk 重编码（block 内所有绘制 op 重新生成 → WASM 覆盖该 chunk Scene）
                   → 相交 tile 失效（新旧 bounds 并集）
kind = 'position' → 只写 chunk.affine（x/y）；重编码 0
                   → 旧 bounds 与新 bounds 的相交 tile 失效
```

- 挂点：`pomelo-virtual.ts` 的 `BlockPatcher.updateBlock`（`positionOnly && !stateChanged → reposition()`，否则 `render()`）；`VelloBlock` 覆写这两个方法。
- 结构变更（CREATE/REMOVE/REPLACE）→ 重建 chunk-index 对应项；`contentGeneration++`。
- 导航不动内容：pan/zoom 只改 navGen，不使瓦片失效（只有 level 变化才产生新 level 瓦片）。
- `onBlockInvalidated` 汇总到帧首统一处理（合帧），避免一次 transact 多次失效。

---

## 6. Chunk 绘制与 op 编码

### 6.1 VelloElement / VelloBlock

- `VelloElement implements IElement`：轻量容器（children / parent / block），不复刻 PIXI 容器语义；真正的绘制在 chunk。
- `VelloBlock extends PomeloBlock`：`renderBlock()` 产出绘制 op（写入 JS 侧 op buffer），`reposition()` 写 affine。`hostElement/contentElement/childrenElement` 仍按 `IElement` 建，保证 pomelo 的 children/layout 机制不变。
- **chunk 归属**：v1 采用「block 子树 = chunk」，即每个顶层 renderable block 一个 chunk；小 block 可后续合并。LiveLayer 也是 chunk 集合。

### 6.2 op 词汇表（JS → WASM）

借鉴 react-vello 的「二进制 op 写进 WASM 线性内存」边界（`ops_reserve` / `apply_and_render`），但只在 chunk 变脏时编码：

```
Rect(x,y,w,h,radius,fill,stroke,strokeWidth)
Path(bezierSegments[], fill, stroke, dash, strokeWidth)
Line(p0,p1,stroke,width,dash)
Image(imageRef, dstRect, srcRect?, radiusMask?, opacity)
Text(text, fontId, box{maxWidth,align,lineHeight}, fill, opacity)   // shaping 在 Rust
Clip(path, children) / Group(opacity, children) / Mask(mask, children)
```

- 文本**不在 JS 测量**：只传字符串 + 字体 + 盒子 + 样式，Rust 侧 shaping/换行/字形绘制；需要截断/自适应高度时由 Rust 返回测量结果或 JS 用 `measureText` 预判（v1 允许 JS 粗测 + Rust 精排）。
- 图片：`imageRef` 指向已注册的 `ImageData`/外部纹理；图片位图不随 chunk 重编码，只登记引用。

### 6.3 文本（最大单项，独立工作流）

- 字体：复用 recut 自有 CDN 字体与 `FontFace` 加载；Rust 侧 `skrifa` 解析 + `FontData` 注册；CJK 需构建回退字体链（按 unicode 区间命中主字体 → 回退）。
- 绘制：vello `Scene::draw_glyphs` / `glyph_run`；字形图集由 vello 内部管理。
- 缓存：`fontId → FontData` 全局缓存；文本内容不变则 chunk 不重编码。
- 验收：中英混排、换行、截断、缩放清晰度、导出与预览一致。

### 6.4 图片 / 媒体

- 实体图走 `register_texture`/`ImageData`（v1，classic）；URL 级缓存沿用 `canvas-image.ts` 思路，在 Rust/JS 统一为 `imageRef`。
- 视频/媒体预览等不可栅格化内容不进 chunk，走 Overlay/独立媒体层（后续）。

---

## 7. GPU 资源与显存预算

- 瓦片纹理：`Rgba8Unorm` + `STORAGE_BINDING | TEXTURE_BINDING | COPY_SRC`（classic `render_to_texture` 要求）；尺寸 `(256+2*bleed)×(256+2*bleed)`。
- 池化：同尺寸纹理复用；释放归还池，不 `destroy`。
- 预算：瓦片缓存 ≈ 视口覆盖 × (1 + overscan 0.5 + LRU 邻域) × bytes；3200×1800@2x ≈ 25–30MB 常驻（与节点数无关）。chunk Scene 是 CPU/GPU 缓冲，成本随脏 chunk 数，非全量。
- 遥测：`tileCacheBytes / entries / ready/stale/rendering / allocationMs / drawMs / flushMs / overrunMs`，接 `pomeloPerf`。
- 生命周期：chunk 被替换/移除 → drop Scene + `unregister_texture` 对应 image；瓦片淘汰 → 归还池。

---

## 8. 交互 Overlay 与命中

- Overlay = DOM/SVG 层，绝对定位于 WebGPU canvas 之上；通过 `adapter.onTransformEvent` 同步 pan/zoom（屏幕坐标 = `world * scale + t`）。
- 内容：选区框、四角 resize 手柄、「+」手柄、引导草稿线、吸附指示圈、**zoom-constant 元素**。
- 命中/选区/箭头几何**保持 JS 文档投影**（`entityCardRect()` / attrs / `arrow-geometry`），完全不依赖渲染后端。
- 拖拽会话：`beginContentSession(excludedBlockIds)` 语义保留，但在 vello 下等价于 `LiveLayer.set(chunkIds)`；pointerup / 结构突变时 `LiveLayer.clear()`。

---

## 9. 导出 / Preview 一致性

- 共享同一份 chunk Scene 指令流；导出可切换为「整场一次渲染」：拼接所有 chunk → 单 Scene → `render_to_texture` 到目标尺寸（超 max texture 时按瓦片分块渲染再拼）。
- 保证：同一机器同一 GPU 上 preview 与 export 的绘制命令与 AA 一致；**不承诺跨设备逐字节一致**。
- 导出必须无瓦片缝：导出路径不使用瓦片缓存，直接整场/分块渲染。

---

## 10. 用户自定义组件扩展（seam，v1 不实现）

- 不引入 react-vello。预留**声明式场景 API**：用户组件产出 §6.2 的受限 op 词汇，编译为 chunk。
- 契约：组件声明 `chunkId` + `invalidate(deps)`；内容变只重建该 chunk/相交瓦片。重型/不可信组件渲染到独立纹理再合成（OpenPencil atomic 机制）。
- 两个扩展面：编辑器内部 block（原生、tile-aware）；用户组件（场景 API 进场景，或既有 iframe 沙箱走 DOM 层）。

---

## 11. 模块与文件清单

```
web/lib/pomelo/pomelo-core/
  pomelo-tiles/                     # 纯 TS，无 vello/pixi 依赖
    geometry.ts
    tile-cache.ts
    planner.ts
    scheduler.ts
    chunk-index.ts
    controller.ts                   # TileController.renderFrame
    surface-pool.ts                 # TS 侧句柄管理（实现在 Rust）
    telemetry.ts
    README.md
  pomelo-vello/
    pomelo-vello-adapter.ts         # implements PomeloRendererAdapter
    vello-element.ts                # implements IElement
    vello-block.ts                  # extends PomeloBlock
    op-bridge.ts                    # JS op buffer → WASM
    compositor.ts                   # wgpu instanced-quad pass 封装
    live-layer.ts
    README.md
web/lib/pomelo/pomelo-vello-wasm/   # Rust crate（wasm-bindgen）
  src/
    lib.rs                          # create_runtime(canvas) 等导出
    device.rs                       # wgpu device/surface
    chunk_store.rs                  # vello::Scene 缓存 + affine
    rasterizer.rs                   # render_to_texture(tile, size+bleed)
    texture_pool.rs
    compositor.rs                   # instanced-quad pass
    text.rs                         # skrifa shaping + font fallback
  Cargo.toml
web/lib/pomelo/world-canvas/blocks/ # 4 个 block 的 VelloBlock 版
```

---

## 12. 里程碑与决策门

- **M0 — 适配骨架（无瓦片）**：`VelloRuntime` 起 wgpu + vello；`VelloElement/VelloBlock/OpBridge` 通路；静态渲染 entity-card（圆角矩形 + 描边 + 图片 + **中文文本**）+ 一条贝塞尔箭头；单 Scene 渲染上屏。**门**：中文文本达标；确认 classic API 可用。
- **M1 — 瓦片系统**：移植 §4 全部模块；chunk Scene 缓存；`renderTile` + TexturePool；自建 compositor；`navigationActive` defer + stale-zoom 预览。**门**：拖拽帧 GPU ≤3ms；120Hz 无掉帧；瓦片边界无可见缝；显存 ≤30MB。
- **M2 — 失效与活层**：接 `onBlockInvalidated`；position O(1)；LiveLayer（被拖块 + 箭头）；Overlay DOM 追平选区/手柄/引导线。**门**：单实体拖拽 e2e 全绿；`__pomeloPerf` 无回归。
- **M3 — 全量 block 与媒体**：media/note/world/arrow-label 迁移；图片/字体缓存；用户组件 seam 预留。**门**：World Canvas 功能 e2e 全绿。
- **M4 — 降级与导出**：`Rasterizer` 实现 hybrid/WebGL 与 Canvas2D 两套；导出整场/分块；移除 pixi 依赖。**门**：无 WebGPU 环境可用；导出无瓦片缝、preview≈export。

---

## 13. 验收标准

- `PERF_HEADED=1 node scripts/e2e-world-canvas.mjs`：drag gaps=0、longtasks=0、无 page errors。
- DevTools 帧轨：拖拽/导航 GPU ≤3ms；稳态 1 个合成 draw call；无贴 8.3ms 线红帧。
- `__pomeloPerf.summary()`：`frame.drift`≈0；tile job 超预算 ≤ 阈值；`ticker.frame` 均值低于 pixi 基线。
- 像素：瓦片边界对照无接缝；文本清晰度不劣于 pixi；导出与预览一致。
- 显存：瓦片常驻 ≤30MB（3200×1800@2x 场景）；chunk 缓存字节有界。
- 依赖：World Canvas 不再 import `pixi.js`。

---

## 14. 已知限制与后续

- **vello classic 的 Scene 缓存不省光栅**——瓦片是唯一手段，已内建。
- **无 WebGPU 降级** v1 不覆盖，M4 用 hybrid WebGL / Canvas2D Rasterizer（算法层复用，仅换光栅器）。
- **atomic chunk 效果**（blur/滤镜）v1 仅保留机制，内部 block 不涉及。
- **大导出**超 max texture 依赖瓦片分块，M4 落地。
- **用户组件场景 API** 仅留 seam，不在 v1 范围。
