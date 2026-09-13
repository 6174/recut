# pomelo-vello-wasm

vello(WASM/WebGPU) 光栅器运行时，实现 `pomelo-vello` 的 `VelloRuntime` seam
（见 `rfc/2026-09-13-vello-native-rendering-implementation.md` §6/§7）。

## 状态

- ✅ 依赖与工具链验证通过：`vello 0.10` + `wgpu 29` 可在 `wasm32-unknown-unknown` 编译。
- ✅ `create_runtime(canvas)`：创建 wgpu surface/adapter/device + vello `Renderer`；`resize/width/height` 可用。
- ⏳ 待实现（M1）：`renderTile`（`render_to_texture` 到 256+bleed 纹理）、`present`（自建 instanced-quad 合成 pass）、
  chunk `Scene` 缓存、`register_texture`/外部纹理、字体 shaping（skrifa + CJK 回退）。
  接口契约见 `web/lib/pomelo/pomelo-vello/vello-rasterizer.ts` 的 `VelloRuntime`。

## 构建

```bash
wasm-pack build --target web --release
```

产物供 `VelloGpuRasterizer` 注入；未构建时 dev/e2e 使用 `Canvas2DRasterizer`。

## 关键 API 事实（已在 wgpu 29 / vello 0.10 验证）

- `wgpu::Instance::new(InstanceDescriptor { ..new_without_display_handle() })`（无 `Default`）。
- web surface：需直接依赖 `wgpu` 且启用 `webgpu` feature，`SurfaceTarget::Canvas(HtmlCanvasElement)` 才存在。
- `adapter.request_adapter(..).await?` 与 `adapter.request_device(&DeviceDescriptor).await?` 均返回 `Result`。
- `Renderer::new(&device, RendererOptions { antialiasing_support: AaSupport::area_only(), ..Default::default() })`。
- `Renderer::render_to_texture` 的目标纹理必须是 `Rgba8Unorm` + `STORAGE_BINDING`；surface 纹理不满足，
  需经中间纹理 + blit（这也是 RFC §2 决定自建合成 pass 的原因之一）。
