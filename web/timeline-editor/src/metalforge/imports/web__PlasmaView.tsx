"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:       vec2<f32>,
  time:       f32,
  style:      f32,
  c1:         vec4<f32>,
  c2:         vec4<f32>,
  c3:         vec4<f32>,
  c4:         vec4<f32>,
  c5:         vec4<f32>,
  scale:      f32,
  intensity:  f32,
  distortion: f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn paHash21(pIn: vec2<f32>) -> f32 {
  let p = vec2<f32>(dot(pIn, vec2<f32>(91.31, 47.79)),
                    dot(pIn, vec2<f32>(31.07, 73.13)));
  return fract(sin(p.x + p.y) * 19357.713);
}

fn paVnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = paHash21(i);
  let b = paHash21(i + vec2<f32>(1.0, 0.0));
  let c = paHash21(i + vec2<f32>(0.0, 1.0));
  let d = paHash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn paFbm2(p: vec2<f32>) -> f32 {
  var v = paVnoise(p) * 0.6;
  v = v + paVnoise(p * 2.0) * 0.4;
  return v - 0.5;
}

fn paFbm3(p: vec2<f32>) -> f32 {
  var v = paVnoise(p) * 0.5;
  v = v + paVnoise(p * 2.0) * 0.3;
  v = v + paVnoise(p * 4.0) * 0.2;
  return v - 0.5;
}

fn paPal5(tIn: f32, c1: vec3<f32>, c2: vec3<f32>, c3: vec3<f32>, c4: vec3<f32>, c5: vec3<f32>) -> vec3<f32> {
  let t = clamp(tIn, 0.0, 1.0);
  if (t < 0.25) { return mix(c1, c2, smoothstep(0.0, 0.25, t)); }
  if (t < 0.5)  { return mix(c2, c3, smoothstep(0.25, 0.5, t)); }
  if (t < 0.75) { return mix(c3, c4, smoothstep(0.5, 0.75, t)); }
  return mix(c4, c5, smoothstep(0.75, 1.0, t));
}

fn paPrism(pp: vec2<f32>, d: vec2<f32>, t: f32, distortion: f32) -> f32 {
  return sin(dot(pp, d) * 3.0 + paFbm2(pp * 1.5) * distortion * 3.0 + t * 0.4);
}

fn paSpectrum(pp: vec2<f32>, d: vec2<f32>, t: f32, distortion: f32) -> f32 {
  return sin(dot(pp, d) * 2.4 + paFbm3(pp * 1.3 + t * 0.07) * distortion * 4.0 + t * 0.45);
}

fn plasmaAnim(uv01: vec2<f32>) -> vec4<f32> {
  let res    = u.size;
  let aspect = res.x / res.y;
  var p      = uv01 - vec2<f32>(0.5);
  p.x        = p.x * aspect;
  p          = p * u.scale;

  let time   = u.time;
  let styleI = i32(u.style);
  let cc1    = u.c1.rgb;
  let cc2    = u.c2.rgb;
  let cc3    = u.c3.rgb;
  let cc4    = u.c4.rgb;
  let cc5    = u.c5.rgb;

  if (styleI == 1) {
    let a  = time * 0.3;
    let d  = vec2<f32>(cos(a), sin(a));
    let v1 = paPrism(p + vec2<f32>( 0.025, 0.0), d, time, u.distortion);
    let v2 = paPrism(p,                          d, time, u.distortion);
    let v3 = paPrism(p + vec2<f32>(-0.025, 0.0), d, time, u.distortion);
    let ca = paPal5(v1 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    let cb = paPal5(v2 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    let cc = paPal5(v3 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    let col = vec3<f32>(ca.r, cb.g, cc.b) * u.intensity;
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.5)), 1.0);
  }
  if (styleI == 2) {
    let a  = time * 0.22 + 1.57;
    let d  = vec2<f32>(cos(a), sin(a));
    let v1 = paSpectrum(p + vec2<f32>(0.0,  0.045), d, time, u.distortion);
    let v2 = paSpectrum(p,                          d, time, u.distortion);
    let v3 = paSpectrum(p + vec2<f32>(0.0, -0.045), d, time, u.distortion);
    let ca = paPal5(v1 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    let cb = paPal5(v2 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    let cc = paPal5(v3 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    let col = vec3<f32>(ca.r, cb.g, cc.b) * u.intensity * 1.15;
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.6)), 1.0);
  }
  if (styleI == 3) {
    let pp = p * 1.3;
    var v: f32 = 0.0;
    v = v + sin(pp.x * 2.5 + time * 0.6);
    v = v + sin(pp.y * 3.0 + time * 0.8);
    v = v + sin(length(pp) * 2.0 - time * 0.5);
    v = v + paFbm3(pp * 2.0 + vec2<f32>(time * 0.18)) * u.distortion * 3.0;
    v = (v + 4.0) * 0.125;
    v = pow(clamp(v, 0.0, 1.0), 1.6) * u.intensity;
    var col = paPal5(v, cc1, cc2, cc3, cc4, cc5);
    col = col + vec3<f32>(pow(v, 6.0) * 0.55);
    return vec4<f32>(col, 1.0);
  }
  if (styleI == 4) {
    let t      = time * 0.7;
    let breath = 0.5 + 0.5 * sin(time * 0.5);
    var v: f32 = 0.0;
    v = v + sin(p.x * 1.8 + t);
    v = v + sin(p.y * 2.2 + t * 1.1);
    v = v + sin((p.x + p.y) * 1.0 + t * 0.8);
    v = v + paFbm3(p * 1.5 + vec2<f32>(t * 0.15)) * u.distortion * 2.0;
    v = (v + 3.5) * 0.143;
    v = clamp(v * u.intensity * (0.7 + 0.6 * breath), 0.0, 1.0);
    var col = paPal5(v, cc1, cc2, cc3, cc4, cc5);
    col = col + vec3<f32>(pow(v, 4.0) * 0.35 * breath);
    return vec4<f32>(col, 1.0);
  }

  var v: f32 = 0.0;
  v = v + sin(p.x * 2.1 + time * 0.7);
  v = v + sin(p.y * 2.5 + time * 0.9);
  v = v + sin((p.x + p.y) * 1.4 + time * 0.5);
  v = v + paFbm3(p * 2.0 + vec2<f32>(time * 0.18)) * u.distortion * 2.0;
  v = (v + 4.0) * 0.125;
  v = clamp(v * u.intensity, 0.0, 1.0);
  var col = paPal5(v, cc1, cc2, cc3, cc4, cc5);
  col = col + vec3<f32>(pow(v, 4.0) * 0.4);
  return vec4<f32>(col, 1.0);
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
  return plasmaAnim(in.uv);
}
`;

const UNIFORMS = new Float32Array([
    0.0, 0.0,
    0.0,
    0.0,
    0.101960786, 0.019607844, 0.0, 1.0,
    0.3529412, 0.07058824, 0.03137255, 1.0,
    0.76862746, 0.2901961, 0.1254902, 1.0,
    0.9411765, 0.5411765, 0.22745098, 1.0,
    1.0, 0.77254903, 0.47843137, 1.0,
    1.0,
    1.0,
    1.0,
    0.0,
]);

const SIZE_WORD = 0;
const TIME_WORD = 2;
const ANIMATED = true;
const CLEAR_ALPHA = 1;
export default function PlasmaView() {
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
