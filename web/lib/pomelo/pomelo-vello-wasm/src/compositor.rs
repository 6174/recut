//! 自建 wgpu instanced-quad 合成器：直接采样瓦片纹理并贴到 surface。
//!
//! 取代 vello `Scene::draw_image` 合成路径（多纹理经 image atlas 不可靠）。
//! 每个瓦片：一个 32B uniform buffer（目标矩形 + uv）+ 一个 bind group，draw 6 顶点。
//! 不使用动态偏移，避免多 draw 时的绑定/偏移问题。
//!
//! 颜色：瓦片纹理为 `Rgba8Unorm`，内容为 sRGB 编码字节；surface 选**非 sRGB** 格式，
//! 采样值直接写入，避免二次编码。clear 色同样按原始字节传入。
use std::collections::HashMap;
use std::num::NonZeroU64;

use vello::wgpu::{
    BindGroup, BindGroupDescriptor, BindGroupEntry, BindGroupLayout, BindGroupLayoutDescriptor, BindGroupLayoutEntry, BindingResource,
    BindingType, BlendComponent, BlendFactor, BlendOperation, BlendState, Buffer, BufferBindingType, BufferDescriptor, BufferUsages,
    ColorTargetState, ColorWrites, CommandEncoder, Device, FragmentState, LoadOp, MultisampleState, Operations,
    PipelineCompilationOptions, PipelineLayoutDescriptor, PrimitiveState, PrimitiveTopology, Queue, RenderPassColorAttachment,
    RenderPassDescriptor, RenderPipeline, RenderPipelineDescriptor, Sampler, SamplerBindingType, SamplerDescriptor, ShaderModuleDescriptor,
    ShaderSource, ShaderStages, StoreOp, TextureSampleType, TextureView, TextureViewDimension, VertexState,
};

const UNIFORM_BYTES: u64 = 32;

const SHADER: &str = r#"
struct Uniforms {
    dst: vec4<f32>,
    uv: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct VOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VOut {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0),
    );
    let c = corners[vi];
    var out: VOut;
    out.pos = vec4<f32>(u.dst.xy + c * u.dst.zw, 0.0, 1.0);
    out.uv = u.uv.xy + c * (u.uv.zw - u.uv.xy);
    return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
    return textureSample(tex, samp, in.uv);
}
"#;

pub struct QuadDraw<'a> {
    pub handle: u32,
    pub view: &'a TextureView,
    /// 设备像素的目标矩形 (x, y, width, height)
    pub rect: [f32; 4],
    /// 纹理采样 UV 矩形 (u0, v0, u1, v1)（bleed 瓦片取内区）
    pub uv: [f32; 4],
}

struct TileBinding {
    buffer: Buffer,
    bind_group: BindGroup,
}

pub struct Compositor {
    pipeline: RenderPipeline,
    layout: BindGroupLayout,
    sampler: Sampler,
    entries: HashMap<u32, TileBinding>,
    clear: wgpu::Color,
}

impl Compositor {
    pub fn new(device: &Device, format: wgpu::TextureFormat) -> Self {
        let sampler = device.create_sampler(&SamplerDescriptor {
            label: Some("pomelo-vello-compositor-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        let layout = device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("pomelo-vello-compositor-bgl"),
            entries: &[
                BindGroupLayoutEntry {
                    binding: 0,
                    visibility: ShaderStages::VERTEX,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: NonZeroU64::new(UNIFORM_BYTES),
                    },
                    count: None,
                },
                BindGroupLayoutEntry {
                    binding: 1,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Texture {
                        sample_type: TextureSampleType::Float { filterable: true },
                        view_dimension: TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                BindGroupLayoutEntry {
                    binding: 2,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Sampler(SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&PipelineLayoutDescriptor {
            label: Some("pomelo-vello-compositor-layout"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });

        let shader = device.create_shader_module(ShaderModuleDescriptor {
            label: Some("pomelo-vello-compositor-shader"),
            source: ShaderSource::Wgsl(SHADER.into()),
        });

        // straight（未预乘）alpha 混合：vello `render_to_texture` 的目标纹理输出为未预乘 alpha
        // （fine.wgsl 末尾写目标前做 1/a 反预乘 → `rgba_sep`），必须用 SrcAlpha/OneMinusSrcAlpha。
        // 若按预乘混合，半透明像素的 rgb（仍是原色，如白边 255）会被直接叠加 → 节点白边、文字发白。
        let blend = BlendState {
            color: BlendComponent { src_factor: BlendFactor::SrcAlpha, dst_factor: BlendFactor::OneMinusSrcAlpha, operation: BlendOperation::Add },
            alpha: BlendComponent { src_factor: BlendFactor::One, dst_factor: BlendFactor::OneMinusSrcAlpha, operation: BlendOperation::Add },
        };

        let pipeline = device.create_render_pipeline(&RenderPipelineDescriptor {
            label: Some("pomelo-vello-compositor-pipeline"),
            layout: Some(&pipeline_layout),
            vertex: VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: PipelineCompilationOptions::default(),
                buffers: &[],
            },
            primitive: PrimitiveState {
                topology: PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                unclipped_depth: false,
                polygon_mode: wgpu::PolygonMode::Fill,
                conservative: false,
            },
            depth_stencil: None,
            multisample: MultisampleState::default(),
            fragment: Some(FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: PipelineCompilationOptions::default(),
                targets: &[Some(ColorTargetState { format, blend: Some(blend), write_mask: ColorWrites::ALL })],
            }),
            multiview_mask: None,
            cache: None,
        });

        Self { pipeline, layout, sampler, entries: HashMap::new(), clear: wgpu::Color::BLACK }
    }

    pub fn set_clear(&mut self, color: wgpu::Color) {
        self.clear = color;
    }

    pub fn dispose(&mut self, handle: u32) {
        self.entries.remove(&handle);
    }

    pub fn render(
        &mut self,
        device: &Device,
        queue: &Queue,
        encoder: &mut CommandEncoder,
        target: &TextureView,
        surface_width: u32,
        surface_height: u32,
        draws: &[QuadDraw<'_>],
    ) {
        let w = surface_width.max(1) as f32;
        let h = surface_height.max(1) as f32;

        // 1) 确保每个瓦片有 uniform buffer + bind group，并写入本帧目标矩形
        for draw in draws {
            let [sx, sy, sw, sh] = draw.rect;
            let [u0, v0, u1, v1] = draw.uv;
            let uniforms: [f32; 8] = [
                sx / w * 2.0 - 1.0,
                1.0 - sy / h * 2.0,
                sw / w * 2.0,
                -(sh / h * 2.0),
                u0,
                v0,
                u1,
                v1,
            ];
            let entry = self.entries.entry(draw.handle).or_insert_with(|| {
                let buffer = device.create_buffer(&BufferDescriptor {
                    label: Some("pomelo-vello-compositor-uniform"),
                    size: UNIFORM_BYTES,
                    usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                });
                let bind_group = device.create_bind_group(&BindGroupDescriptor {
                    label: Some("pomelo-vello-compositor-bg"),
                    layout: &self.layout,
                    entries: &[
                        BindGroupEntry { binding: 0, resource: buffer.as_entire_binding() },
                        BindGroupEntry { binding: 1, resource: BindingResource::TextureView(draw.view) },
                        BindGroupEntry { binding: 2, resource: BindingResource::Sampler(&self.sampler) },
                    ],
                });
                TileBinding { buffer, bind_group }
            });
            let mut bytes = [0u8; UNIFORM_BYTES as usize];
            for (i, value) in uniforms.iter().enumerate() {
                bytes[i * 4..i * 4 + 4].copy_from_slice(&value.to_le_bytes());
            }
            queue.write_buffer(&entry.buffer, 0, &bytes);
        }

        // 2) 收齐 bind group（保持 draws 顺序）
        let bindings: Vec<&BindGroup> = draws
            .iter()
            .filter_map(|draw| self.entries.get(&draw.handle).map(|entry| &entry.bind_group))
            .collect();

        let mut pass = encoder.begin_render_pass(&RenderPassDescriptor {
            label: Some("pomelo-vello-compositor-pass"),
            color_attachments: &[Some(RenderPassColorAttachment {
                view: target,
                depth_slice: None,
                resolve_target: None,
                ops: Operations { load: LoadOp::Clear(self.clear), store: StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        for bind_group in bindings {
            pass.set_bind_group(0, Some(bind_group), &[]);
            pass.draw(0..6, 0..1);
        }
    }
}
