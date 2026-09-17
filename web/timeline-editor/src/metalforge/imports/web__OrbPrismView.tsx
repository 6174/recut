"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:           vec2<f32>,
  time:           f32,
  speed:          f32,
  radius:         f32,
  zoom:           f32,
  warp:           f32,
  spectrum:       f32,
  grain:          f32,
  glow:           f32,
  exposure:       f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  tintColor:      vec4<f32>,
  highlightColor: vec4<f32>,
  haloColor:      vec4<f32>,
  haloTintColor:  vec4<f32>,
  glowColor:      vec4<f32>,
  paletteStop0:   vec4<f32>,
  paletteStop1:   vec4<f32>,
  paletteStop2:   vec4<f32>,
  paletteStop3:   vec4<f32>,
  paletteStop4:   vec4<f32>,
  paletteStop5:   vec4<f32>,
  paletteStop6:   vec4<f32>,
  paletteStop7:   vec4<f32>,
  paletteStop8:   vec4<f32>,
  paletteStop9:   vec4<f32>,
  paletteStop10:  vec4<f32>,
  paletteStop11:  vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn mfEdgeD(soft: f32) -> f32 {
  return soft - 0.005;
}

fn mfEdgeGlow(col: vec3<f32>, uv: vec2<f32>, ctr: vec2<f32>, rad: f32,
              soft: f32, glow: f32, glowRGB: vec3<f32>) -> vec3<f32> {
  if (glow <= 0.0) { return col; }
  let r = length(uv - ctr);
  let outside = smoothstep(rad - max(soft, 0.0005), rad + max(soft, 0.0005), r);
  return col + glowRGB * (glow * exp(-max(r - rad, 0.0) * 11.0) * outside);
}

fn mfRampPick(idx: f32,
              s0: vec3<f32>, s1: vec3<f32>, s2:  vec3<f32>, s3:  vec3<f32>,
              s4: vec3<f32>, s5: vec3<f32>, s6:  vec3<f32>, s7:  vec3<f32>,
              s8: vec3<f32>, s9: vec3<f32>, s10: vec3<f32>, s11: vec3<f32>) -> vec3<f32> {
  var r = s0;
  r = select(r, s1,  idx == 1.0);
  r = select(r, s2,  idx == 2.0);
  r = select(r, s3,  idx == 3.0);
  r = select(r, s4,  idx == 4.0);
  r = select(r, s5,  idx == 5.0);
  r = select(r, s6,  idx == 6.0);
  r = select(r, s7,  idx == 7.0);
  r = select(r, s8,  idx == 8.0);
  r = select(r, s9,  idx == 9.0);
  r = select(r, s10, idx == 10.0);
  r = select(r, s11, idx == 11.0);
  return r;
}

fn mfRampCyc(tIn: f32, n: f32,
             s0: vec3<f32>, s1: vec3<f32>, s2:  vec3<f32>, s3:  vec3<f32>,
             s4: vec3<f32>, s5: vec3<f32>, s6:  vec3<f32>, s7:  vec3<f32>,
             s8: vec3<f32>, s9: vec3<f32>, s10: vec3<f32>, s11: vec3<f32>) -> vec3<f32> {
  let k  = clamp(floor(n + 0.5), 1.0, 12.0);
  let x  = fract(tIn) * k;
  let i0 = min(floor(x), k - 1.0);
  let i1 = select(i0 + 1.0, 0.0, i0 + 1.0 >= k);
  return mix(mfRampPick(i0, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
             mfRampPick(i1, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
             x - i0);
}

fn mfRampLin(tIn: f32, n: f32,
             s0: vec3<f32>, s1: vec3<f32>, s2:  vec3<f32>, s3:  vec3<f32>,
             s4: vec3<f32>, s5: vec3<f32>, s6:  vec3<f32>, s7:  vec3<f32>,
             s8: vec3<f32>, s9: vec3<f32>, s10: vec3<f32>, s11: vec3<f32>) -> vec3<f32> {
  let k  = clamp(floor(n + 0.5), 1.0, 12.0);
  let x  = clamp(tIn, 0.0, 1.0) * (k - 1.0);
  let i0 = clamp(floor(x), 0.0, max(k - 2.0, 0.0));
  return mix(mfRampPick(i0,     s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
             mfRampPick(i0 + 1.0, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
             x - i0);
}

struct MfRamp {
  n:   f32,
  s0:  vec3<f32>, s1:  vec3<f32>, s2:  vec3<f32>, s3:  vec3<f32>,
  s4:  vec3<f32>, s5:  vec3<f32>, s6:  vec3<f32>, s7:  vec3<f32>,
  s8:  vec3<f32>, s9:  vec3<f32>, s10: vec3<f32>, s11: vec3<f32>,
};

fn mfRampOf(n: f32,
            s0: vec3<f32>, s1: vec3<f32>, s2:  vec3<f32>, s3:  vec3<f32>,
            s4: vec3<f32>, s5: vec3<f32>, s6:  vec3<f32>, s7:  vec3<f32>,
            s8: vec3<f32>, s9: vec3<f32>, s10: vec3<f32>, s11: vec3<f32>) -> MfRamp {
  return MfRamp(n, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11);
}

fn mfRampCycR(t: f32, r: MfRamp) -> vec3<f32> {
  return mfRampCyc(t, r.n, r.s0, r.s1, r.s2, r.s3, r.s4, r.s5,
                   r.s6, r.s7, r.s8, r.s9, r.s10, r.s11);
}

fn mfRampLinR(t: f32, r: MfRamp) -> vec3<f32> {
  return mfRampLin(t, r.n, r.s0, r.s1, r.s2, r.s3, r.s4, r.s5,
                   r.s6, r.s7, r.s8, r.s9, r.s10, r.s11);
}

fn prHash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn prNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(prHash(i),                       prHash(i + vec2<f32>(1.0, 0.0)), f.x),
             mix(prHash(i + vec2<f32>(0.0, 1.0)), prHash(i + vec2<f32>(1.0, 1.0)), f.x), f.y);
}

fn prFbm(pIn: vec2<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 5; i = i + 1) {
    v = v + a * prNoise(p);
    p = p * 2.03 + vec2<f32>(1.7, 9.2);
    a = a * 0.55;
  }
  return v;
}

fn prOverlay(b: vec3<f32>, s: vec3<f32>) -> vec3<f32> {
  return mix(2.0 * b * s,
             vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - b) * (vec3<f32>(1.0) - s),
             step(vec3<f32>(0.5), b));
}

fn orbPrismAnim(uv01: vec2<f32>) -> vec4<f32> {
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let rad = max(u.radius, 0.05);

  if (length(uv) > rad * 1.394470) {
    return vec4<f32>(clamp(mfEdgeGlow(vec3<f32>(0.0), uv, vec2<f32>(0.0), rad,
                                      u.edgeSoftness, u.edgeGlow, u.glowColor.rgb),
                           vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
  }

  let t   = u.time * u.speed;
  let p   = uv / rad;
  let d   = length(p);

  let q = vec2<f32>(prFbm(p * 1.6 + vec2<f32>(0.0, t * 0.12)),
                    prFbm(p * 1.6 + vec2<f32>(5.2, t * 0.09)));
  let w  = p * u.zoom + u.warp * (q - vec2<f32>(0.5));
  let m1 = prFbm(w + vec2<f32>(t * 0.06, -t * 0.05));
  let m2 = prFbm(w * 1.7 - vec2<f32>(t * 0.04, t * 0.07));

  let band = m1 * 1.15 + m2 * 0.35 + t * 0.015;

  let ph = vec3<f32>(0.0, 0.33, 0.67) * u.spectrum;
  let spec = select(
    vec3<f32>(0.58) + 0.42 * cos(6.28318 * (vec3<f32>(band) + ph)),
    mfRampCyc(band * u.spectrum, u.paletteCount,
              u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
              u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
              u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
              u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb),
    u.paletteCount > 0.5);
  var col = spec * u.tintColor.rgb;
  col = mix(col, u.highlightColor.rgb,
            vec3<f32>(0.5 * smoothstep(0.1, 1.2, dot(p, vec2<f32>(-0.35, 0.8)))));
  col = col * (1.0 - 0.26 * smoothstep(-0.2, 1.2, dot(p, vec2<f32>(0.45, -0.6))));

  let gn = prHash(p * 900.0);
  col = mix(col, prOverlay(col, vec3<f32>(gn)), vec3<f32>(0.1327 * u.grain));

  let cone1 = vec2<f32>(-0.473118,  0.473118);
  let cone2 = vec2<f32>( 0.473118, -0.473118);
  let a1 = 0.35 * max(1.0 - length(p - cone1) / 1.405090, 0.0);
  let a2 = 0.35 * max(1.0 - length(p - cone2) / 1.405090, 0.0);
  var halo = u.haloColor.rgb * a1 + u.haloTintColor.rgb * a2 * (1.0 - a1);
  halo = halo * ((1.0 - smoothstep(0.971122, 1.394470, d)) * u.glow);

  let ballA = 1.0 - smoothstep(0.99 - mfEdgeD(u.edgeSoftness), 1.0 + mfEdgeD(u.edgeSoftness), d);
  var outc  = col * ballA + halo * (1.0 - ballA);

  outc = clamp(outc * u.exposure, vec3<f32>(0.0), vec3<f32>(1.0));
  let edged = mfEdgeGlow(outc, uv, vec2<f32>(0.0), rad,
                         u.edgeSoftness, u.edgeGlow, u.glowColor.rgb);
  return vec4<f32>(clamp(edged, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
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
  let c = orbPrismAnim(in.uv);

  let fc = vec2<f32>(in.uv.x, 1.0 - in.uv.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);
  let rad = max(u.radius, 0.05);

  let d = length(uv - vec2<f32>(0.0, 0.0));
  let soft = max(u.edgeSoftness - 0.005, 0.0);
  let rr = max(rad * (1.0 - 0.0) - 0.005, 0.04);
  let solid = 1.0 - smoothstep(rr * 0.985 - soft, rr + soft, d);
  let lum = max(c.r, max(c.g, c.b));

  let q = (2.0 * fc - u.size) / u.size;
  let fit = 1.0 - smoothstep(mix(rad, 1.0, 0.5), 1.0, max(abs(q.x), abs(q.y)));

  return vec4<f32>(c.rgb * fit, clamp(max(solid, lum), 0.0, 1.0) * fit);
}
`;

const UNIFORMS = new Float32Array([
    0.0, 0.0,
    0.0,
    1.5,
    0.72,
    1.35,
    3.1,
    1.0,
    1.0,
    1.0,
    1.0,
    0.005,
    0.0,
    0.0,
    0.0, 0.0,
    1.0, 1.0, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    1.0, 0.47058824, 0.7058824, 1.0,
    0.3529412, 0.627451, 1.0, 1.0,
    1.0, 0.47058824, 0.7058824, 1.0,
    1.0, 0.3764706, 0.3764706, 1.0,
    0.8784314, 0.1764706, 0.69803923, 1.0,
    0.5803922, 0.21176471, 0.9490196, 1.0,
    0.28235295, 0.4627451, 0.9843137, 1.0,
    0.16078432, 0.78039217, 0.78039217, 1.0,
    0.28235295, 0.9843137, 0.4627451, 1.0,
    0.5803922, 0.9490196, 0.21176471, 1.0,
    0.8784314, 0.69803923, 0.1764706, 1.0,
    0.8784314, 0.69803923, 0.1764706, 1.0,
    0.8784314, 0.69803923, 0.1764706, 1.0,
    0.8784314, 0.69803923, 0.1764706, 1.0,
    0.8784314, 0.69803923, 0.1764706, 1.0,
]);

const SIZE_WORD = 0;
const TIME_WORD = 2;
const ANIMATED = true;
const CLEAR_ALPHA = 0;
export default function OrbPrismView() {
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
