//! 持有 wgpu 设备/队列/surface 与 vello Renderer，提供瓦片光栅（render_tile）与自建 quad 合成（present）。
//! 仅 wasm32 编译；op 解码与 Scene 构建在 `crate::ops`（host 可测）。
use std::collections::HashMap;
use std::sync::Arc;

use vello::kurbo::Affine;
use vello::peniko::{Blob, Color, FontData, ImageData};
use vello::wgpu::{self, Extent3d, TextureDescriptor, TextureFormat, TextureUsages};
use vello::{AaConfig, AaSupport, RenderParams, Renderer, RendererOptions, Scene};
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

use crate::compositor::{Compositor, QuadDraw};
use crate::ops::{build_scene, decode_ops, tile_transform};

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
    compositor.render(device, queue, &mut encoder, &frame_view, config.width, config.height, draws);
    queue.submit(Some(encoder.finish()));
    frame.present();
    Ok(())
}

fn js_err(error: impl std::fmt::Debug) -> JsValue {
    JsValue::from_str(&format!("{error:?}"))
}
