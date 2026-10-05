# 世界画布：图像直采渲染（脱离 vello image atlas）

- 状态：Phase 0 已落地；**Phase 1 已实现（`?cvperf=1` 门控，待真机验证）**
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

### Phase 1 —— 图像直采（已实现，`?cvperf=1` 门控）

把 `image` op 从 vello op 流中拆出，作为 `ImageQuad` 用 compositor 直采独立纹理。
开关：适配器读 URL `?cvperf=1`（或显式 `directImage` 选项）→ `gpu.setDirectImage(true)` →
wasm `set_direct_image(true)`。默认关闭，原路径行为不变。

实现落点（与拆解对应）：

1. **op 通道分离**：在 Rust `ops::split_runs` 内完成（不改 JS payload）：把 chunk 的 op 序列按
   `Image` 切成有序 `DrawRun`（`Vector` / `Image`），图像段携带所在圆角裁切盒；clip 跨图像时
   对矢量段做 close/reopen 使其自洽。z 序 = 段顺序。
2. **compositor 圆角裁切**：fragment shader 用**设备空间** rounded-rect SDF；`QuadDraw` 增加
   `radius` + `clip`（裁切盒可不同于目标矩形，复原 center-cover + 圆角裁切）。
3. **Rust 侧按序渲染**：`runtime::compose_direct` 遍历 chunk/run：矢量段经 vello 渲到复用的 layer
   纹理 → 与该段前的图像 quad 一起 compositor 提交；`run_scenes` 按 `(chunk key, runIndex)` 缓存。
4. **底图/整帧/导航直绘/拖拽会话全部走直采**：`build_scene_backing` / `begin+step_scene_backing`
   / `render_frame` / `render_direct` / `begin+render_content_session` 在直采模式下都改走
   `compose_direct`；照片不再进 atlas。拖拽内容会话因此对**含图块也安全启用**（静态快照与逐帧 live
   层各自 compose、互不共享 atlas），避免拖拽时每帧整场重建底图。
5. **纹理管理（基础版）**：每图一张独立 wgpu 纹理 + `TextureView` 直接采样；矢量层复用单张 layer
   纹理。**纹理池 / 分辨率降档 / mip 仍待补**（Phase 2）。

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
