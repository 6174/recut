"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:       vec2<f32>,
  time:       f32,
  speed:      f32,
  scale:      f32,
  warp:       f32,
  crack:      f32,
  detail:     f32,
  heat:       f32,
  grain:      f32,
  vignette:   f32,
  rockColor:  vec4<f32>,
  emberColor: vec4<f32>,
  midColor:   vec4<f32>,
  hotColor:   vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn moHash(pIn: vec2<f32>) -> f32 {
  var p = fract(pIn * vec2<f32>(123.34, 456.21));
  p = p + vec2<f32>(dot(p, p + vec2<f32>(45.32)));
  return fract(p.x * p.y);
}

fn moNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = moHash(i);
  let b = moHash(i + vec2<f32>(1.0, 0.0));
  let c = moHash(i + vec2<f32>(0.0, 1.0));
  let d = moHash(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn moFbm(pIn: vec2<f32>, octaves: i32) -> f32 {
  var p = pIn;
  var sum: f32 = 0.0;
  var amp: f32 = 0.5;
  var norm: f32 = 0.0;
  let rot = mat2x2<f32>(0.80, 0.60, -0.60, 0.80);
  for (var i: i32 = 0; i < 5; i = i + 1) {
    if (i >= octaves) { break; }
    sum = sum + amp * moNoise(p);
    norm = norm + amp;
    amp = amp * 0.5;
    p = rot * p * 2.03;
  }
  return sum / max(norm, 0.0001);
}

fn moRidge(value: f32, sharpness: f32) -> f32 {
  let r = 1.0 - abs(value * 2.0 - 1.0);
  return pow(clamp(r, 0.0, 1.0), sharpness);
}

fn moltenAnim(uv01: vec2<f32>) -> vec4<f32> {
  let t = u.time * u.speed;

  var p = uv01 - vec2<f32>(0.5);
  p.x = p.x * (u.size.x / max(u.size.y, 1.0));
  p = p * max(u.scale, 0.0001);
  p.y = p.y + t * 0.06;

  let w = vec2<f32>(moFbm(p * 1.1 + vec2<f32>(0.0, t * 0.08), 4),
                    moFbm(p * 1.1 + vec2<f32>(7.7, -t * 0.06), 4));
  let q = p + u.warp * (w - vec2<f32>(0.5));

  let body  = moFbm(q * 1.5, 5);
  let veins = moRidge(moFbm(q * 2.2 + vec2<f32>(3.1), 5), max(u.crack, 0.0001));
  let fine  = moRidge(moFbm(q * 5.0 + vec2<f32>(11.0), 4), max(u.detail, 0.0001));

  var lava = veins * 1.3 + fine * 0.6;
  lava = lava * (0.55 + 0.75 * body);
  lava = lava + 0.10 * smoothstep(0.55, 1.0, body);
  lava = lava * u.heat;

  let shade = 0.35 + 0.65 * moFbm(q * 4.0 + vec2<f32>(21.0), 3);

  var c = u.rockColor.rgb * shade;
  c = mix(c, u.emberColor.rgb, clamp(lava * 1.1, 0.0, 1.0));
  c = mix(c, u.midColor.rgb,   clamp(lava - 0.55, 0.0, 1.0));
  c = mix(c, u.hotColor.rgb,   clamp(lava - 1.15, 0.0, 1.0));
  c = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));

  let d = uv01 - vec2<f32>(0.5);
  c = c * (1.0 - 0.85 * u.vignette * dot(d, d));
  c = c + (moHash(uv01 * 900.0 + vec2<f32>(t)) - 0.5) * 0.015 * u.grain;

  return vec4<f32>(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
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
  return moltenAnim(in.uv);
}
`;

const UNIFORMS = new Float32Array([
    0.0, 0.0,
    0.0,
    1.0,
    2.6,
    1.4,
    6.0,
    14.0,
    1.0,
    1.0,
    1.0,
    0.0,
    0.05882353, 0.03137255, 0.03137255, 1.0,
    0.8509804, 0.14117648, 0.019607844, 1.0,
    1.0, 0.5176471, 0.0627451, 1.0,
    1.0, 0.9490196, 0.72156864, 1.0,
]);

const SIZE_WORD = 0;
const TIME_WORD = 2;
const ANIMATED = true;
const CLEAR_ALPHA = 1;
export default function MoltenView() {
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
