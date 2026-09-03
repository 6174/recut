"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:       vec2<f32>,
  time:       f32,
  speed:      f32,
  flow:       f32,
  grain:      f32,
  brightness: f32,
  color1:     vec4<f32>,
  color2:     vec4<f32>,
  color3:     vec4<f32>,
  color4:     vec4<f32>,
  color5:     vec4<f32>,
  color6:     vec4<f32>,
  color7:     vec4<f32>,
  color8:     vec4<f32>,
  color9:     vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn ggColor(i: i32) -> vec3<f32> {
  switch (i) {
    case 0:  { return u.color1.rgb; }
    case 1:  { return u.color2.rgb; }
    case 2:  { return u.color3.rgb; }
    case 3:  { return u.color4.rgb; }
    case 4:  { return u.color5.rgb; }
    case 5:  { return u.color6.rgb; }
    case 6:  { return u.color7.rgb; }
    case 7:  { return u.color8.rgb; }
    default: { return u.color9.rgb; }
  }
}

fn ggH00(x: f32) -> f32 { return 2.0 * x * x * x - 3.0 * x * x + 1.0; }
fn ggH10(x: f32) -> f32 { return x * x * x - 2.0 * x * x + x; }
fn ggH01(x: f32) -> f32 { return 3.0 * x * x - 2.0 * x * x * x; }
fn ggH11(x: f32) -> f32 { return x * x * x - x * x; }

fn ggHermite(p0: f32, p1: f32, m0: f32, m1: f32, x: f32) -> f32 {
  return p0 * ggH00(x) + m0 * ggH10(x) + p1 * ggH01(x) + m1 * ggH11(x);
}

fn ggIndex(x: i32, y: i32) -> i32 { return clamp(y * 3 + x, 0, 8); }

fn ggGrid(coords0: vec2<f32>, t: f32) -> vec3<f32> {
  let a = sin(t * 1.0) * 0.5 + 0.5;
  let b = sin(t * 1.5) * 0.5 + 0.5;
  let c = sin(t * 2.0) * 0.5 + 0.5;
  let d = sin(t * 2.5) * 0.5 + 0.5;

  let y0 = mix(a, b, coords0.x);
  let y1 = mix(c, d, coords0.x);
  let x0 = mix(a, c, coords0.y);
  let x1 = mix(b, d, coords0.y);

  let cx = ggHermite(0.0, 1.0, u.flow * x0, u.flow * x1, coords0.x);
  let cy = ggHermite(0.0, 1.0, u.flow * y0, u.flow * y1, coords0.y);

  let gridCoords = vec2<f32>(cx, cy) * 2.0;
  let idStart = vec2<i32>(gridCoords);
  let idEnd   = vec2<i32>(ceil(gridCoords));

  let factors = smoothstep(vec2<f32>(0.0), vec2<f32>(1.0), fract(gridCoords));

  let r0 = mix(ggColor(ggIndex(idStart.x, idStart.y)), ggColor(ggIndex(idEnd.x, idStart.y)), factors.x);
  let r1 = mix(ggColor(ggIndex(idStart.x, idEnd.y)),   ggColor(ggIndex(idEnd.x, idEnd.y)),   factors.x);
  return mix(r0, r1, factors.y);
}

fn grainAnim(uv01: vec2<f32>) -> vec4<f32> {
  var col = ggGrid(uv01, u.time * u.speed * 0.20) * u.brightness;

  let x = (uv01.x + 4.0) * (uv01.y + 4.0) * 10.0;
  let g = (((x % 13.0) + 1.0) * ((x % 123.0) + 1.0)) % 0.01 - 0.005;
  col = col + vec3<f32>(g * u.grain);

  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
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
  return grainAnim(in.uv);
}
`;

const UNIFORMS = new Float32Array([
    0.0, 0.0,
    0.0,
    1.0,
    2.0,
    16.0,
    1.0,
    0.0,
    0.6039216, 0.3137255, 0.16862746, 1.0,
    0.5137255, 0.5019608, 0.60784316, 1.0,
    0.0, 0.12941177, 0.25882354, 1.0,
    0.22745098, 0.24705882, 0.36862746, 1.0,
    0.015686275, 0.09019608, 0.18039216, 1.0,
    0.74509805, 0.34117648, 0.015686275, 1.0,
    0.015686275, 0.09019608, 0.18039216, 1.0,
    0.6784314, 0.30980393, 0.011764706, 1.0,
    0.60784316, 0.4627451, 0.5137255, 1.0,
]);

const SIZE_WORD = 0;
const TIME_WORD = 2;
const ANIMATED = true;
const CLEAR_ALPHA = 1;
export default function GrainView() {
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
