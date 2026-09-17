"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:          vec2<f32>,
  time:          f32,
  speed:         f32,
  layers:        f32,
  baseScale:     f32,
  scaleStep:     f32,
  density:       f32,
  starSize:      f32,
  twinkleSpeed:  f32,
  twinkleAmount: f32,
  starColor:     vec4<f32>,
  background:    vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn sf_hash1(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}
fn sf_hash2(p: vec2<f32>) -> vec2<f32> {
  let a = fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
  let b = fract(sin(dot(p, vec2<f32>(269.5, 183.3))) * 43758.5453);
  return vec2<f32>(a, b);
}

fn starfield(uv01: vec2<f32>) -> vec4<f32> {
  let uv = uv01;

  let count  = max(1, min(i32(u.layers), 8));
  let thresh = clamp(1.0 - u.density, 0.0, 1.0);
  let ssz    = max(u.starSize, 0.001);
  let amt    = clamp(u.twinkleAmount, 0.0, 1.0);

  let starRGB = u.starColor.rgb;
  var col     = vec3<f32>(0.0);

  for (var layer: i32 = 0; layer < count; layer = layer + 1) {
    let fl    = f32(layer);
    let scale = max(u.baseScale + fl * u.scaleStep, 1.0);
    let lspd  = (0.03 + fl * 0.02) * u.speed;
    let bri   = max(0.0, 1.0 - fl * 0.25);

    var st     = uv * scale;
    st.y       = st.y + u.time * lspd * scale;
    let cell   = floor(st);
    let f      = fract(st);

    let h = sf_hash1(cell);
    if (h > thresh) {
      let center  = sf_hash2(cell);
      let d       = length(f - center);
      let twink   = sin(u.time * u.twinkleSpeed + h * 100.0) * amt + (1.0 - amt);
      let falloff = 1.0 - smoothstep(0.0, ssz, d);
      col = col + starRGB * (falloff * twink * bri);
    }
  }

  return vec4<f32>(u.background.rgb + col, 1.0);
}

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  var out: VOut;
  out.pos = vec4<f32>(p[i], 0.0, 1.0);
  let uv01 = (p[i] + vec2<f32>(1.0)) * 0.5;
  out.uv = vec2<f32>(uv01.x, 1.0 - uv01.y);
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  return starfield(in.uv);
}
`;

const UNIFORMS = new Float32Array([
    0.0, 0.0,
    0.0,
    1.0,
    3.0,
    50.0,
    80.0,
    0.05,
    0.1,
    3.0,
    0.3,
    0.0,
    1.0, 1.0, 1.0, 1.0,
    0.007843138, 0.007843138, 0.03137255, 1.0,
]);

const SIZE_WORD = 0;
const TIME_WORD = 2;
const ANIMATED = true;
const CLEAR_ALPHA = 1;
export default function StarfieldView() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const gpu = (navigator as any).gpu;
        if (!gpu) {
            setError("This browser doesn't support WebGPU. Try Chrome or Edge 113+, Safari 26+, or Firefox 141+ on Windows.");
            return;
        }

        let disposed = false;
        let frame = 0;
        let observer: ResizeObserver | null = null;
        let device: any = null;

        const start = async () => {
            const adapter = await gpu.requestAdapter();
            if (!adapter) {
                setError("No WebGPU adapter is available.");
                return;
            }
            const dev = await adapter.requestDevice();
            if (disposed) {
                dev.destroy?.();
                return;
            }
            device = dev;
            dev.lost?.then(() => {
                disposed = true;
                cancelAnimationFrame(frame);
            });

            const context = canvas.getContext("webgpu") as any;
            if (!context) {
                setError("This canvas can't provide a WebGPU context.");
                return;
            }
            const format = gpu.getPreferredCanvasFormat();
            context.configure({ device: dev, format, alphaMode: "premultiplied" });

            const shader = dev.createShaderModule({ code: WGSL });
            const pipeline = await dev.createRenderPipelineAsync({
                layout: "auto",
                vertex: { module: shader, entryPoint: "vs_main" },
                fragment: { module: shader, entryPoint: "fs_main", targets: [{ format }] },
                primitive: { topology: "triangle-list" },
            });
            if (disposed) return;

            const usage = (globalThis as any).GPUBufferUsage;
            const uniforms = UNIFORMS.slice();
            const buffer = dev.createBuffer({
                size: uniforms.byteLength,
                usage: usage.UNIFORM | usage.COPY_DST,
            });
            const bindGroup = dev.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [{ binding: 0, resource: { buffer } }],
            });

            const startedAt = performance.now();
            const draw = () => {
                if (disposed) return;
                uniforms[SIZE_WORD] = canvas.width;
                uniforms[SIZE_WORD + 1] = canvas.height;
                if (ANIMATED) uniforms[TIME_WORD] = (performance.now() - startedAt) / 1000;
                dev.queue.writeBuffer(buffer, 0, uniforms);

                const encoder = dev.createCommandEncoder();
                const pass = encoder.beginRenderPass({
                    colorAttachments: [
                        {
                            view: context.getCurrentTexture().createView(),
                            loadOp: "clear",
                            storeOp: "store",
                            clearValue: { r: 0, g: 0, b: 0, a: CLEAR_ALPHA },
                        },
                    ],
                });
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, bindGroup);
                pass.draw(3);
                pass.end();
                dev.queue.submit([encoder.finish()]);

                if (ANIMATED) frame = requestAnimationFrame(draw);
            };

            const resize = () => {
                const rect = canvas.getBoundingClientRect();
                const scale = Math.min(window.devicePixelRatio || 1, 2);
                const w = Math.max(1, Math.round(rect.width * scale));
                const h = Math.max(1, Math.round(rect.height * scale));
                if (w === canvas.width && h === canvas.height) return;
                canvas.width = w;
                canvas.height = h;
                if (!ANIMATED) draw();
            };

            observer = new ResizeObserver(resize);
            observer.observe(canvas);
            resize();
            draw();
        };

        start().catch((e) => setError("WebGPU couldn't start: " + String(e)));

        return () => {
            disposed = true;
            cancelAnimationFrame(frame);
            observer?.disconnect();
            device?.destroy?.();
        };
    }, []);

    return (
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
            <canvas
                ref={canvasRef}
                style={{ display: "block", width: "100%", height: "100%" }}
            />
            {error !== null && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 24,
                        textAlign: "center",
                        color: "#8A8A8E",
                        font: "14px system-ui, sans-serif",
                    }}
                >
                    {error}
                </div>
            )}
        </div>
    );
}
