# pomelo-vello-wasm

vello(WASM/WebGPU) 光栅器运行时，实现 `pomelo-vello` 的 `VelloRuntime` seam
（见 `rfc/2026-09-13-vello-native-rendering-implementation.md`）。

## 状态

- ✅ 依赖与工具链：`vello 0.10` + `wgpu 29` 在 `wasm32-unknown-unknown` 编译通过。
- ✅ `ops.rs`：JS op 字节流（小端记录流，见 `web/lib/pomelo/pomelo-vello/op-bridge.ts`）解码为
  `DrawOp` 并构建 `vello::Scene`；**host 单元测试通过**（`cargo test --lib`，3/3）。
- ✅ `runtime.rs`：`create_runtime(canvas)`（wgpu device + vello Renderer）、`resize`、
  `render_tile(ops, level, minX, minY)`（渲到 256×256 `Rgba8Unorm` 纹理并 `register_texture`）、
  `present(handles, panX, panY, zoom)`（合成 + `TextureBlitter` 上屏）、`dispose_tile`。
- ✅ **自建 wgpu quad 合成器**（`compositor.rs`）：每瓦片一个 32B uniform + bind group，draw 6 顶点采样瓦片纹理；
  不再经 vello `draw_image`/image atlas（正是 RFC §2 修正 1 的落地）。
- ✅ **文本**：`register_font(id, ttf)` + `ops.rs` TEXT op，skrifa 取 charmap/metrics 做按字符 advance 布局，
  vello `draw_glyphs` 绘制。测试字体 `assets/space-grotesk.ttf`（OFL）。GPU e2e 已验证拉丁字形渲染。
  ⚠️ CJK 走同一路径，但需**原始 TTF/OTF**（recut 现网是切片 woff2，skrifa 不支持 woff2，需补原始字体供给）。
- ✅ **图像**：`register_image(id, w, h, rgba)` + IMAGE op（vello `draw_image`）。
- ✅ **atomic chunk（跨瓦片效果）**：`atomic` chunk 经 `render_atomic_chunk` 整块渲到自己的纹理并注册为 image，
  各相交瓦片以 IMAGE op 引用；BLUR_RECT op 用 vello `draw_blurred_rounded_rect`。解决 blur 跨瓦片被裁出接缝。
- ✅ **CJK**：`set_font_fallback(primary, fallback)`；主字体缺字用回退字体（demo 用 Noto Sans CJK SC 子集，OFL）。
- ✅ **GPU e2e 16/16**：`node scripts/e2e-vello-gpu.mjs`（系统 Chrome + WebGPU）验证合成、跨瓦片无缝、
  平移不重光栅、拖拽只重渲相交瓦片、文本、CJK fallback、图像、atomic blur 跨瓦片无接缝。
- ⏳ 待实现：文本 shaping（skrifa + CJK 回退）、图片/媒体、atomic chunk 效果的独立纹理路径。

## 构建与同步

```bash
# 在 web/ 下
pnpm wasm:build:vello     # wasm-pack build --target web + 拷贝到 public/vello-wasm
```

产物 `public/vello-wasm/` 由 `.gitignore` 忽略（可重建）。dev 页 `/dev/vello-tiles` 在
`navigator.gpu` 可用时自动使用 vello 光栅器，否则回退 Canvas2D；`?rasterizer=canvas` 可强制回退。

## 关键 API 事实（wgpu 29 / vello 0.10 已验证）

- `wgpu::Instance::new(InstanceDescriptor { ..new_without_display_handle() })`（无 `Default`）。
- web surface：需直接依赖 `wgpu` 且启用 `webgpu` feature，`SurfaceTarget::Canvas(HtmlCanvasElement)` 才存在。
- `request_adapter(..).await?` / `request_device(&DeviceDescriptor).await?` 均返回 `Result`。
- `Surface::get_current_texture()` 返回枚举 `CurrentSurfaceTexture`（不是 `Result`）。
- `Renderer::render_to_texture` 目标须 `Rgba8Unorm` + `STORAGE_BINDING`；surface 需经中间纹理 + `TextureBlitter`。
- `Scene::draw_image` 接受 `impl Into<ImageBrushRef>`，`&ImageData` 可直接传入（避免 clone 语义问题）。
