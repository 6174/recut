//! 持有 wgpu 设备/队列/surface 与 vello Renderer，提供瓦片光栅（render_tile）与自建 quad 合成（present）。
//! 仅 wasm32 编译；op 解码与 Scene 构建在 `crate::ops`（host 可测）。
use std::collections::HashMap;
use std::sync::Arc;

use vello::kurbo::Affine;
use vello::peniko::{Blob, Color, FontData, ImageData};
use vello::wgpu::{
    self, Extent3d, LoadOp, Operations, RenderPassColorAttachment, RenderPassDescriptor, StoreOp, TextureDescriptor, TextureFormat, TextureUsages,
};
use vello::{AaConfig, AaSupport, RenderParams, Renderer, RendererOptions, Scene};
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

use crate::compositor::{Compositor, QuadDraw};
use crate::ops::{build_chunk_scene, build_scene, decode_ops, tile_transform};

const TILE_DEVICE_SIZE: u32 = 256;
const BLEED: f32 = 2.0;

struct TileEntry {
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
    min_x: f32,
    min_y: f32,
    level: f32,
    /// 纹理边长（含 bleed）
    tex_size: f32,
    /// 边缘外扩像素
    bleed: f32,
}

/// 拖拽内容会话：会话开始时把「静态 chunk（不含被拖块及随动箭头）」渲成一张保留全屏纹理；
/// 会话期间每帧只重渲 live chunk，再与静态快照合成上屏。避免 direct 模式逐帧重编码整场
/// （vello `resolve_patches` 的 glyph/blur patch 解析是按整场内容线性、每帧重来）。
struct ContentSession {
    /// 合成器句柄（静态快照全屏 quad）
    handle: u32,
    view: wgpu::TextureView,
    /// 显式持有纹理，保证其在会话期间存活
    _texture: wgpu::Texture,
}

/// 保留场景底图（对齐 open-pencil `sceneBacking`）：整场渲成一张按像素预算放大的纹理
/// （视口 × scale + margin）。内容不变时，平移/缩放只需按新 transform 贴这张纹理（单 quad、
/// 不再重编码整场）；覆盖不足或内容变化才重渲。是「永不空白/残缺」的兜底。
struct SceneBacking {
    handle: u32,
    view: wgpu::TextureView,
    _texture: wgpu::Texture,
    /// 渲染 backing 时的视口参数与尺寸（均为设备像素）
    pan_x: f32,
    pan_y: f32,
    zoom: f32,
    width: f32,
    height: f32,
}

/// 分帧构建中的底图：把 chunk 分批渲到 `batch` 纹理，再累积（LoadOp::Load）到 `target` 纹理。
/// 构建期间旧的已提交底图继续用于呈现，避免单帧 spike。
struct SceneBackingBuild {
    target_texture: wgpu::Texture,
    target_view: wgpu::TextureView,
    _batch_texture: wgpu::Texture,
    batch_view: wgpu::TextureView,
    batch_handle: u32,
    pan_x: f32,
    pan_y: f32,
    zoom: f32,
    width: f32,
    height: f32,
    stream: Vec<u8>,
    cursor: usize,
}

/// 单个 batch 覆盖的 chunk 记录数（每条 `[u64 key][u32 len][bytes]`）。
const BACKING_BUILD_BATCH_CHUNKS: usize = 6;

fn now_ms() -> f32 {
    js_sys::Date::now() as f32
}

/// 从 `cursor` 起取一个 batch 的字节范围 `(start, end)`；`end == stream.len()` 表示已到末尾。
fn next_batch_bounds(stream: &[u8], cursor: usize) -> (usize, usize) {
    let mut p = cursor;
    let mut count = 0usize;
    while p + 12 <= stream.len() && count < BACKING_BUILD_BATCH_CHUNKS {
        let len = u32::from_le_bytes(stream[p + 8..p + 12].try_into().unwrap()) as usize;
        p += 12 + len;
        if p > stream.len() {
            p = stream.len();
            break;
        }
        count += 1;
    }
    (cursor, p)
}

#[wasm_bindgen]
pub struct VelloRuntime {
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    renderer: Renderer,
    compositor: Compositor,
    tiles: HashMap<u32, TileEntry>,
    fonts: HashMap<u32, FontData>,
    fallbacks: HashMap<u32, u32>,
    images: HashMap<u32, ImageData>,
    chunk_scenes: HashMap<u64, Scene>,
    content_session: Option<ContentSession>,
    scene_backing: Option<SceneBacking>,
    scene_backing_build: Option<SceneBackingBuild>,
    next_handle: u32,
    clear: wgpu::Color,
    clear_color: Color,
}

#[wasm_bindgen]
impl VelloRuntime {
    pub(crate) async fn create(canvas: HtmlCanvasElement) -> Result<VelloRuntime, JsValue> {
        console_error_panic_hook::set_once();

        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(js_err)?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .map_err(js_err)?;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("pomelo-vello-device"),
                ..Default::default()
            })
            .await
            .map_err(js_err)?;

        let caps = surface.get_capabilities(&adapter);
        // 瓦片纹理为 Rgba8Unorm 且内容已是 sRGB 编码字节；选非 sRGB surface 直接写入，避免二次编码
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| !f.is_srgb())
            .or_else(|| caps.formats.first().copied())
            .ok_or_else(|| JsValue::from_str("surface has no supported format"))?;
        let alpha_mode = caps.alpha_modes.first().copied().unwrap_or(wgpu::CompositeAlphaMode::Auto);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: 1,
            height: 1,
            present_mode: wgpu::PresentMode::Fifo,
            alpha_mode,
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);

        let renderer = Renderer::new(
            &device,
            RendererOptions {
                antialiasing_support: AaSupport::area_only(),
                ..Default::default()
            },
        )
        .map_err(js_err)?;

        let compositor = Compositor::new(&device, format);

        Ok(VelloRuntime {
            device,
            queue,
            surface,
            config,
            renderer,
            compositor,
            tiles: HashMap::new(),
            fonts: HashMap::new(),
            fallbacks: HashMap::new(),
            images: HashMap::new(),
            chunk_scenes: HashMap::new(),
            content_session: None,
            scene_backing: None,
            scene_backing_build: None,
            next_handle: 1,
            clear: wgpu::Color { r: 11.0 / 255.0, g: 15.0 / 255.0, b: 25.0 / 255.0, a: 1.0 },
            clear_color: Color::from_rgba8(11, 15, 25, 255),
        })
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.config.width = width.max(1);
        self.config.height = height.max(1);
        self.surface.configure(&self.device, &self.config);
    }

    pub fn width(&self) -> u32 {
        self.config.width
    }

    pub fn height(&self) -> u32 {
        self.config.height
    }

    pub fn set_clear_color(&mut self, r: u8, g: u8, b: u8, a: u8) {
        let color = wgpu::Color { r: r as f64 / 255.0, g: g as f64 / 255.0, b: b as f64 / 255.0, a: a as f64 / 255.0 };
        self.clear = color;
        self.clear_color = Color::from_rgba8(r, g, b, a);
        self.compositor.set_clear(color);
    }

    /// 注册一张字体（font_id → 原始 TTF/OTF 字节）。TEXT op 通过 font_id 引用。
    pub fn register_font(&mut self, id: u32, bytes: Vec<u8>) {
        let blob = Blob::new(Arc::new(bytes));
        self.fonts.insert(id, FontData::new(blob, 0));
    }

    /// 设置字体回退：主字体缺字时用 fallback_id 对应字体绘制。
    pub fn set_font_fallback(&mut self, id: u32, fallback_id: u32) {
        self.fallbacks.insert(id, fallback_id);
    }

    /// atomic chunk：把整块 chunk 一次性渲到自己的纹理（世界 bounds × level），并注册为 image_id，
    /// 供各相交瓦片以 IMAGE op 引用。跨瓦片效果（如 gaussian blur）必须走此路径，避免被瓦片边界裁剪。
    #[allow(clippy::too_many_arguments)]
    pub fn render_atomic_chunk(
        &mut self,
        image_id: u32,
        ops: Vec<u8>,
        level: f32,
        min_x: f32,
        min_y: f32,
        width: u32,
        height: u32,
    ) -> Result<(), JsValue> {
        let width = width.max(1);
        let height = height.max(1);
        let decoded = decode_ops(&ops).map_err(|e| JsValue::from_str(&format!("decode ops: {e}")))?;
        let mut scene = Scene::new();
        let transform = tile_transform(level, min_x, min_y, 0.0);
        build_scene(&decoded, transform, width as f32, height as f32, &self.fonts, &self.fallbacks, &self.images, &mut scene);
        let texture = self.device.create_texture(&TextureDescriptor {
            label: Some("pomelo-vello-atomic"),
            size: Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: TextureFormat::Rgba8Unorm,
            usage: TextureUsages::STORAGE_BINDING | TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.renderer
            .render_to_texture(
                &self.device,
                &self.queue,
                &scene,
                &view,
                &RenderParams { base_color: Color::from_rgba8(0, 0, 0, 0), width, height, antialiasing_method: AaConfig::Area },
            )
            .map_err(js_err)?;
        let image = self.renderer.register_texture(texture);
        if let Some(old) = self.images.insert(image_id, image) {
            // 替换时注销旧纹理，避免 vello image atlas 泄漏/驱逐
            self.renderer.unregister_texture(old);
        }
        Ok(())
    }

    /// 注册一张图像（image_id → RGBA8 像素）。IMAGE op 通过 image_id 引用。
    pub fn register_image(&mut self, id: u32, width: u32, height: u32, rgba: Vec<u8>) -> Result<(), JsValue> {
        if width == 0 || height == 0 || rgba.len() < (width * height * 4) as usize {
            return Err(JsValue::from_str("register_image: invalid dimensions or data length"));
        }
        let texture = self.device.create_texture(&TextureDescriptor {
            label: Some("pomelo-vello-image"),
            size: Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: TextureFormat::Rgba8Unorm,
            usage: TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST | TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo { texture: &texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            &rgba,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(width * 4), rows_per_image: Some(height) },
            Extent3d { width, height, depth_or_array_layers: 1 },
        );
        let image = self.renderer.register_texture(texture);
        if let Some(old) = self.images.insert(id, image) {
            self.renderer.unregister_texture(old);
        }
        Ok(())
    }

    /// 把一个瓦片的绘制 op（世界坐标，可拼接多条 chunk 的记录流）光栅到 256×256 纹理。
    pub fn render_tile(&mut self, ops: Vec<u8>, level: f32, min_x: f32, min_y: f32) -> Result<u32, JsValue> {
        let decoded = decode_ops(&ops).map_err(|e| JsValue::from_str(&format!("decode ops: {e}")))?;
        // 含 bleed 的渲染边长；瓦片内容超出内区的部分供合成时线性采样，消除边缘缝/发虚
        let size = TILE_DEVICE_SIZE + (BLEED * 2.0) as u32;
        let mut scene = Scene::new();
        let transform = tile_transform(level, min_x, min_y, BLEED);
        build_scene(&decoded, transform, size as f32, size as f32, &self.fonts, &self.fallbacks, &self.images, &mut scene);

        let texture = self.device.create_texture(&TextureDescriptor {
            label: Some("pomelo-vello-tile"),
            size: Extent3d { width: size, height: size, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: TextureFormat::Rgba8Unorm,
            usage: TextureUsages::STORAGE_BINDING | TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.renderer
            .render_to_texture(
                &self.device,
                &self.queue,
                &scene,
                &view,
                &RenderParams {
                    base_color: Color::from_rgba8(0, 0, 0, 0),
                    width: size,
                    height: size,
                    antialiasing_method: AaConfig::Area,
                },
            )
            .map_err(js_err)?;

        let handle = self.next_handle;
        self.next_handle += 1;
        self.tiles.insert(handle, TileEntry { _texture: texture, view, min_x, min_y, level, tex_size: size as f32, bleed: BLEED });
        Ok(handle)
    }

    pub fn dispose_tile(&mut self, handle: u32) {
        self.compositor.dispose(handle);
        self.tiles.remove(&handle);
    }

    /// 合成命中瓦片并呈现到 surface。
    pub fn present(&mut self, handles: Vec<u32>, pan_x: f32, pan_y: f32, zoom: f32) -> Result<(), JsValue> {
        let draws: Vec<QuadDraw<'_>> = handles
            .iter()
            .filter_map(|handle| {
                self.tiles.get(handle).map(|tile| {
                    let scale = zoom / tile.level;
                    let sx = tile.min_x * zoom + pan_x;
                    let sy = tile.min_y * zoom + pan_y;
                    let size = (TILE_DEVICE_SIZE as f32) * scale;
                    let inner0 = tile.bleed / tile.tex_size;
                    let inner1 = (tile.bleed + TILE_DEVICE_SIZE as f32) / tile.tex_size;
                    QuadDraw { handle: *handle, view: &tile.view, rect: [sx, sy, size, size], uv: [inner0, inner0, inner1, inner1] }
                })
            })
            .collect();
        present_draws(&self.device, &self.queue, &self.surface, &self.config, &mut self.compositor, &draws)
    }

    /// 由 `[u64 key][u32 len][bytes...]` chunk 记录流构建一个 Scene：每个 chunk 命中缓存则复用
    /// 其 Scene（世界坐标），否则解码构建并缓存；统一按 `transform` 施加视口变换。
    fn build_stream_scene(&mut self, chunks: &[u8], transform: Affine) -> Result<Scene, JsValue> {
        let mut cursor = 0usize;
        let mut seen: Vec<u64> = Vec::new();
        let mut scene = Scene::new();
        while cursor + 12 <= chunks.len() {
            let key = u64::from_le_bytes(chunks[cursor..cursor + 8].try_into().unwrap());
            let len = u32::from_le_bytes(chunks[cursor + 8..cursor + 12].try_into().unwrap()) as usize;
            cursor += 12;
            if cursor + len > chunks.len() { break; }
            let ops = &chunks[cursor..cursor + len];
            cursor += len;
            seen.push(key);
            if !self.chunk_scenes.contains_key(&key) {
                let decoded = decode_ops(ops).map_err(|e| JsValue::from_str(&format!("decode ops: {e}")))?;
                let mut chunk_scene = Scene::new();
                // chunk 用世界坐标 + 单位变换录制；瓦片/视口变换在 append 时施加
                build_chunk_scene(&decoded, &self.fonts, &self.fallbacks, &self.images, &mut chunk_scene);
                if self.chunk_scenes.len() < 4096 {
                    self.chunk_scenes.insert(key, chunk_scene);
                } else {
                    scene.append(&chunk_scene, Some(transform));
                    continue;
                }
            }
            if let Some(chunk_scene) = self.chunk_scenes.get(&key) {
                scene.append(chunk_scene, Some(transform));
            }
        }
        // 清理本帧未出现的 chunk 缓存（简单 LRU：只保留最近使用）
        if self.chunk_scenes.len() > 2048 {
            let keep: std::collections::HashSet<u64> = seen.into_iter().collect();
            self.chunk_scenes.retain(|k, _| keep.contains(k));
        }
        Ok(scene)
    }

    /// 创建一张可供 vello 光栅（STORAGE_BINDING）的离屏纹理。
    fn create_render_texture(&self, width: u32, height: u32) -> (wgpu::Texture, wgpu::TextureView) {
        let texture = self.device.create_texture(&TextureDescriptor {
            label: Some("pomelo-vello-frame"),
            size: Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2,
            format: TextureFormat::Rgba8Unorm,
            usage: TextureUsages::STORAGE_BINDING | TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        (texture, view)
    }

    /// 把 Scene 光栅进已有 view（透明底）。
    fn render_scene_into(&mut self, view: &wgpu::TextureView, scene: &Scene, width: u32, height: u32) -> Result<(), JsValue> {
        self.renderer.render_to_texture(&self.device, &self.queue, scene, view, &RenderParams {
            base_color: Color::from_rgba8(0, 0, 0, 0), width, height, antialiasing_method: AaConfig::Area,
        }).map_err(js_err)?;
        Ok(())
    }

    /// 把 Scene 光栅到一张新的离屏纹理（透明底），返回纹理与其 view。
    fn render_scene_to_texture(&mut self, scene: &Scene, width: u32, height: u32) -> Result<(wgpu::Texture, wgpu::TextureView), JsValue> {
        let (texture, view) = self.create_render_texture(width, height);
        self.render_scene_into(&view, scene, width, height)?;
        Ok((texture, view))
    }

    /// 创建底图目标纹理（供 compositor 累积渲染 + 采样呈现）。
    /// 必须用 **surface 的 format**：compositor pipeline 的 target format 就是它，否则
    /// 往底图累积时 pipeline/attachment 格式不匹配，wgpu 会静默跳过该 pass（底图全空）。
    fn create_backing_target(&self, width: u32, height: u32) -> (wgpu::Texture, wgpu::TextureView) {
        let texture = self.device.create_texture(&TextureDescriptor {
            label: Some("pomelo-vello-backing"),
            size: Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2,
            format: self.config.format,
            usage: TextureUsages::RENDER_ATTACHMENT | TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        (texture, view)
    }

    /// 用 compositor 把 draws 累积渲染进 view（LoadOp::Load，不清屏）。
    fn accumulate_into_view(&mut self, view: &wgpu::TextureView, width: u32, height: u32, draws: &[QuadDraw<'_>]) -> Result<(), JsValue> {
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("pomelo-vello-backing-batch") });
        self.compositor.render(&self.device, &self.queue, &mut encoder, view, width, height, draws, true);
        self.queue.submit(Some(encoder.finish()));
        Ok(())
    }

    /// 把 view 清成透明（底图累积前使用）。
    fn clear_view_transparent(&self, view: &wgpu::TextureView) {
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("pomelo-vello-backing-clear") });
        {
            let _pass = encoder.begin_render_pass(&RenderPassDescriptor {
                label: Some("pomelo-vello-backing-clear-pass"),
                color_attachments: &[Some(RenderPassColorAttachment {
                    view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: Operations { load: LoadOp::Clear(wgpu::Color::TRANSPARENT), store: StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
        }
        self.queue.submit(Some(encoder.finish()));
    }

    /// 每帧整场渲染（open-pencil layer-1 思路）：命中缓存复用 chunk Scene，全部 append 进一个
    /// Scene，按视口变换一次渲染并整屏贴。入参 chunks 为 `[u64 key][u32 len][bytes...]` 记录流。
    pub fn render_frame(&mut self, chunks: Vec<u8>, pan_x: f32, pan_y: f32, zoom: f32, width: u32, height: u32) -> Result<(), JsValue> {
        let width = width.max(1);
        let height = height.max(1);
        let transform = Affine::translate((pan_x as f64, pan_y as f64)) * Affine::scale(zoom as f64);
        let scene = self.build_stream_scene(&chunks, transform)?;
        let (texture, view) = self.render_scene_to_texture(&scene, width, height)?;
        let handle = self.next_handle; self.next_handle += 1;
        let draw = QuadDraw { handle, view: &view, rect: [0.0, 0.0, width as f32, height as f32], uv: [0.0, 0.0, 1.0, 1.0] };
        present_draws(&self.device, &self.queue, &self.surface, &self.config, &mut self.compositor, &[draw])?;
        self.compositor.dispose(handle);
        drop(texture);
        Ok(())
    }

    /// 开启拖拽内容会话：把静态 chunk（不含被拖块及随动箭头，JS 侧已过滤）渲成一张保留全屏纹理。
    /// 会话期间不逐帧重编码静态内容，`resolve_patches` 不再按整场重复解析。
    pub fn begin_content_session(&mut self, chunks: Vec<u8>, pan_x: f32, pan_y: f32, zoom: f32, width: u32, height: u32) -> Result<(), JsValue> {
        self.end_content_session();
        let width = width.max(1);
        let height = height.max(1);
        let transform = Affine::translate((pan_x as f64, pan_y as f64)) * Affine::scale(zoom as f64);
        let scene = self.build_stream_scene(&chunks, transform)?;
        let (texture, view) = self.render_scene_to_texture(&scene, width, height)?;
        let handle = self.next_handle;
        self.next_handle += 1;
        self.content_session = Some(ContentSession { handle, view, _texture: texture });
        Ok(())
    }

    /// 会话帧：只重渲 live chunk，再与静态快照一起合成上屏（背景 clear + 快照 quad + live quad）。
    pub fn render_content_session(&mut self, live_chunks: Vec<u8>, pan_x: f32, pan_y: f32, zoom: f32, width: u32, height: u32) -> Result<(), JsValue> {
        let width = width.max(1);
        let height = height.max(1);
        let transform = Affine::translate((pan_x as f64, pan_y as f64)) * Affine::scale(zoom as f64);
        let live_scene = self.build_stream_scene(&live_chunks, transform)?;
        let (live_texture, live_view) = self.render_scene_to_texture(&live_scene, width, height)?;
        let live_handle = self.next_handle;
        self.next_handle += 1;
        let session = match self.content_session.as_ref() {
            Some(session) => session,
            None => return Err(JsValue::from_str("render_content_session: no active content session")),
        };
        let rect = [0.0f32, 0.0f32, width as f32, height as f32];
        let uv = [0.0f32, 0.0f32, 1.0f32, 1.0f32];
        let draws = [
            QuadDraw { handle: session.handle, view: &session.view, rect, uv },
            QuadDraw { handle: live_handle, view: &live_view, rect, uv },
        ];
        present_draws(&self.device, &self.queue, &self.surface, &self.config, &mut self.compositor, &draws)?;
        self.compositor.dispose(live_handle);
        drop(live_texture);
        Ok(())
    }

    /// 结束内容会话并释放静态快照纹理与其合成绑定。
    pub fn end_content_session(&mut self) {
        if let Some(session) = self.content_session.take() {
            self.compositor.dispose(session.handle);
        }
    }

    /// 构建保留场景底图：把整场按 `(pan/zoom)` 渲到一张 `width×height`（设备像素）纹理并保留。
    /// JS 侧按像素预算算好 backingViewport（视口 × scale + margin）后调用。
    pub fn build_scene_backing(&mut self, chunks: Vec<u8>, pan_x: f32, pan_y: f32, zoom: f32, width: u32, height: u32) -> Result<(), JsValue> {
        self.end_scene_backing();
        let width = width.max(1);
        let height = height.max(1);
        let transform = Affine::translate((pan_x as f64, pan_y as f64)) * Affine::scale(zoom as f64);
        let scene = self.build_stream_scene(&chunks, transform)?;
        let (texture, view) = self.render_scene_to_texture(&scene, width, height)?;
        let handle = self.next_handle;
        self.next_handle += 1;
        self.scene_backing = Some(SceneBacking { handle, view, _texture: texture, pan_x, pan_y, zoom, width: width as f32, height: height as f32 });
        Ok(())
    }

    /// 用底图呈现当前视口：按新 transform 贴 backing 纹理（单 quad，不重编码）。
    /// `allow_stale_zoom` 为 true 时（导航中）只要底图屏幕矩形仍覆盖视口就贴（允许缩放发虚）；
    /// 为 false 时要求 zoom 一致且世界矩形包含视口（crisp，否则返回 false 让调用方重渲）。
    pub fn present_backing(&mut self, pan_x: f32, pan_y: f32, zoom: f32, width: u32, height: u32, allow_stale_zoom: bool) -> Result<bool, JsValue> {
        let backing = match self.scene_backing.as_ref() {
            Some(backing) => backing,
            None => return Ok(false),
        };
        let w = width.max(1) as f32;
        let h = height.max(1) as f32;
        let scale = zoom / backing.zoom;
        let sx = pan_x - backing.pan_x * scale;
        let sy = pan_y - backing.pan_y * scale;
        let sw = backing.width * scale;
        let sh = backing.height * scale;
        let zoom_match = (zoom - backing.zoom).abs() <= 1e-4;
        let world_covers = {
            let bx0 = -backing.pan_x / backing.zoom;
            let by0 = -backing.pan_y / backing.zoom;
            let bx1 = (-backing.pan_x + backing.width) / backing.zoom;
            let by1 = (-backing.pan_y + backing.height) / backing.zoom;
            let lx0 = -pan_x / zoom;
            let ly0 = -pan_y / zoom;
            let lx1 = (-pan_x + w) / zoom;
            let ly1 = (-pan_y + h) / zoom;
            lx0 >= bx0 && ly0 >= by0 && lx1 <= bx1 && ly1 <= by1
        };
        let screen_covers = sx <= 0.0 && sy <= 0.0 && sx + sw >= w && sy + sh >= h;
        let covered = (zoom_match && world_covers) || (allow_stale_zoom && screen_covers);
        if !covered {
            return Ok(false);
        }
        let draw = QuadDraw { handle: backing.handle, view: &backing.view, rect: [sx, sy, sw, sh], uv: [0.0, 0.0, 1.0, 1.0] };
        present_draws(&self.device, &self.queue, &self.surface, &self.config, &mut self.compositor, &[draw])?;
        Ok(true)
    }

    /// 开始分帧构建底图：新建累积目标 + 复用 batch 纹理；**保留已提交底图**（构建期间继续用于呈现）。
    pub fn begin_scene_backing(&mut self, chunks: Vec<u8>, pan_x: f32, pan_y: f32, zoom: f32, width: u32, height: u32) -> Result<(), JsValue> {
        self.cancel_scene_backing_build();
        let width = width.max(1);
        let height = height.max(1);
        let (target_texture, target_view) = self.create_backing_target(width, height);
        self.clear_view_transparent(&target_view);
        let (batch_texture, batch_view) = self.create_render_texture(width, height);
        let batch_handle = self.next_handle;
        self.next_handle += 1;
        self.scene_backing_build = Some(SceneBackingBuild {
            target_texture,
            target_view,
            _batch_texture: batch_texture,
            batch_view,
            batch_handle,
            pan_x,
            pan_y,
            zoom,
            width: width as f32,
            height: height as f32,
            stream: chunks,
            cursor: 0,
        });
        Ok(())
    }

    /// 分帧推进底图构建：在 `budget_ms` 内尽量多渲几个 batch；返回是否构建完成。
    /// 完成时把新底图提交（替换旧的），旧的已提交底图在此之前一直可用。
    pub fn step_scene_backing(&mut self, budget_ms: f32) -> Result<bool, JsValue> {
        let started = now_ms();
        let mut build = match self.scene_backing_build.take() {
            Some(build) => build,
            None => return Ok(true),
        };
        let total = build.stream.len();
        // 每帧最多推进的 batch 数：vello 单个 batch 是一次整幅离屏渲染（GPU 排队），
        // 靠 wall-clock CPU 预算无法限制 GPU 工作，故用硬上限把 GPU 分摊到多帧。
        const MAX_BATCHES_PER_STEP: usize = 1;
        let mut batches = 0usize;
        let result: Result<bool, JsValue> = loop {
            let (batch_start, batch_end) = next_batch_bounds(&build.stream, build.cursor);
            if batch_start < batch_end {
                let transform = Affine::translate((build.pan_x as f64, build.pan_y as f64)) * Affine::scale(build.zoom as f64);
                let scene = match self.build_stream_scene(&build.stream[batch_start..batch_end], transform) {
                    Ok(scene) => scene,
                    Err(error) => break Err(error),
                };
                let width = build.width as u32;
                let height = build.height as u32;
                if let Err(error) = self.render_scene_into(&build.batch_view, &scene, width, height) {
                    break Err(error);
                }
                let draw = QuadDraw { handle: build.batch_handle, view: &build.batch_view, rect: [0.0, 0.0, build.width, build.height], uv: [0.0, 0.0, 1.0, 1.0] };
                if let Err(error) = self.accumulate_into_view(&build.target_view, width, height, &[draw]) {
                    break Err(error);
                }
            }
            build.cursor = batch_end;
            batches += 1;
            if batch_end >= total {
                break Ok(true);
            }
            if batches >= MAX_BATCHES_PER_STEP || now_ms() - started >= budget_ms {
                break Ok(false);
            }
        };
        match result {
            Ok(true) => {
                if let Some(old) = self.scene_backing.take() {
                    self.compositor.dispose(old.handle);
                }
                let handle = self.next_handle;
                self.next_handle += 1;
                self.compositor.dispose(build.batch_handle);
                self.scene_backing = Some(SceneBacking {
                    handle,
                    view: build.target_view,
                    _texture: build.target_texture,
                    pan_x: build.pan_x,
                    pan_y: build.pan_y,
                    zoom: build.zoom,
                    width: build.width,
                    height: build.height,
                });
                Ok(true)
            }
            Ok(false) => {
                self.scene_backing_build = Some(build);
                Ok(false)
            }
            Err(error) => {
                self.compositor.dispose(build.batch_handle);
                Err(error)
            }
        }
    }

    fn cancel_scene_backing_build(&mut self) {
        if let Some(build) = self.scene_backing_build.take() {
            self.compositor.dispose(build.batch_handle);
        }
    }

    /// 释放保留场景底图（含构建中的）与其合成绑定。
    pub fn end_scene_backing(&mut self) {
        self.cancel_scene_backing_build();
        if let Some(backing) = self.scene_backing.take() {
            self.compositor.dispose(backing.handle);
        }
    }

    /// 导航期整场直绘：把所有可见 chunk 的 op 合成一个 Scene，按视口变换一次渲染到离屏纹理，
    /// 再整屏贴到 surface。用于交互期兜底，避免瓦片未就绪导致的空洞（open-pencil 的 global fallback 角色）。
    pub fn render_direct(
        &mut self,
        ops: Vec<u8>,
        pan_x: f32,
        pan_y: f32,
        zoom: f32,
        width: u32,
        height: u32,
    ) -> Result<(), JsValue> {
        let width = width.max(1);
        let height = height.max(1);
        let decoded = decode_ops(&ops).map_err(|e| JsValue::from_str(&format!("decode ops: {e}")))?;
        let mut scene = Scene::new();
        // ops 为世界坐标；pan 已换算到设备像素，zoom 为 zoom*dpr
        let transform = Affine::translate((pan_x as f64, pan_y as f64)) * Affine::scale(zoom as f64);
        build_scene(&decoded, transform, width as f32, height as f32, &self.fonts, &self.fallbacks, &self.images, &mut scene);

        let texture = self.device.create_texture(&TextureDescriptor {
            label: Some("pomelo-vello-direct"),
            size: Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: TextureFormat::Rgba8Unorm,
            usage: TextureUsages::STORAGE_BINDING | TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.renderer
            .render_to_texture(
                &self.device,
                &self.queue,
                &scene,
                &view,
                &RenderParams { base_color: Color::from_rgba8(0, 0, 0, 0), width, height, antialiasing_method: AaConfig::Area },
            )
            .map_err(js_err)?;

        let handle = self.next_handle;
        self.next_handle += 1;
        let draw = QuadDraw { handle, view: &view, rect: [0.0, 0.0, width as f32, height as f32], uv: [0.0, 0.0, 1.0, 1.0] };
        present_draws(&self.device, &self.queue, &self.surface, &self.config, &mut self.compositor, &[draw])?;
        self.compositor.dispose(handle);
        Ok(())
    }

    /// 调试：直接渲染 JS 编码的 op 字节流（经 decode_ops）并 present。
    pub fn debug_ops_test(&mut self, ops: Vec<u8>, level: f32, min_x: f32, min_y: f32) -> Result<u32, JsValue> {
        let handle = self.render_tile(ops, level, min_x, min_y)?;
        // 把 tile 平移到屏幕原点，便于任意 min 的瓦片取样
        self.present(vec![handle], -min_x * level, -min_y * level, level)?;
        Ok(handle)
    }

    /// 调试：渲染两张瓦片（红/绿）并一次性合成，验证多瓦片合成。
    pub fn debug_pair_test(&mut self) -> Result<(), JsValue> {
        let size = TILE_DEVICE_SIZE;
        let mut handles = Vec::new();
        for (min_x, min_y, fill) in [(0.0f32, 0.0f32, [255u8, 0, 0, 255]), (512.0f32, 0.0f32, [0u8, 255, 0, 255])] {
            let mut scene = Scene::new();
            let transform = tile_transform(0.5, min_x, min_y, 0.0);
            let ops = vec![crate::ops::DrawOp::RectFill { x: min_x, y: min_y, w: 100.0, h: 100.0, fill }];
            build_scene(&ops, transform, size as f32, size as f32, &self.fonts, &self.fallbacks, &self.images, &mut scene);
            let texture = self.device.create_texture(&TextureDescriptor {
                label: Some("pomelo-vello-debug-pair"),
                size: Extent3d { width: size, height: size, depth_or_array_layers: 1 },
                mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2,
                format: TextureFormat::Rgba8Unorm,
                usage: TextureUsages::STORAGE_BINDING | TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            self.renderer.render_to_texture(&self.device, &self.queue, &scene, &view, &RenderParams {
                base_color: self.clear_color, width: size, height: size, antialiasing_method: AaConfig::Area,
            }).map_err(js_err)?;
            let handle = 1_000_000 + handles.len() as u32;
            self.tiles.insert(handle, TileEntry { _texture: texture, view, min_x, min_y, level: 0.5, tex_size: size as f32, bleed: 0.0 });
            handles.push(handle);
        }
        self.present(handles, 0.0, 0.0, 0.5)
    }

    /// 调试：走与 render_tile 相同的路径，但场景是一条纯红矩形（世界 0,0,200x100），随后 present。
    pub fn debug_tile_test(&mut self) -> Result<u32, JsValue> {
        let size = TILE_DEVICE_SIZE;
        let mut scene = Scene::new();
        let transform = tile_transform(1.0, 0.0, 0.0, 0.0);
        let ops = vec![crate::ops::DrawOp::RectFill { x: 0.0, y: 0.0, w: 200.0, h: 100.0, fill: [255, 0, 0, 255] }];
        build_scene(&ops, transform, size as f32, size as f32, &self.fonts, &self.fallbacks, &self.images, &mut scene);
        let texture = self.device.create_texture(&TextureDescriptor {
            label: Some("pomelo-vello-debug-tile"),
            size: Extent3d { width: size, height: size, depth_or_array_layers: 1 },
            mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2,
            format: TextureFormat::Rgba8Unorm,
            usage: TextureUsages::STORAGE_BINDING | TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.renderer.render_to_texture(&self.device, &self.queue, &scene, &view, &RenderParams {
            base_color: Color::from_rgba8(0, 0, 0, 0), width: size, height: size, antialiasing_method: AaConfig::Area,
        }).map_err(js_err)?;
        let handle = self.next_handle; self.next_handle += 1;
        self.tiles.insert(handle, TileEntry { _texture: texture, view, min_x: 0.0, min_y: 0.0, level: 1.0, tex_size: size as f32, bleed: 0.0 });
        Ok(handle)
    }

    /// 调试：在任意 tile（min 可为非 0）里画 rectFill + image，present 时平移回原点。
    pub fn debug_image_scene_at(&mut self, level: f32, min_x: f32, min_y: f32) -> Result<u32, JsValue> {
        use vello::peniko::Fill;
        let size = TILE_DEVICE_SIZE + (BLEED * 2.0) as u32;
        let mut scene = Scene::new();
        let transform = tile_transform(level, min_x, min_y, BLEED);
        let ops = vec![
            crate::ops::DrawOp::RectFill { x: min_x + 10.0, y: min_y + 10.0, w: 120.0, h: 120.0, fill: [0, 0, 0, 255] },
            crate::ops::DrawOp::Image { image_id: 2, x: min_x + 20.0, y: min_y + 20.0, w: 100.0, h: 100.0 },
        ];
        build_scene(&ops, transform, size as f32, size as f32, &self.fonts, &self.fallbacks, &self.images, &mut scene);
        let _ = Fill::NonZero;
        let texture = self.device.create_texture(&TextureDescriptor {
            label: Some("pomelo-vello-debug-img-at"),
            size: Extent3d { width: size, height: size, depth_or_array_layers: 1 },
            mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2,
            format: TextureFormat::Rgba8Unorm,
            usage: TextureUsages::STORAGE_BINDING | TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.renderer.render_to_texture(&self.device, &self.queue, &scene, &view, &RenderParams {
            base_color: Color::from_rgba8(0, 0, 0, 0), width: size, height: size, antialiasing_method: AaConfig::Area,
        }).map_err(js_err)?;
        let handle = self.next_handle; self.next_handle += 1;
        self.tiles.insert(handle, TileEntry { _texture: texture, view, min_x, min_y, level, tex_size: size as f32, bleed: BLEED });
        self.present(vec![handle], -min_x * level, -min_y * level, level)?;
        Ok(handle)
    }

    /// 调试：把已注册图像经 vello draw_image 渲进一张瓦片纹理并 present（origin 附近）。
    pub fn debug_registered_image_test(&mut self) -> Result<u32, JsValue> {
        use vello::peniko::Fill;
        let size = TILE_DEVICE_SIZE;
        let mut scene = Scene::new();
        scene.push_clip_layer(Fill::NonZero, vello::kurbo::Affine::IDENTITY, &vello::kurbo::Rect::new(0.0, 0.0, size as f64, size as f64));
        if let Some(image) = self.images.get(&2) {
            let local = vello::kurbo::Affine::translate((10.0, 10.0)) * vello::kurbo::Affine::scale(20.0);
            scene.draw_image(image, local);
        }
        scene.pop_layer();
        let texture = self.device.create_texture(&TextureDescriptor {
            label: Some("pomelo-vello-debug-registered-image"),
            size: Extent3d { width: size, height: size, depth_or_array_layers: 1 },
            mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2,
            format: TextureFormat::Rgba8Unorm,
            usage: TextureUsages::STORAGE_BINDING | TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.renderer.render_to_texture(&self.device, &self.queue, &scene, &view, &RenderParams {
            base_color: Color::from_rgba8(0, 0, 0, 0), width: size, height: size, antialiasing_method: AaConfig::Area,
        }).map_err(js_err)?;
        let handle = self.next_handle; self.next_handle += 1;
        self.tiles.insert(handle, TileEntry { _texture: texture, view, min_x: 0.0, min_y: 0.0, level: 1.0, tex_size: size as f32, bleed: 0.0 });
        self.present(vec![handle], 0.0, 0.0, 1.0)?;
        Ok(handle)
    }

    /// 调试：上传一张 4×4 纯红纹理，经 compositor 合成并呈现，隔离合成链路。
    pub fn debug_image_test(&mut self) -> Result<(), JsValue> {
        let size = 4u32;
        let texture = self.device.create_texture(&TextureDescriptor {
            label: Some("pomelo-vello-debug-image"),
            size: Extent3d { width: size, height: size, depth_or_array_layers: 1 },
            mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2,
            format: TextureFormat::Rgba8Unorm,
            usage: TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let mut data = Vec::with_capacity((size * size * 4) as usize);
        for _ in 0..(size * size) {
            data.extend_from_slice(&[255, 0, 0, 255]);
        }
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo { texture: &texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            &data,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(size * 4), rows_per_image: Some(size) },
            Extent3d { width: size, height: size, depth_or_array_layers: 1 },
        );
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        // 直接以固定屏幕矩形合成这张 4×4 纹理（不进入瓦片世界坐标体系）
        let draw = QuadDraw { handle: u32::MAX, view: &view, rect: [200.0, 200.0, 160.0, 160.0], uv: [0.0, 0.0, 1.0, 1.0] };
        present_draws(&self.device, &self.queue, &self.surface, &self.config, &mut self.compositor, &[draw])
    }
}

/// 把 draws 合成为一帧并呈现。抽成自由函数以便在不同借用组合下复用。
fn present_draws(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    surface: &wgpu::Surface<'static>,
    config: &wgpu::SurfaceConfiguration,
    compositor: &mut Compositor,
    draws: &[QuadDraw<'_>],
) -> Result<(), JsValue> {
    let frame = match surface.get_current_texture() {
        wgpu::CurrentSurfaceTexture::Success(texture) => texture,
        wgpu::CurrentSurfaceTexture::Suboptimal(texture) => texture,
        wgpu::CurrentSurfaceTexture::Outdated => {
            surface.configure(device, config);
            return Ok(());
        }
        other => return Err(JsValue::from_str(&format!("surface acquisition failed: {other:?}"))),
    };
    let frame_view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("pomelo-vello-present") });
    compositor.render(device, queue, &mut encoder, &frame_view, config.width, config.height, draws, false);
    queue.submit(Some(encoder.finish()));
    frame.present();
    Ok(())
}

fn js_err(error: impl std::fmt::Debug) -> JsValue {
    JsValue::from_str(&format!("{error:?}"))
}
