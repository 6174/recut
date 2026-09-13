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
- ⚠️ **已知问题（待 M1 收口）**：多瓦片合成经 vello `draw_image` + image atlas 时，缓存瓦片表现为空
  （单瓦片 fresh 渲染正常，见 `scripts/e2e-vello-gpu.mjs` 的像素断言失败）。根因是 RFC §2 修正 1 指出的
  「`register_texture` 每帧拷入 atlas / 多纹理合成不可靠」。
  **修复方向：自建 wgpu instanced-quad 合成 pass（blit 瓦片纹理），不再经 vello draw_image。**
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
