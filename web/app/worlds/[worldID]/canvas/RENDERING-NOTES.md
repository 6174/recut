# World Canvas 渲染性能研究与优化记录

> 研究对象：`web/lib/pomelo`（pomelo editor 底座 + pixi 渲染）与 `web/app/worlds/[worldID]/canvas`（世界画布）。
> 方法：不做猜测，全部用 Playwright + 自建性能记录器实测；每个结论都有数据。
> 工具沉淀：`web/scripts/e2e-world-canvas.mjs`（功能 e2e + 性能采样）、`window.__pomeloPerf`（运行时性能记录器）。

## 一、研究方法（可复用）

### 1. 性能记录器：`window.__pomeloPerf`（`web/lib/pomelo/pomelo-core/pomelo-perf.ts`）

底座统一埋点，控制台/脚本直接读取：

- **耗时统计**（count/avg/p50/p95/max，按名字聚合，环形采样 120 条）：
  - `transact` —— 每次文档事务（yjs 写入 + 事件派发）
  - `block.update` —— 每次文档更新后全量 `computeBlockState` 扫描 + 命中重渲染
  - `renderer.render` / `adapter.render` —— vdom createTree + diff + patch + layout
  - `block.render:<type>` —— 单个 Block 全量重建（容器重建 + 文本重栅格）
  - `overlay.draw` —— 选区/「+」手柄重绘
  - `text.refresh` —— 文字分辨率跟随缩放
- **帧率看门狗**：rAF 间隔 >32ms 记 `frame.gap`；`PerformanceObserver` 记 `longtask`
- **原始事件**：`__pomeloPerf.dump()` 返回最近 600 条（可导出 JSON 逐条回放）
- **API**：`report()`（打表）/ `summary()` / `reset()` / `setEnabled()`

### 2. e2e 验证脚本：`web/scripts/e2e-world-canvas.mjs`

```bash
cd web
node scripts/e2e-world-canvas.mjs            # headless（功能验证）
PERF_HEADED=1 node scripts/e2e-world-canvas.mjs  # 有头（真实 GPU，性能数据才可信）
```

覆盖：挂载/数据加载/readOnly、点击选中、图片加载（网络请求 + 真实 Sprite 数）、
拖拽位移持久化、拖拽帧间隔/longtask、「+」手柄拖出新关系确认、页面零报错 + 截图留档。

依赖 dev-only 调试句柄 `window.__worldCanvasDebug = { editor, store, rebuild }`
（`canvas-pomelo.tsx` 在 `NODE_ENV !== "production"` 时暴露）。

### 3. 踩过的验证坑（都真实发生过）

| 坑 | 教训 |
|---|---|
| `child.texture` 统计出 76 个「sprite」 | **PIXI v7 里 Text 继承 Sprite**——数纹理必须排除 `typeof child.text === "string"`，否则假阳性 |
| 网络请求 200 ≠ 显示成功 | 「asset content fetched」只证明下载，`sprite.mask` 没填充时图被全遮（见下） |
| headless 的性能数据不可信 | SwiftShader 软件渲染产生恒定 ~96ms longtask；性能断言必须 `PERF_HEADED=1` |
| 鼠标坐标点不到元素 | 屏幕坐标 = `world * scale + t + canvas.getBoundingClientRect()`，漏掉 rect 偏移会点到空处 |
| 选中后右侧面板展开 320px | 面板会遮住右侧画布，e2e 可见区要排除（x<1200）；面板展开后先 Esc 关闭再重试 |
| 历次测试拖动卡位漂移 | e2e 开始先 fit-to-content（`adapter.setTransform`），不依赖持久化位置 |
| 拖太快丢 hover | 「+」手柄拖拽要有驻留步（目标中心小步 + 60ms），失败 Esc 重试一次 |

## 二、问题定位过程与结论

### 问题 1：图片显示不出来（三层连环根因）

1. **PIXI.Assets 无法解析无扩展名 URL**：`/v1/media/assets/<id>/content` 没有后缀，
   console 警告 `could not be loaded as we don't know how to parse it`。
   → 改用 `Image` + `crossOrigin` 加载纹理（URL 级缓存，失败回 null，见 `canvas-theme.ts#loadPixiTexture`）。
2. **数据从未传给卡片**：真实画布组装 attrs 时 `cover: ""`、`photos: []`——实体图片证据
   （`entity.references` 中 `modality=image`）没有映射。→ `canvas-image.ts#entityImageUrls`
   解析为 URL（asset 行走 `${apiBase}/v1/media/assets/<id>/content`，url 行直连；
   primary/appearance 优先、排除 archived）。
3. **遮罩没填充**：`sprite.mask` 的 Graphics 只画了路径没 `beginFill`，宽高 0×0 → 图被全遮。
   → mask 必须 `beginFill/endFill`。

**教训**：每一层单独看都「合理」，必须逐层截图/探针验证到像素。

### 问题 2：拖拽「不跟手、延迟才追上鼠标」

排除法 + 逐层计时：

- **渲染不是瓶颈**：pixi GPU 绘制 idle 0.3ms / 拖拽 1.1ms（包装 `renderer.render` 实测）。
- **数据流不慢**：transact 0.1-0.2ms；`block.update` 0.9ms；vdom diff+patch 0.6ms；overlay 0.1ms。
- **move → 上屏**：平均 2.3ms（p50 1.8ms），远低于一帧 16ms——管道本身即时。
- **真正的浪费**：`BlockPatcher.updateBlock` 对任何 attrs 变化都执行
  `updateProps + render()` 全量重建 → 拖一张卡 = 每 move 重建整个卡片容器 + 重栅格文本
  （实测 `block.render:entity-card` ×40），绑定的箭头每次重画（`relation-arrow` ×80）。
- **另一个隐形坑**：拖拽中位置只写编辑器文档；任何中途 `dataVersion++` 的全量重建会用
  **store 旧位置**把卡片弹回去 →「不跟手、然后才追上」的体感。
  → 修复：拖拽/缩放会话维护 `CanvasBindsPlugin.liveGeometry`，`syncDocFromCanvasStore`
  全量重建时优先采用（`PERSIST_DEBOUNCE_MS + 200ms` 后清除）。

**最终修复（刻意不做的方案也值得记录）**：

- ❌ 曾实现「拖拽直改 pixi 属性 + 写穿 state.blockRecordMap」——在引擎基类绕过 yjs/状态写纪律，
  破坏 undo/协作/投影不变量，**已撤销**（`state.getBlockById` 返回的是 spread 投影副本，
  `block.record` 也是 renderer 副本，二者都非可变源，直接写=数据分叉）。
- ✅ 采用**引擎通用规则**：UPDATE patch 若只有 x/y 变化 → `reposition()`
  （O(1) 改内容容器位置），否则才 `render()` 全量重建。数据纪律完全不变
  （拖拽仍走正常 transact → yjs → diff），任意 Block 类型自动受益。

优化前后（每次 pointermove）：

| 指标 | 前 | 后 |
|---|---|---|
| 被拖卡片全量重建 | 每 move 1 次 | 0 次 |
| move → 上屏 | avg 2.3ms / max 25ms | avg 0.8ms / p50 0.2ms |
| 帧间隔（有头真实 GPU） | — | 0 掉帧 / 0 longtask |

### 问题 4：120Hz 显示器上拖拽偶尔隔帧掉一帧（统一 ticker）

mac ProMotion 120Hz 下每帧预算只有 **8.3ms**（不是 16.7ms）。DevTools「帧」轨显示主线程
~6.9-7.6ms/帧 + GPU 提交 → 贴线，偶发错过 vsync 就是截图里「漏掉的那个 frame」。

两步修复 + 一个新底座设施：

1. **pointermove 事件驱动渲染 → 合帧**：事件落在 vsync 窗口后半段时渲染完赶不上本次提交。
   拖拽先只记最新事件，帧首统一 apply（`editor.ticker.schedule("selection-drag", ...)`），
   pointerup 前 `flushAll` 语义补齐最后一次 move（提交位置=指针位置，不丢尾）。
   效果：多余重复渲染消失（主线程出现空闲段），但**单次渲染成本 ~7ms 本身**仍是瓶颈。
2. **统一帧驱动器 `PomeloTicker`（`pomelo-core/pomelo-ticker.ts`，挂 `editor.ticker`）**：
   - `add(fn, phase)`：常驻帧回调，phase 保证顺序 `input(拖拽 transact) → update → overlay`；
   - `schedule(key, fn)` / `cancel` / `flushAll`：合帧纪律——「事件写状态、帧才渲染」收进底座，
     插件不再各写 rAF（selection-plugin 已迁移；其余每帧任务后续逐个迁）;
   - 惰性驱动：有订阅者/任务才跑 rAF，空闲自停；随 editor.destroy 销毁（不做全局单例，避免多实例泄漏）；
   - 每帧 `pomeloPerf.record("ticker.frame", ...)`，可看每帧主线程成本与任务数。
3. **未竟事项**：6.9ms 单次渲染成本 = 拖一帧吃掉 84% 预算，GPU 余量不足。箭头 label 每 move
   重栅格、`block.update` O(N) 扫描、`refreshTextResolution` 全树遍历是已知大头（见下节），
   120Hz 顺滑需把每帧主线程压到 ~5ms 以下。

### 问题 3：readOnly 吞掉全部交互（「功能都丢了」的真相）

`CanvasBindsPlugin` 原有设计：readOnly 时不画「+」手柄、命中后不进入拖拽。
非 local 世界（`worldReadOnly`）readOnly=true →「能选中、不能拖、无 +」。
排查口诀：**先查状态位，再怀疑代码**。

### 其他定位记录

- **问题 5：adapter 级 demand flush + 拖拽会话快照（M1 已上线）**：
  1. **需求驱动 flush**：`autoStart:false`，`render()/setTransform/setContainerSize` 只置 `#dirty`；
     `editor.ticker` `update` 相统一 GPU 提交（`adapter.flush` 打点）。空闲零 GPU，每帧至多 1 次提交。
  2. **拖拽会话快照**：`PixiRendererAdapter.beginContentSession(excludedBlockIds)`——首次 pointermove
     时（插件传「被拖块 + 绑定箭头」），场景内容渲成一张全屏 RT（实测 alloc 0.1ms + raster 1.1ms@真实
     GPU），excluded 块放入还原世界变换的 LiveLayer 继续每帧重画；拖拽帧 GPU = 1 个快照 quad +
     LiveLayer 小范围。pointerup / 结构重建（validateSession 兜底，孤儿引用即回退全量路径）恢复。
     headless(SwiftShader) 下快照那帧是恒数百 ms 的 CPU 栅格化，性能不可信 → e2e 阈值按 PERF_HEADED 分档。
  3. e2e 还修了「历次拖动卡位漂移」：脚本先幂等网格化实体位置再 fit（bounds 只按实体卡算）。

- 选中区域和渲染错位：实体卡高度内容自适应（≥内容固有高度），但命中/选区/「+」手柄/箭头锚点
  读的是 attrs 存储尺寸（旧数据更小）。→ `entityCardRect()` 作为「有效渲染矩形」单一实现，
  命中/选区/连线几何（`arrow-geometry` 经 `setNodeRectResolver` 注册）共用。
- 引擎埋点引入的 bug：`const renderBlock = this.renderBlock` 丢 `this` → 所有 block 渲染抛错。
  包函数必须 `.bind(this)`。
- 背景色不一致：`PixiRendererAdapter` 硬编码 `backgroundColor: 0x0b0f19`；运行时设
  `background.alpha=0` 不生效 → adapter 增加构造选项 `transparentBackground`（init 时
  `backgroundAlpha: 0`），画布底色交给容器 CSS `var(--background)`。

## 三、架构事实备忘（读代码前先看这个）

- **渲染分层**：canvas-store（语义真相，zustand）→ `syncDocFromCanvasStore` 全量重建 pomelo 文档
  （内存投影）→ vdom diff/patch → PixiBlock.render。
  拖拽位移走 transact 直改文档（不触发全量重建）；结构变化才 `dataVersion++` 重建。
- **state 投影**：`editor.state.getBlockById/getAllBlocks` 每次返回 spread 副本；
  可变源是 `state.blockRecordMap`（正常写入只能走 `transact`，不要绕过）。
- **Block 双 record**：`block.record` 是 renderer 的副本，与 state record 非同一引用。
- **实体卡自尺寸**：渲染高度 = max(attrs.height, 内容固有高度)；有效矩形由 `entityCardRect()` 提供，
  命中/选区/箭头锚点必须共用它。
- **图片**：证据 → URL（`evidenceSource`）→ `Image`+crossOrigin → `PIXI.Texture`
  （URL 级缓存）→ cover-fit sprite + 已填充的圆角 mask。

## 四、遗留优化方向（未做）

- 箭头 label 文本在拖拽中每 move 重栅格：可缓存（文本未变则复用纹理）。
- 绑定箭头数量多的画布：`block.update` 全量扫描为 O(N)，可按依赖索引只扫受影响箭头。
- `refreshTextResolution` 在每次 render 时全量遍历容器树，可改为仅缩放时触发。
- e2e 首次拖拽偶发不生效（重试机制已兜底），根因未查。
