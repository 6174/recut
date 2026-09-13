//! 持有 wgpu 设备/队列/surface 与 vello Renderer，提供瓦片光栅（render_tile）与合成（present）。
//! 仅 wasm32 编译；op 解码与 Scene 构建在 `crate::ops`（host 可测）。
//!
//! 合成策略（M1）：Rust 侧把命中瓦片以 vello `draw_image` 拼成一个 Scene，渲染到
//! Rgba8Unorm 中间纹理，再用 `TextureBlitter` blit 到 surface。自建 instanced-quad 合成
//! 作为后续性能优化（RFC §2 修正 1），当前优先正确性。
use std::collections::HashMap;

use vello::kurbo::Affine;
use vello::peniko::{Color, ImageData};
use vello::wgpu::util::TextureBlitter;
use vello::wgpu::{self, Extent3d, TextureDescriptor, TextureFormat, TextureUsages};
use vello::{AaConfig, AaSupport, RenderParams, Renderer, RendererOptions, Scene};
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

use crate::ops::{build_scene, decode_ops, tile_transform, DrawOp};

const TILE_DEVICE_SIZE: u32 = 256;
/// GPU 路径使用 vello 解析 AA；瓦片边界天然落在设备像素网格，无需 bleed（CPU 路径的 2px 外扩见 RFC）。
const BLEED: f32 = 0.0;

struct TileEntry {
    image: ImageData,
    min_x: f32,
    min_y: f32,
    level: f32,
}

#[wasm_bindgen]
pub struct VelloRuntime {
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    renderer: Renderer,
    tiles: HashMap<u32, TileEntry>,
    next_handle: u32,
    composite: Option<wgpu::Texture>,
    blitter: TextureBlitter,
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
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| f.is_srgb())
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

        let blitter = TextureBlitter::new(&device, format);
        let clear_color = Color::from_rgba8(11, 15, 25, 255);

        Ok(VelloRuntime {
            device,
            queue,
            surface,
            config,
            renderer,
            tiles: HashMap::new(),
            next_handle: 1,
            composite: None,
            blitter,
            clear_color,
        })
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.config.width = width.max(1);
        self.config.height = height.max(1);
        self.surface.configure(&self.device, &self.config);
        self.composite = None;
    }

    pub fn width(&self) -> u32 {
        self.config.width
    }

    pub fn height(&self) -> u32 {
        self.config.height
    }

    pub fn set_clear_color(&mut self, r: u8, g: u8, b: u8, a: u8) {
        self.clear_color = Color::from_rgba8(r, g, b, a);
    }

    /// 把一个瓦片的绘制 op（世界坐标，可拼接多条 chunk 的记录流）光栅到 256×256 纹理。
    /// 返回句柄，供 `present` 合成。
    pub fn render_tile(&mut self, ops: Vec<u8>, level: f32, min_x: f32, min_y: f32) -> Result<u32, JsValue> {
        let decoded = decode_ops(&ops).map_err(|e| JsValue::from_str(&format!("decode ops: {e}")))?;
        let size = TILE_DEVICE_SIZE;
        let mut scene = Scene::new();
        let transform = tile_transform(level, min_x, min_y, BLEED);
        build_scene(&decoded, transform, size as f32, &mut scene);

        let texture = self.device.create_texture(&TextureDescriptor {
            label: Some("pomelo-vello-tile"),
            size: Extent3d {
                width: size,
                height: size,
                depth_or_array_layers: 1,
            },
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

        let image = self.renderer.register_texture(texture);
        let handle = self.next_handle;
        self.next_handle += 1;
        self.tiles.insert(handle, TileEntry { image, min_x, min_y, level });
        Ok(handle)
    }

    /// 调试：直接渲染 JS 编码的 op 字节流（经 decode_ops）并 present。
    pub fn debug_ops_test(&mut self, ops: Vec<u8>, level: f32, min_x: f32, min_y: f32) -> Result<u32, JsValue> {
        let handle = self.render_tile(ops, level, min_x, min_y)?;
        self.present(vec![handle], 0.0, 0.0, level)?;
        Ok(handle)
    }

    /// 调试：走与 render_tile 相同的路径，但场景是一条纯红矩形（世界 0,0,200x100），随后 present。
    pub fn debug_tile_test(&mut self) -> Result<u32, JsValue> {
        let size = TILE_DEVICE_SIZE;
        let mut scene = Scene::new();
        let transform = tile_transform(1.0, 0.0, 0.0, 0.0);
        let ops = vec![DrawOp::RectFill { x: 0.0, y: 0.0, w: 200.0, h: 100.0, fill: [255, 0, 0, 255] }];
        build_scene(&ops, transform, size as f32, &mut scene);
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
        let image = self.renderer.register_texture(texture);
        let handle = self.next_handle; self.next_handle += 1;
        self.tiles.insert(handle, TileEntry { image, min_x: 0.0, min_y: 0.0, level: 1.0 });
        self.present(vec![handle], 0.0, 0.0, 1.0)?;
        Ok(handle)
    }

    /// 调试：上传一张 4×4 纯红纹理，register_texture + draw_image 到 composite 并呈现。
    /// 用于隔离「vello 图像合成链路」与瓦片内容问题。
    pub fn debug_image_test(&mut self) -> Result<(), JsValue> {
        self.ensure_composite();
        let size = 4u32;
        let texture = self.device.create_texture(&TextureDescriptor {
            label: Some("pomelo-vello-debug-image"),
            size: Extent3d { width: size, height: size, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: TextureFormat::Rgba8Unorm,
            usage: TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST | TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let mut data = Vec::with_capacity((size * size * 4) as usize);
        for _ in 0..(size * size) {
            data.extend_from_slice(&[255, 0, 0, 255]);
        }
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &data,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(size * 4), rows_per_image: Some(size) },
            Extent3d { width: size, height: size, depth_or_array_layers: 1 },
        );
        let image = self.renderer.register_texture(texture);
        let mut scene = Scene::new();
        scene.draw_image(&image, Affine::translate((200.0, 200.0)) * Affine::scale(40.0));

        let (device, queue, renderer) = (&self.device, &self.queue, &mut self.renderer);
        let composite_view = self
            .composite
            .as_ref()
            .ok_or_else(|| JsValue::from_str("composite texture missing"))?
            .create_view(&wgpu::TextureViewDescriptor::default());
        renderer
            .render_to_texture(
                device,
                queue,
                &scene,
                &composite_view,
                &RenderParams { base_color: self.clear_color, width: self.config.width, height: self.config.height, antialiasing_method: AaConfig::Area },
            )
            .map_err(js_err)?;
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(texture) => texture,
            wgpu::CurrentSurfaceTexture::Suboptimal(texture) => texture,
            other => return Err(JsValue::from_str(&format!("surface acquisition failed: {other:?}"))),
        };
        let frame_view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("pomelo-vello-debug-present") });
        self.blitter.copy(device, &mut encoder, &composite_view, &frame_view);
        queue.submit(Some(encoder.finish()));
        frame.present();
        Ok(())
    }

    pub fn dispose_tile(&mut self, handle: u32) {
        if let Some(entry) = self.tiles.remove(&handle) {
            self.renderer.unregister_texture(entry.image);
        }
    }

    /// 合成命中瓦片并呈现到 surface。tile 的世界位置来自 render_tile 时记录的值。
    pub fn present(&mut self, handles: Vec<u32>, pan_x: f32, pan_y: f32, zoom: f32) -> Result<(), JsValue> {
        self.ensure_composite();

        let mut scene = Scene::new();
        for handle in &handles {
            if let Some(tile) = self.tiles.get(handle) {
                let scale = (zoom / tile.level) as f64;
                let sx = (tile.min_x as f64) * (zoom as f64) + (pan_x as f64);
                let sy = (tile.min_y as f64) * (zoom as f64) + (pan_y as f64);
                let affine = Affine::translate((sx, sy)) * Affine::scale(scale);
                scene.draw_image(&tile.image, affine);
            }
        }

        let (device, queue, renderer) = (&self.device, &self.queue, &mut self.renderer);
        let composite_view = self
            .composite
            .as_ref()
            .ok_or_else(|| JsValue::from_str("composite texture missing"))?
            .create_view(&wgpu::TextureViewDescriptor::default());
        let params = RenderParams {
            base_color: self.clear_color,
            width: self.config.width,
            height: self.config.height,
            antialiasing_method: AaConfig::Area,
        };
        renderer
            .render_to_texture(device, queue, &scene, &composite_view, &params)
            .map_err(js_err)?;

        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(texture) => texture,
            wgpu::CurrentSurfaceTexture::Suboptimal(texture) => texture,
            wgpu::CurrentSurfaceTexture::Outdated => {
                self.surface.configure(&self.device, &self.config);
                return Ok(());
            }
            other => return Err(JsValue::from_str(&format!("surface acquisition failed: {other:?}"))),
        };
        let frame_view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("pomelo-vello-present"),
        });
        self.blitter.copy(device, &mut encoder, &composite_view, &frame_view);
        queue.submit(Some(encoder.finish()));
        frame.present();
        Ok(())
    }
}

impl VelloRuntime {
    fn ensure_composite(&mut self) {
        let needed = self.composite.as_ref().map(|texture| {
            (texture.width(), texture.height())
        });
        if needed == Some((self.config.width, self.config.height)) {
            return;
        }
        let texture = self.device.create_texture(&TextureDescriptor {
            label: Some("pomelo-vello-composite"),
            size: Extent3d {
                width: self.config.width,
                height: self.config.height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: TextureFormat::Rgba8Unorm,
            usage: TextureUsages::STORAGE_BINDING | TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        self.composite = Some(texture);
    }
}

fn js_err(error: impl std::fmt::Debug) -> JsValue {
    JsValue::from_str(&format!("{error:?}"))
}
