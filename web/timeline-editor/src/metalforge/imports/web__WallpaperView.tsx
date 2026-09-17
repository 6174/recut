"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size: vec2<f32>,
  time: f32,
  mode: f32,
  scale: f32,
  warp: f32,
  contrast: f32,
  bands: f32,
  rotation: f32,
  lift: f32,
  softness: f32,
  grain: f32,
  vignette: f32,
  seed: f32,
  animate: f32,
  aSpeed: f32,
  aAmount: f32,
  aWaves: f32,
  color1: vec4<f32>,
  color2: vec4<f32>,
  color3: vec4<f32>,
  color4: vec4<f32>,
  color5: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

fn wp_hash2(p: vec2<f32>) -> vec2<f32> {
  let q = vec2<f32>(dot(p, vec2<f32>(127.1, 311.7)), dot(p, vec2<f32>(269.5, 183.3)));
  return fract(sin(q) * 43758.5453) * 2.0 - 1.0;
}

fn wp_hash1(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn wp_noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u2 = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dot(wp_hash2(i), f),
        dot(wp_hash2(i + vec2<f32>(1.0, 0.0)), f - vec2<f32>(1.0, 0.0)), u2.x),
    mix(dot(wp_hash2(i + vec2<f32>(0.0, 1.0)), f - vec2<f32>(0.0, 1.0)),
        dot(wp_hash2(i + vec2<f32>(1.0, 1.0)), f - vec2<f32>(1.0, 1.0)), u2.x),
    u2.y,
  );
}

fn wp_fbm(p0: vec2<f32>) -> f32 {
  var p = p0;
  var a = 0.6;
  var s = 0.0;
  for (var i = 0; i < 3; i = i + 1) {
    s = s + a * wp_noise(p);
    p = p * 2.1;
    a = a * 0.42;
  }
  return s;
}

fn wp_pal(t0: f32) -> vec3<f32> {
  let t = clamp(t0, 0.0, 1.0);
  var c = mix(u.color1.rgb, u.color2.rgb, smoothstep(0.00, 0.46, t));
  c = mix(c, u.color3.rgb, smoothstep(0.44, 0.76, t));
  c = mix(c, u.color4.rgb, smoothstep(0.74, 0.93, t));
  c = mix(c, u.color5.rgb, smoothstep(0.92, 1.00, t));
  return c;
}

fn wallpaperMain(uv01: vec2<f32>) -> vec4<f32> {
  let res = max(u.size, vec2<f32>(1.0));
  let fc = vec2<f32>(uv01.x * res.x, res.y - uv01.y * res.y);
  let uv = (fc - 0.5 * res) / res.y;

  let soft = clamp(u.softness, 0.0, 1.0);
  let sc = u.scale * (1.05 - soft * 0.55);
  let wa = u.warp * (0.35 + soft * 0.7);
  let th = radians(u.rotation);
  var uvw = uv;
  if (u.animate > 0.5) {
    let ts = u.time * u.aSpeed;
    uvw = uvw + u.aAmount * vec2<f32>(sin(ts + uv.y * u.aWaves),
                                      cos(ts * 0.77 + uv.x * u.aWaves));
  }
  let p = vec2<f32>(cos(th) * uvw.x + sin(th) * uvw.y,
                    -sin(th) * uvw.x + cos(th) * uvw.y) * sc + vec2<f32>(u.seed);

  let q = vec2<f32>(wp_fbm(p), wp_fbm(p + vec2<f32>(3.7, 1.3)));
  let r = vec2<f32>(wp_fbm(p + wa * q + vec2<f32>(1.7, 9.2)),
                    wp_fbm(p + wa * q + vec2<f32>(8.3, 2.8)));
  let f = wp_fbm(p + wa * r);

  var t: f32;
  if (u.mode < 0.5) {
    t = 0.46 + f * u.contrast * 1.9;
    let k = t - 0.78;
    if (k > 0.0) { t = 0.78 + k / (1.0 + k * 1.6); }
    t = pow(clamp(t, 0.0, 1.0), 1.35);
  } else {
    t = 0.5 + 0.5 * sin(f * 6.2831 * u.bands * 1.7 + u.seed * 2.0);
    t = pow(clamp(t, 0.0, 1.0), u.contrast);
    let k = t - 0.72;
    if (k > 0.0) { t = 0.72 + k / (1.0 + k * 0.6); }
  }

  var col = wp_pal(t + u.lift);

  let d = length(uv * vec2<f32>(0.78, 0.52));
  col = col * mix(1.0, 1.0 - smoothstep(0.1, 1.25, d), clamp(u.vignette, 0.0, 1.0));

  let gs = 1500.0 / res.y;
  let g = wp_hash1(floor(fc * gs) + u.seed * 37.0);
  col = col + vec3<f32>((g - 0.5) * clamp(u.grain, 0.0, 1.0) * 0.34 * (0.22 + dot(col, vec3<f32>(0.333, 0.333, 0.333))));

  return vec4<f32>(max(col, vec3<f32>(0.0)), 1.0);
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
  return wallpaperMain(in.uv);
}
`;

const UNIFORMS = new Float32Array([
    0.0, 0.0,
    0.0,
    0.0,
    1.15,
    2.6,
    1.35,
    1.0,
    20.0,
    0.04,
    0.5,
    0.5,
    0.85,
    27.0,
    1.0,
    1.0,
    0.05,
    6.0,
    0.0, 0.0,
    0.015686275, 0.019607844, 0.101960786, 1.0,
    0.03137255, 0.09803922, 0.36862746, 1.0,
    0.11764706, 0.36078432, 1.0, 1.0,
    0.24705882, 0.84705883, 1.0, 1.0,
    0.93333334, 0.94509804, 0.9647059, 1.0,
]);

const SIZE_WORD = 0;
const TIME_WORD = 2;
const ANIMATED = true;
const CLEAR_ALPHA = 1;
export default function WallpaperView() {
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
