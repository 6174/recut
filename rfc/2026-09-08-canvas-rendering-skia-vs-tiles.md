# World Canvas 渲染引擎升级：方案一（完整迁移 open-pencil Skia core）vs 方案二（保留 pixi v7 + 吸收其 tile 系统）

> 日期：2026-09-08
> 状态：提案（待评审）
> 背景：World 画布拖拽在 120Hz 显示器上贴帧线（主线程 ~7ms + GPU ~10ms/帧，见
> `web/app/worlds/[worldID]/canvas/RENDERING-NOTES.md` 问题 4），对标 open-pencil（接近 Figma 手感）。
> 研究材料：`/tmp/open-pencil`（MITlicensed，open-pencil.dev）

## 一、本质问题回顾

我们的 GPU 每帧都在「无状态光栅器」模式重放整棵渲染树：全画布 clear、逐卡 stencil 遮罩、
数千圆点阵网格几何、dpr2 全屏 fill-rate × 120fps。open-pencil/Figma 的不变式是
「**数据变才栅格化，帧到只合成**」——稳态帧 GPU 只做少量纹理 blit。

## 二、open-pencil 渲染引擎的现状梳理（实测读码结论）

其 core 渲染层 = `packages/scene-graph`（5.9k loc / 35 文件）+ `packages/core/src/canvas`（13.1k loc / 68 文件），
渲染器不是 Canvas2D，是 **CanvasKit（Skia WASM） WebGL Surface**。他人快而稳，靠四层还原缓存（自上而下）：

1. **ScenePicture（SkPicture 录制缓存）**：场景数据不变时整棵场景录成一次性指令流，每帧 `drawPicture` 重放，
   免渲染树遍历（`renderer/pipeline.ts` `canUseScenePicture`，以 `sceneVersion / fontGeneration / pageId` 多键判版本）。
2. **Retained backing（整层位图）**：场景整层栅格化到离屏 surface，正常帧直接贴图；
   带陈旧 zoom 预览（stale-zoom preview）：先糊着用，idle 后补一次清晰重栅格。
3. **TiledSceneController（瓦片系统，tiles/ 全家桶）**：
   - 固定设备像素瓦片 + `tileLevel(zoom*dpr)` 多 LOD 层级；
   - `RenderChunkIndex` 空间分块索引：块（chunk）→ 依赖节点反向索引，节点失效 → 只失效相交瓦片；
   - `RenderChunkPictureCache`：chunk 级 SkPicture 缓存（失效粒度 < 整场景）；
   - `TileScheduler`：**每帧 GPU 栅格预算 5ms / 最多 32 个 job**，超预算顺延；
   - `TileSurfacePool`：Surface 复用，防每瓦片分配抖动；瓦片字节预算遥测。
4. **拖拽 = positionPreview 机制**：改 x/y 只 `positionPreviewVersion++` 不动 `sceneVersion`
   （`scene-graph/preview.ts` 只对位置类变更解锁）；渲染层据此走「volatile 直接画」绕过 Picture 缓存，
   而瓦片场景在 `navigationActive`（pan/zoom/momentum）时**主动悬挂瓦片重栅格 job**（`deferActiveJobs`），
   留旧瓦片 + 全局 fallback 接管，帧循环结束才补栅格。拖拽不触发任何缓存全失效。

GUI 三层 `RenderLayer = 'full' | 'scene' | 'overlays'`：标签/选区/标尺 overlay 每帧直绘，
场景层只在版本变化时重栅格。

对标我们 pomelo：diff 已经算得出「哪个块、什么粒度变了」（`reposition()` vs `render()`），
但渲染终点是 pixi 全画布逐帧重放——**diff 结果没有被用于失效，只被用于重画**。

## 三、方案一：完整迁移 open-pencil core 到 pomelo

把 `scene-graph` + `core/src/canvas`（≈19k loc）迁入 `web/lib/pomelo`，pomelo 增一份 `SkiaRendererAdapter`
实现现有 adapter 接口（onInit / render / setTransform / setContainerSize / createIElement），
canvas-pomelo 组装时切换 adapter，`dev/demo-pencil` 路由验证。

**收益**
- 完整拿到三层缓存 + 瓦片调度 + 拖拽 positionPreview 全套，GPU 曲线直接追平；
- SkPicture 录制缓存、「先糊后清」stale preview 等机制一并到手；
- 渲染与导出同一指令流。

**代价与风险（不小）**
- 需连带维护 scene-graph（节点类型/几何/hit-test/vector-network/undo 契约）与 pomelo document 模型的**双镜像映射**；
  pomelo 的 transact → vdom diff → block 双 record 纪律需要一份「SceneGraph 投影层」，这是最大的复杂度源。
- 文本链路整体换轨：CanvasKit Paragraph + FontMgr + typeface provider，中文 CJK/回退字体/加载策略全部重做
  （我们现在 rich-text atlas 的中文文本管线不可复用）；
- canvaskit-wasm 运行时 ≈ 2-5MB wasm + 字体资源，首屏与加载面要规划；
- 所有 block 渲染代码重写为 Skia 绘制指令（每类一份），与现有 pixi 块渲染并存双轨期；
- Adapter 接口本身窄是好消息，但 editor 周边插件（命中/选区/箭头几何）要按 Skia 坐标系重校。

**结论**：收益上限最高，但这是一个「再产出半个编辑器渲染内核+重写一次文本栈」的工程，
量级 ~数周-数月，且给 pomelo 引入 wasm 重量依赖。适合在方案二已验证上限、仍达不到 Figma 级时再启动。

## 四、方案二：保留 pixi v7，把 tile 思想翻译过来（推荐）

不换引擎，把 open-pencil 的缓存层次结构逐层翻译成 pixi 原语：

| open-pencil 机制 | pixi v7 等价物 |
|---|---|
| SkPicture 场景录制 | 块级 `cacheAsBitmap` 由渲染器统一管理（按 blockId 失效），替代散用 |
| retailed backing 整层位图 | 拖拽会话开始将 ContentLayer 冻结为一张全屏 `RenderTexture` |
| TileImageCache + 多 LOD | 视口瓦片 `RenderTexture`（512 逻辑尺寸×dpr），LRU 预算 1.5× 视口 |
| RenderChunkIndex 反向依赖 | block attrs 已有 x/y/w/h，失效 = 世界矩形∩瓦片 → 只重栅格相交瓦片 |
| TileScheduler（5ms/帧 预算） | 挂 `PomeloTicker`（已就绪）：`schedule("tile:<id>")` 合帧 + 帧预算计数 |
| navigationActive 拖延瓦片 job | 拖拽/缩放会话暂停瓦片重栅格，引用旧瓦片（ сниз过采样） |
| positionPreview 位置类变更不失效内容 | pomelo 已天然具备（`reposition()` 不触发重建），只需失效协议接在 patch 处 |
| label/effect 缓存 | 箭头 label 纹理按文本哈希缓存（这里 pixi 比 Skia 更省事，纹理本身就在） |

**收益**：拖拽帧 GPU 从 ~10ms → 目标 2-3ms（瓦片 quad 提交 + 被拖块活渲染）；改动局部：
adapter 渲染循环 + 一个新 `TileLayer` 类 + CanvasBindsPlugin 会话协议两处接入点，现有数据纪律
（transact→diff→patch）、块渲染代码、插件全部不动。

**代价与风险**：
- pixi 没有干净的多瓦片 RenderTexture 管理经验库，显存预算和 LRU 要自己做（约 400-600 行）；
- `cacheAsBitmap` 内部失效语义粗（任意子属性变即重栅格），管理不好会退化成全帧重画——所以瓦片栅格
  必须走**显式失效协议**（TileStore 只认 diff 产生的 dirty rect），不能依赖 pixi 隐式失效；
- tile-level LOD（多 zoom 层级）pixi 版第一期不做：zoom 变化直接重栅格可见瓦片 + debounce，
  smooth 后再看要不要 LOD。

**里程碑**：
- M0（半天）：`dev/demo-pencil` 独立演示页——只移植其 `TiledSceneController + TileScheduler +
  SurfacePool` 的经典算法骨架，用 pixi Graphics 画假内容，验证「瓦片栅格预算+LRU」在 pixi 里的行为；
- M1（1-2 天）：拖拽会话全屏快照（上面说的两层形态），真实 World 画布上验收 GPU 曲线；
- M2（2-4 天）：把快照层升级为瓦片调度（失效协议 + 空间查询 + LRU）；
- M3：泛化全部 block、label 纹理缓存纳入、回归 e2e + RENDERING-NOTES 沉淀。

## 五、决策建议

**方案二起步，方案一留档**。理由：我们的性能问题 90% 来自「失效层缺失」而非引擎能力；
方案二两周内可验证到底，失败信号明确（M1 后 GPU 仍 >5ms 则重估方案一）；方案一在
pomelo≠scene-graph 的模型鸿沟上税费极高，且双渲染器并存期会放大维护面。

## 六、验证口径（两方案共用）

- `PERF_HEADED=1 node scripts/e2e-world-canvas.mjs`：drag gaps=0、longtasks=0、无 page errors；
- DevTools 帧轨截图对比：GPU 块 ≤3ms、不再出现贴 8.3ms 线的 7ms 红帧；
- `__pomeloPerf.summary()`：`frame.drift` count≈0、`ticker.frame` 均值下降；
- 视觉：canvas2d 截图对照无回归（瓦片边界无缝、文本清晰度不因 LOD 预览降级不可接受）。

## 七、不做什么

- 不替换为 Canvas2D 渲染器（WASM 换掉 WebGL 后 fill-rate 问题同样在瓦片层解决）；
- 不在方案二里做 multi-select 多元素拖拽优化（受影响集合问题留给瓦片调度天然覆盖）；
- 不引入 pixi v8（RenderGroup 路线清晰但生态迁移成本即刻付，先完成本 RFC 主线）。
