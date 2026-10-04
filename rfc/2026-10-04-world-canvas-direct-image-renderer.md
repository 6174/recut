# 世界画布：图像直采渲染（脱离 vello image atlas）

- 状态：Phase 0 已落地；Phase 1 进行中
- 日期：2026-10-04
- 范围：`web/lib/pomelo/pomelo-vello`、`web/lib/pomelo/pomelo-vello-wasm`、`web/lib/pomelo/pomelo-core/pomelo-tiles`

## 1. 背景与根因

世界画布用 vello(WASM/WebGPU) 渲染。direct 模式维护一张「保留场景底图」：内容不变时平移/缩放只贴底图，
覆盖不足或内容变化才重建。

vello 0.10 只有**一张持久 image atlas**（`MAX_ATLAS_SIZE = 8192`，硬编码、单张）。
`Renderer::register_texture` + `Scene::draw_image` 会把每张图拷进这张图集，且
`Resolver::resolve_pending_images` 要求**同一场景引用的所有图同时装进图集**，装不下的返回
`xy = None` 被**静默丢弃**。

由于以下两点叠加，缩小视野时出现「部分图片随机空白」：

1. direct 模式的一次性底图重建（`TileController` 的 `buildOneShot`）把**整场所有 chunk 塞进一个
   `Scene` 一次 resolve**；
2. 图片纹理档位此前「只升不降」：在高缩放看过一遍后，每张图停在 2048/4096。

实测：32 张大图在 200% 时共约 172M 像素；缩到 30% 整场可见，远超图集 67.1M 像素（8192²），
于是部分图片被丢弃，丢哪张取决于分配/淘汰顺序 → 表现为随机空白。

**结论**：atlas 是给字形/小件复用的，不适合承载大量独立大照片。这是架构错配，不是参数问题。

## 2. 目标架构

渲染器的真相是一份**按 z 序的绘制命令流**，图像是**独立 GPU 纹理**，由自建 compositor 直接采样绘制；
vello 只负责把**矢量/文字**光栅成层。atlas 回归小件，不再承载照片。

组件：

1. **DrawList（有序命令流）**：每份待渲染内容（底图/瓦片帧）产出一份有序列表，元素两类：
   - `VectorRun`：一串 vello op（形状/文字）；
   - `ImageQuad`：`{ textureId, worldQuad, clip:{rect,radius}, opacity, blend }`，由 compositor 直接画。
   z 序 = 列表顺序。
2. **分层合成器**：顺序遍历，累积连续 `VectorRun` 光栅成层，遇 `ImageQuad` 用 compositor 画。
   跨块 z 序天然正确。利用「内容不变只改变换」的底图缓存，把分层成本摊销到导航帧。
3. **图像纹理管理**：每图一张独立 wgpu 纹理（或池化），按显示尺寸选分辨率/mip；
   不再受单张 8192 上限约束。

## 3. 阶段计划

### Phase 0 —— 分批 resolve（已落地）

不引入新渲染路径，先把 direct 底图的一次性重建改成**分批**：复用既有
`begin_scene_backing` / `step_scene_backing`（每批一次独立 vello resolve + 累积到同一底图）。
图集只需容纳相邻 1~2 批的图，老批次的图按 stale 淘汰回收。

- 落地：`TileController.buildOneShot` 改走 `beginBacking` + 循环 `stepBacking`（失败回退单次构建）。
- 效果：200%→30% 随机空白消失；**不降分辨率**。

### Phase 1 —— 图像直采（进行中，关键重构）

把 `image` op 从 vello op 流中拆出，作为 `ImageQuad` 用 compositor 直采独立纹理。

任务拆解（每步可独立验证）：

1. **op 通道分离**：`RenderChunk.payload` 增加 `imageQuads`；`VelloBlock` 的 `image` op 在适配器
   `syncChunks` 中拆出（velloOps 不再含图像）。保持行为不变（先只建数据模型）。
2. **compositor 圆角裁切**：`compositor.rs` fragment shader 增加 rounded-rect SDF；
   `QuadDraw` 增加 `radius`。
3. **Rust 侧按序渲染**：`build_stream_scene` 遇 `ImageQuad` 时：flush 当前 vector Scene 到目标 →
   compositor 画 image quad → 继续。`chunk_scenes` 缓存按 (chunkId, runIndex) 切分。
4. **底图/瓦片/会话全部走 DrawList**；移除 `runtime.rs` 里图像走 atlas 的 `build_scene` image 分支。
5. **纹理管理**：独立纹理池 + 分辨率策略。

### Phase 2 —— 收敛

- 移除 vello atlas 承载图像的残留路径与相关兼容代码；
- 层/底图缓存与图像纹理生命周期统一；
- 性能与内存回归（大画布、多图、连续缩放）。

## 4. 兼容与风险

- 过渡期 vello 与 compositor 双路径并存，用开关隔离，保证任意一步可回退。
- 分层渲染的 pass 数上限与 GPU 预算需要压测（底图缓存使其只在内容/尺度变化时发生）。
- 圆角裁切从 vello clip 迁移到 compositor SDF，需对齐 AA 质量。

## 5. 验收

- 200%→30% 及反复往返：无随机空白、无分辨率回退。
- 大图工作流（≥32 张 2048/4096）：图集不再溢出。
- 拖拽含图块：内容会话可复用，无「被拖集合图片整片消失」。
- 平移/缩放单帧成本不劣化（底图缓存命中）。
