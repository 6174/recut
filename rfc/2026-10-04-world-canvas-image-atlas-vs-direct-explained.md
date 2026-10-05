# 世界画布图像渲染：atlas 与 direct-image 两条策略（含 vello 底层机制）

> 配套：`rfc/2026-10-04-world-canvas-direct-image-renderer.md`（设计/排期）
> 姊妹篇：`rfc/2026-09-13-vello-rendering-explained.md`（讲底图/内容会话/瓦片三条「拍照省算」思路）
> 面向：不了解 vello 内部机制的读者。
> 目的：用尽量少的黑盒，讲清「atlas 策略」与「direct-image 策略」各自在做什么、为什么必须换。

---

## 0. 一句话总览

- **vello 是「矢量 + 文字」的光栅器**：它把一份绘制命令清单，在 GPU 上跑成一堆像素。
- **它对图像有一套自己的缓存机制——`image atlas`（图集）**：把所有用到的图片拼进**一张**大纹理再统一采样。
- **这套机制是为「字形 / 小图标 / 反复复用的小图」设计的**，天生不适合「几十张各自独立的大照片」。
- **atlas 策略**＝让照片也走图集 → 大照片一多就装不下，vello 会**静默丢图**（随机空白）。
- **direct-image 策略**＝照片不再进图集，**每张照片是独立 GPU 纹理**，由**自建 compositor 直接采样画上去**；vello 只负责矢量/文字那一层。

关键结论：**这不是调参问题，是「用错容器」的架构错配**。所以要把图像从 vello 的 op 流里拆出来，交给 compositor。

---

## 1. 先搞懂 vello 底层在干什么

### 1.1 一份 Scene = 一张「绘制命令清单」

调用方（我们的 wasm 封装）不直接调 GPU，而是往一个 `vello::Scene` 里**录命令**：

```rust
scene.fill(...)          // 填一个形状
scene.stroke(...)        // 描边
scene.draw_glyphs(...)   // 画一串字形
scene.draw_image(...)    // 画一张图
scene.push_clip_layer()  // 压入裁剪层
scene.draw_blurred_rounded_rect(...)
```

`Scene` 只是**记录**，还没有像素。它记录的是「按顺序对哪些图元做什么」。z 序就是录制顺序。

对应我们的代码：`ops.rs` 把 JS 传来的字节流解码成 `DrawOp`，再逐条录进 `Scene`（`draw_ops`）。

### 1.2 命令分成两大阵营

| 阵营 | 例子 | 谁来光栅 | 特点 |
|---|---|---|---|
| **矢量 / 文字 / 模糊** | 圆角矩形、连线、字形、blur | vello 的 compute 光栅管线 | 轮廓/曲线/抗锯齿，**贵**，但可任意缩放 |
| **图像（照片）** | 角色封面、场景图、缩略图 | 拷贝进 **atlas** 再采样 | 本质只是纹理，**贴起来便宜**，但受 atlas 约束 |

atlas 策略的所有麻烦，都出在第二行。

### 1.3 一次 `render_to_texture` 的完整流水线（简化）

```
        Scene（录好的命令清单）
              │
              ▼  ① encode：把命令翻译成 GPU 资源
      ┌───────────────────────────┐
      │ path/glyph  → 几何+覆盖   │
      │ image       → image patch │  ← 记下「这张图要出现在哪」
      └───────────────────────────┘
              │
              ▼  ② resolve / prepare
      ┌───────────────────────────┐
      │ 字形 → glyph atlas        │
      │ 图像 → image atlas        │  ← 把每张图「拷进」那张共享大图
      │        分配不到？→ xy=None │  ← ★ 静默丢弃，不报错
      └───────────────────────────┘
              │
              ▼  ③ raster：compute 管线做粗/细光栅（覆盖、AA）
              │
              ▼  ④ composite：采样 atlas / 输出
              │
              ▼
        目标纹理（我们的 tile / backing / 整帧）
```

**第 ② 步是全部问题的根源。** vello 0.10 的 `Renderer` 持有一张**持久化**的 image atlas，`register_texture` + `draw_image` 会让每张图在 resolve 阶段被拷进这张图集；`Resolver::resolve_pending_images` 要求**同一场景引用的所有图同时装进同一张图集**，装不下的返回 `xy = None`，然后在合成阶段被**静默跳过**。

### 1.4 image atlas 是什么、为什么存在

一句话：**把很多张图拼进一张大纹理，GPU 就可以少切纹理、少切绑定、多次复用同一份上传。**

- 对**字形**：一页文字里有成百上千个 glyph，但字形种类有限、且不同字号/文本反复用到。拼进 atlas 复用，收益巨大。
- 对**小图标 / 重复贴图**：同理。
- 代价：**全局一张、大小硬编码 `MAX_ATLAS_SIZE = 8192`**（8192×8192 = **67.1M 像素**），且**一个场景内所有图必须同时 resident**。

### 1.5 图集的三条硬约束（记住这三条就够了）

1. **只有一张**，硬上限 8192×8192。多开不了。
2. **同一场景内所有图必须同时装下**（resolve 一次绑定）。它不做「按需分页 / 流式换入」。
3. **装不下就静默丢**，不报错、不降级、界面无提示；丢哪张取决于分配 / 淘汰顺序 → 表现为**随机空白**。

---

## 2. 为什么图集会把照片画丢（完整因果链）

我们 direct 模式维护一张「保留场景底图」：内容不变时平移/缩放只贴底图；覆盖不足或内容变化才重建。重建的旧实现 `TileController.buildOneShot` 是：

> **把整场所有 chunk 塞进一个 `Scene`，一次 `render_to_texture` 完成。**

叠加两件事，就炸了：

1. **一次性放进整场**：缩小视野时整场可见的图全在同一场景 → 必须同时装进图集。
2. **分辨率只升不降**：在 200% 看过一遍后，每张图停在 2048/4096 档，**即使缩到 30% 也不降档**。

实测：32 张大图在 200% 时约 **172M 像素**，而图集只有 **67.1M 像素**。于是：

```
整场 172M 像素的图像
        ≫
图集 67.1M 像素（8192²）
        ↓
resolve 分配失败的那批 → xy = None
        ↓
合成阶段被静默跳过
        ↓
界面上「随机几张图空白」（丢哪张看分配顺序）
```

> 为什么「随机」？因为图集淘汰/分配顺序与遍历/时序相关，不稳定。同一份文档，缩放几次可能丢不同的图。

这就是 RFC 全文要解决的那个 bug。**根因不是「图太大」，是「照片不该进这个容器」。**

---

## 3. 策略 A：atlas 路径（现状 / 旧路径）

### 3.1 数据流

```
JS: ensureImage(url)
      │ 解码 + 按档位光栅成 RGBA
      ▼
runtime.register_image(id, w, h, rgba)
      │ device.create_texture(...)  → wgpu 纹理
      ▼
Renderer::register_texture(texture) → ImageData
      │ 存进 images: HashMap<id, ImageData>
      ▼
Scene::draw_image(image, transform)   ← 只记一条 image op
      │
      ▼  render_to_texture
   resolve: 把这张图拷进【共享 image atlas】
      │
      ▼  composite: 从 atlas 采样
```

### 3.2 一张图的「生命周期」都在 vello 手里

- 上传：`register_image` 建独立纹理（这一步其实已经很独立）。
- **登记**：`register_texture` 把它交给 vello 的资源表。
- **进图集**：真正 resolve 时被拷进 atlas —— 独立纹理只是「源」，atlas 才是被采样的「合并块」。
- **回收**：`unregister_texture(old)` / 图集淘汰。

### 3.3 一个真实的坑：图集是**全局可变状态**

`ops.rs::push_keepalive_image` 记录了另一个 atlas 反噬案例：

- 当某次 resolve 的场景**没有任何 image/glyph/gradient patch**（例如元素全移出视口的空底图），vello 会走 `resolve_solid_paths_only`，提前返回空 `Images`，渲染层据此把持久 atlas **缩成 1×1**。
- 但 `Resolver` 内部的 `ImageCache` 仍以为原图 resident、不会重传。
- 下一次带图场景把 atlas 重建回原尺寸时**却是空的** → 图片整片消失，直到换新 image id 才恢复。

修法：每个场景都追加一张 1×1 透明图（keepalive），**逼 vello 永远别把 atlas 缩回去**。

> 这个补丁本身就是信号：**atlas 是被多个场景共享、会被外部状态改写的全局缓存**。把照片放进去，就要替它的全局行为兜底。

### 3.4 atlas 策略什么时候是对的

- 图**小**、**多**、**反复复用**：字形、图标、徽章、同一张封面出现很多次。
- 图**同时在场数量少**：单张或几张。
- 不需要跨 block 精细控制 z 序。

### 3.5 代价 / 边界（照片场景）

| 问题 | 说明 |
|---|---|
| 单张 8192 上限 | 缩小时整场可见的图总和轻易超限 |
| 全场景同时 resident | 无分页/流式，几十张大图直接爆 |
| 静默丢图 | 不报错，用户看到随机空白，极难归因 |
| 全局可变 | 其它场景/空场景能改它的尺寸，产生跨场景串扰 |
| 分辨率只升不降反而加剧 | 高倍看过就常驻高档，缩小仍占图集 |

---

## 4. 策略 B：direct-image 路径（目标）

### 4.1 核心转变：把「真相」从 Scene 改成 DrawList

> **渲染器的真相是一份按 z 序的绘制命令流（DrawList）。**
> 图像不再是一种「vello op」，而是命令流里的一等元素。

DrawList 元素只有两类：

| 元素 | 内容 | 谁来画 |
|---|---|---|
| `VectorRun` | 一串 vello op（形状 / 文字 / 模糊） | vello |
| `ImageQuad` | `{ textureId, worldQuad, clip{rect,radius}, opacity, blend }` | 自建 compositor |

**列表顺序 = z 序。** 跨 chunk 的层级关系天然正确。

### 4.2 compositor 是什么

一个我们自己的、极小的 wgpu 渲染管线（`compositor.rs`）：

- 一个 quad 画 **6 个顶点**（两个三角形），顶点/uv 由 uniform 驱动。
- 每个纹理一个 bind group（纹理 + sampler + 目标矩形/uv/圆角参数）。
- fragment shader 里 `textureSample` **直接采样那张独立纹理**。
- 圆角：fragment 里用 **rounded-rect SDF** 算有符号距离，边缘 1px 做 AA（替代 vello 的 `pushClipRoundRect`）。
- 两套混合管线：
  - `straight`（`SrcAlpha/OneMinusSrcAlpha`）—— vello 渲出的层是**直通 alpha**；
  - `premultiplied`（`One/OneMinusSrcAlpha`）—— 经 compositor 累积的底图是**预乘 alpha**。
  - 按每个 draw 的 `premultiplied` 标记切换，避免半透明边缘二次预乘（白边/发白）。

一句话：**compositor 就是「贴图器」——把每张独立纹理按目标矩形贴到目标纹理上，不管图集。**

### 4.3 分层合成器：把两条路径缝合成正确的 z 序

顺序遍历 DrawList：

```
for element in drawList (z 序):
    if VectorRun:
        累积到「当前矢量层」           # 连续的矢量 op 攒一起
    if ImageQuad:
        flush 当前矢量层 → vello 光栅成一张层纹理
        compositor 画这个 image quad   # 直接采样独立纹理
        继续
最后 flush 剩余矢量层
```

- **连续的矢量** 才攒成一层（减少 vello 调用次数）。
- 遇到图像就「先落地矢量层，再贴图」，保证**图像和矢量互相压盖的 z 序正确**。
- 跨 chunk 的 z 序因为按列表顺序处理，天然正确。

### 4.4 图像纹理管理（脱离图集后的收益）

- 每图一张**独立 wgpu 纹理**（或池化复用）。
- **不受单张 8192 / 总量约束**：同时在场多少张、多大，只受显存预算。
- 按显示尺寸选分辨率 / mip；**可以降档**（缩小时换小纹理），不再「只升不降」。
- 不再需要 keepalive 1×1 这种「喂给图集」的补丁。

### 4.5 代价 / 边界

| 代价 | 说明 |
|---|---|
| 双路径 | vello 与 compositor 并存，需开关隔离、可回退 |
| 对齐 AA | 圆角裁切从 vello clip 迁到 SDF，需对齐抗锯齿质量 |
| pass 数 | 分层/贴图产生多次 render pass，需要压测 GPU 预算 |
| 状态切换 | 每张图一个 bind group，draw call 比图集多（换来的是不受限） |

---

## 5. 两策略对照表

| 维度 | 策略 A：atlas | 策略 B：direct-image |
|---|---|---|
| 图像本质 | 拷进**共享**大图集后采样 | 每图**独立**纹理，直接采样 |
| 上限 | 8192×8192，单张 | 仅受显存预算 |
| 同时在场 | **必须全装下**，否则静默丢 | 无此约束 |
| 丢图行为 | 有（`xy=None` 静默跳过） | 无 |
| 全局状态 | atlas 被多场景共享、可变 | 各纹理独立，无串扰 |
| 分辨率策略 | 只升不降（现状） | 可升可降 / mip |
| z 序 | 由 vello 统一处理 | compositor 按 DrawList 顺序 |
| 圆角裁切 | vello `pushClipRoundRect` | fragment SDF |
| AA | vello | vello（矢量）+ SDF（圆角） |
| 适合 | 字形、小图标、小图复用 | 大量独立大照片 |
| 复杂度 | 低（全交给 vello） | 高（自建 compositor + 分层） |

---

## 6. 过渡期：Phase 0 已落地，Phase 1 进行中

### 6.1 Phase 0（已落地）：分次 resolve 为什么能解决问题

> 一句话：把「一次 resolve 塞进整场所有图」改成「每次 resolve 只塞一小批图，再把各批的结果合成」——图集就只需要容纳**一小批**，而不是**整场**。

**旧做法**（`buildSceneBacking`）：整场所有 chunk → **一个** `Scene` → 一次 `render_to_texture`。这一次 resolve 里，vello 的 `Resolver` 必须把**整场引用的所有图同时**分配进那张唯一图集；装不下的返回 `xy=None`，静默丢。

**Phase 0 做法**（`controller.buildOneShot` → `runtime.rs::begin_scene_backing` + 循环 `step_scene_backing`）：

```
begin_scene_backing:
    target = 新建累积底图纹理（清透明）
    batch  = 新建可复用 batch 纹理
loop:
    取下一批 ≤ BACKING_BUILD_BATCH_CHUNKS(=6) 条 chunk 记录
    只为这一批构建 Scene → render_to_texture 到 batch 纹理   ← ★ 一次独立 resolve
    compositor 把 batch 纹理以 LoadOp::Load 累积（混合）进 target
until 流结束
    target 提交为新底图（旧的已提交底图在此之前一直可用）
```

**三个机制让图集不再溢出：**

1. **单次 resolve 的在图数从「整场」降到「一批」。** 约束从「所有图必须同时装下」变成「一批图必须同时装下」。一批只有 6 条 chunk，其图像像素总量远小于 67.1M，稳定放得下。
2. **老批次的图会被回收。** 一批渲完，它的 image patch 不再被下一批 resolve 引用；vello 图集按 stale 淘汰把这些槽位回收给新批次。于是在图工作集稳定在 ~1–2 批，**不随整场增长**。
3. **最终整场不是靠图集拼的。** 每批先渲成一张**普通独立纹理**（batch），再由我们的 compositor 合成；照片的「最终组装」全程不经过图集。

**附带好处：**

- 不必为塞进图集而**降分辨率** → 保住清晰度（正是验收要求的「无分辨率回退」）。
- 单次 GPU 工作量变小；`step_scene_backing` 每次只推进一个 batch（`MAX_BATCHES_PER_STEP=1`），把 GPU 负担分摊到多次 step / 多帧，避免单帧 spike（构建期间旧底图继续用于呈现）。

**为什么它只是缓解、不是根治：**

- 图集仍是照片的必经容器，仍受「单张 8192 / 全有全无」约束，只是把同时在场的规模压小。
- 若**单批**就超限（某个 chunk 自身含超多 / 超大图），依旧会丢；`6` 是经验值，不是结构性保证。
- 仍需 keepalive 1×1 兜住图集缩回、分辨率仍「只升不降」。
- 结构性根治是 Phase 1：照片走独立纹理 + compositor，图集退出照片路径。

### 6.2 Phase 1（进行中）：图像直采任务拆解

1. **op 通道分离**：`RenderChunk.payload` 增加 `imageQuads`；适配器 `syncChunks` 把 `image` op 从 vello op 流里拆出（velloOps 不再含图像）。**先只改数据模型，行为不变。**
2. **compositor 圆角**：shader 加 rounded-rect SDF，`QuadDraw` 加 `radius`。（**脚手架已落地，但调用点仍全传 `radius: 0`**）
3. **Rust 侧按序渲染**：`build_stream_scene` 遇 `ImageQuad` 时 flush 矢量 Scene → compositor 贴图 → 继续；`chunk_scenes` 缓存按 `(chunkId, runIndex)` 切分。
4. **底图/瓦片/会话全走 DrawList**；移除 `runtime.rs` 的 atlas image 分支。
5. **纹理池 + 分辨率策略**。

原则：**双路径并存、开关隔离，保证任意一步可回退。**

---

## 7. 常见疑惑 Q&A

**Q1：为什么不能直接调大 `MAX_ATLAS_SIZE`？**
A：它是 crate 内**硬编码常量**且**只有一张**。即使改大，也还是「一个场景所有图必须同时装下」的全有全无模型；照片总量随缩放无上限，永远会被追上。这是模型问题，不是数值问题。

**Q2：为什么不多开几张 atlas / 分页换入？**
A：vello 0.10 不提供这个能力；那等于我们自己在 vello 里重写一套纹理管理。与其如此，不如让图像走我们自己的 compositor（策略 B），边界清晰。

**Q3：为什么「分辨率只升不降」会把 bug 放大？**
A：图集占用 = Σ 每张图的像素数。只升不降意味着高倍浏览过的图会**永久**以 2048/4096 占着图集，缩小后本可以放下的整场，现在放不下。降档本身就缓解，但治标不治本。

**Q4：direct-image 会不会更慢？**
A：单看「贴一张图」，直接采样独立纹理比从 atlas 采样略贵（多切绑定）。但代价被抵消且反转：① 矢量层可缓存复用；② 不再整场塞单场景 resolve；③ 不再丢图导致的错误重建；④ 可降档省显存/带宽。底图缓存把分层成本摊到导航帧（见姊妹篇）。

**Q5：这和底图 / 内容会话 / 瓦片是什么关系？**
A：那是**「省算」的三条缓存思路**（拍照复用）。atlas vs direct-image 是**「图像怎么被采样」的底层路径**。两者正交：底图/会话这些缓存产出的内容，最终都要按策略 A 或 B 落到 GPU。direct-image 修的是「底层怎么贴图」，上层缓存照旧。

**Q6：atlas 是不是彻底不用了？**
A：不是。策略 B 后 **atlas 回归小件**（字形、小图标、小图复用），这正是它擅长的。被移出的只是「大照片」。

**Q7：圆角为什么不能在 compositor 里继续用 vello 的 clip？**
A：因为图像已经不走 vello 了。image quad 由 compositor 直接画，vello 的 `pushClipRoundRect` 作用不到它，所以在 fragment shader 里用 SDF 实现等价的圆角裁切 + 边缘 AA。

---

## 8. 名词 / 代码对照

| 名词 | 含义 | 在哪 |
|---|---|---|
| Scene | vello 的绘制命令清单（录制，不含像素） | `ops.rs::build_scene` / `build_chunk_scene` |
| DrawOp | 我们解码后的单条命令（含 `Image`） | `ops.rs::DrawOp` |
| image atlas | vello 持久化的**单张**共享图像图集 | vello 0.10 内部（`MAX_ATLAS_SIZE=8192`） |
| `register_texture` / `unregister_texture` | 注册 / 注销交给 vello 的图像 | `runtime.rs::register_image` / `register_atomic_chunk` |
| `draw_image` | 把图像作为一条 op 录进 Scene（会进图集） | `ops.rs::draw_ops` 的 `DrawOp::Image` 分支 |
| keepalive image | 每场景补一张 1×1 透明图，防 atlas 缩回 1×1 | `ops.rs::push_keepalive_image` |
| compositor | 自建 instanced/quad 贴图器（直接采样纹理） | `compositor.rs` |
| `QuadDraw` | 一次贴图：目标矩形 + uv + alpha 语义 + 圆角 | `compositor.rs::QuadDraw` |
| straight / premultiplied 管线 | 直通 / 预乘 alpha 两套混合 | `compositor.rs::new` |
| rounded-rect SDF | fragment 里算圆角裁切 + AA | `compositor.rs` 的 `fs_main` |
| DrawList（规划中） | 按 z 序的 `VectorRun` + `ImageQuad` 命令流 | RFC Phase 1 |
| scene_backing（底图） | 整场「照片」纹理（省算缓存） | `runtime.rs::build_scene_backing` |
| content_session（拖拽） | 静止照片 + live 块（省算缓存） | `runtime.rs::begin_content_session` |

---

## 9. 一张图看懂

```
┌──────────────── 策略 A：atlas（旧） ────────────────┐
│  照片 → register_texture → Scene.draw_image          │
│         → resolve 拷进【唯一 8192² 图集】(全装下?)   │
│         → 装不下：xy=None，静默丢 → 随机空白          │
└──────────────────────────────────────────────────────┘

┌──────────────── 策略 B：direct-image（目标） ────────┐
│  DrawList（z 序）                                    │
│   ├─ VectorRun ─► vello 光栅成层                      │
│   └─ ImageQuad ─► compositor 直接采样【独立纹理】      │
│  按顺序交错 → z 序正确；不受图集上限；可降档           │
└──────────────────────────────────────────────────────┘
```

> 记住一句：**图集是给字形和小件复用的；大照片走独立纹理 + compositor 直采。**
