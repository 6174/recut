use vello::wgpu;
use vello::{AaSupport, Renderer, RendererOptions};
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

/// 持有 wgpu 设备/队列/surface 与 vello Renderer。tile 光栅与合成 API 在 M1 后续补齐。
/// device/queue/renderer 将在 tile 光栅路径中直接使用；resize/width/height 已可用。
#[wasm_bindgen]
#[allow(dead_code)]
pub struct VelloRuntime {
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    renderer: Renderer,
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

        Ok(VelloRuntime { device, queue, surface, config, renderer })
    }

    /// 调整 surface 尺寸（逻辑像素 × dpr 由 JS 侧换算后传入）。
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
}

fn js_err(error: impl std::fmt::Debug) -> JsValue {
    JsValue::from_str(&format!("{error:?}"))
}
