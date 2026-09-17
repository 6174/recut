"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:           vec2<f32>,
  time:           f32,
  speed:          f32,
  radius:         f32,
  spikes:         f32,
  sharpness:      f32,
  relief:         f32,
  flank:          f32,
  glow:           f32,
  exposure:       f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  bodyColor:      vec4<f32>,
  aquaColor:      vec4<f32>,
  violetColor:    vec4<f32>,
  magentaColor:   vec4<f32>,
  amberColor:     vec4<f32>,
  bodyTintColor:  vec4<f32>,
  specularColor:  vec4<f32>,
  highlightColor: vec4<f32>,
  glowColor:      vec4<f32>,
  paletteStop0:    vec4<f32>,
  paletteStop1:    vec4<f32>,
  paletteStop2:    vec4<f32>,
  paletteStop3:    vec4<f32>,
  paletteStop4:    vec4<f32>,
  paletteStop5:    vec4<f32>,
  paletteStop6:    vec4<f32>,
  paletteStop7:    vec4<f32>,
  paletteStop8:    vec4<f32>,
  paletteStop9:    vec4<f32>,
  paletteStop10:   vec4<f32>,
  paletteStop11:   vec4<f32>,
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

fn ffSstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn ffHash(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

fn ffNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = ffHash(i);
  let b = ffHash(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = ffHash(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = ffHash(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = ffHash(i + vec3<f32>(0.0, 0.0, 1.0));
  let g = ffHash(i + vec3<f32>(1.0, 0.0, 1.0));
  let j = ffHash(i + vec3<f32>(0.0, 1.0, 1.0));
  let k = ffHash(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

fn ffFbm(pIn: vec3<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * ffNoise(p);
    p = p * 2.03 + vec3<f32>(7.1, 3.7, 1.3);
    a = a * 0.5;
  }
  return v;
}

fn ffRidge(p: vec3<f32>, k: f32) -> f32 {
  return pow(1.0 - abs(ffFbm(p) - 0.5) * 2.0, k);
}

fn ffKnead(t: f32, a: f32, b: f32, c: f32, ph: f32) -> vec3<f32> {
  return vec3<f32>(sin(t * a) + 0.55 * sin(t * a * 0.41 + ph),
                   cos(t * b) + 0.55 * cos(t * b * 0.37 + ph * 1.7),
                   sin(t * c + ph * 2.3));
}

fn ffSch(ct: f32, f0: f32) -> f32 {
  return f0 + (1.0 - f0) * pow(max(1.0 - ct, 0.0), 5.0);
}

fn ffEnv(d: vec3<f32>, t: f32, cA: vec3<f32>, cB: vec3<f32>, cC: vec3<f32>, cD: vec3<f32>) -> vec3<f32> {
  let p0 = normalize(vec3<f32>(sin(t * 0.088 + 0.0), 0.65 * sin(t * 0.068 + 0.0), cos(t * 0.096 + 0.0)));
  let p1 = normalize(vec3<f32>(sin(t * 0.101 + 2.1), 0.65 * sin(t * 0.079 + 2.7), cos(t * 0.113 + 1.5)));
  let p2 = normalize(vec3<f32>(sin(t * 0.114 + 4.3), 0.65 * sin(t * 0.090 + 5.6), cos(t * 0.130 + 3.0)));
  let p3 = normalize(vec3<f32>(sin(t * 0.127 + 1.2), 0.65 * sin(t * 0.101 + 1.6), cos(t * 0.147 + 0.8)));
  let w0 = exp(4.8 * (dot(d, p0) - 1.0));
  let w1 = exp(4.8 * (dot(d, p1) - 1.0));
  let w2 = exp(4.8 * (dot(d, p2) - 1.0));
  let w3 = exp(4.8 * (dot(d, p3) - 1.0));
  return (w0 * cA + w1 * cB + w2 * cC + w3 * cD) / (w0 + w1 + w2 + w3 + 1e-4);
}

fn ffAces(x: vec3<f32>) -> vec3<f32> {
  return clamp((x * (2.51 * x + vec3<f32>(0.03))) / (x * (2.43 * x + vec3<f32>(0.59)) + vec3<f32>(0.14)),
               vec3<f32>(0.0), vec3<f32>(1.0));
}

fn orbFerrofluidAnim(uv01: vec2<f32>) -> vec4<f32> {
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let t   = u.time * u.speed;
  let rad = max(u.radius, 0.05);
  let r   = length(uv);

  let cA = u.aquaColor.rgb;
  let cB = u.violetColor.rgb;
  let cC = u.magentaColor.rgb;
  let cD = u.amberColor.rgb;

  var col = ffEnv(normalize(vec3<f32>(uv, 0.5)), t, cA, cB, cC, cD)
          * exp(-max(r - rad, 0.0) * 8.0) * 0.12 * u.glow;

  if (r < rad + 0.01 + mfEdgeD(u.edgeSoftness)) {
    let m  = ffSstep(rad + mfEdgeD(u.edgeSoftness), rad - u.edgeSoftness, r);
    let su = uv / rad;
    let z  = sqrt(max(1.0 - dot(su, su), 0.0));
    let N  = vec3<f32>(su, z);
    let V  = vec3<f32>(0.0, 0.0, 1.0);

    let w = N * u.spikes + ffKnead(t, 0.18, 0.14, 0.11, 2.6) * 0.7;

    let e  = 0.05;
    let gr = vec3<f32>(ffRidge(w + vec3<f32>(e, 0.0, 0.0), u.sharpness) - ffRidge(w - vec3<f32>(e, 0.0, 0.0), u.sharpness),
                       ffRidge(w + vec3<f32>(0.0, e, 0.0), u.sharpness) - ffRidge(w - vec3<f32>(0.0, e, 0.0), u.sharpness),
                       ffRidge(w + vec3<f32>(0.0, 0.0, e), u.sharpness) - ffRidge(w - vec3<f32>(0.0, 0.0, e), u.sharpness));
    let gt = gr - N * dot(gr, N);
    let Nn = normalize(N - gt * u.relief);

    let spk = ffRidge(w, u.sharpness);
    let ndv = max(dot(Nn, V), 0.0);
    let fr  = ffSch(ndv, 0.90);
    let R   = reflect(-V, Nn);

    var env = ffEnv(R, t, cA, cB, cC, cD) * (0.16 + 0.84 * smoothstep(-1.0, 1.0, R.y));
    let K   = normalize(vec3<f32>(-0.55, 0.62, 0.56));
    let k   = max(dot(R, K), 0.0);
    let spc = u.specularColor.rgb;
    env = env + spc * pow(k, 420.0) * 7.0 + spc * pow(k, 26.0) * 0.28;
    env = env * (1.0 - 0.58 * ffSstep(-0.15, -1.0, R.y));

    let pal = mfRampOf(u.paletteCount,
                       u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                       u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                       u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                       u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb);

    var c = env * select(mix(u.bodyColor.rgb, u.bodyTintColor.rgb, fr),
                         mfRampLinR(fr, pal), u.paletteCount > 0.5);
    c = c + ffEnv(Nn, t, cA, cB, cC, cD) * pow(spk, 2.0) * pow(1.0 - ndv, 1.5) * u.flank;
    c = c + u.highlightColor.rgb * pow(max(dot(Nn, normalize(K + V)), 0.0), 300.0) * 3.2;
    c = c * (0.30 + 0.70 * smoothstep(-0.9, 0.45, Nn.y));
    c = c * (0.35 + 0.65 * u.glow);
    col = mix(col, c, m);
  }

  col = pow(ffAces(col * max(u.exposure, 0.0)), vec3<f32>(1.0 / 2.2));
  let edged = mfEdgeGlow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), uv, vec2<f32>(0.0), rad,
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
  let c = orbFerrofluidAnim(in.uv);

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
    1.0,
    0.7,
    3.4,
    3.0,
    2.6,
    0.85,
    1.0,
    1.0,
    0.005,
    0.0,
    0.0,
    0.0, 0.0,
    0.2, 0.21176471, 0.23921569, 1.0,
    0.2, 0.9019608, 0.9490196, 1.0,
    0.54901963, 0.34901962, 1.0, 1.0,
    1.0, 0.3019608, 0.7490196, 1.0,
    0.9490196, 0.7490196, 0.2509804, 1.0,
    0.9490196, 0.9607843, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    0.2, 0.9019608, 0.9490196, 1.0,
    0.2, 0.21176471, 0.23921569, 1.0,
    0.30588236, 0.31764707, 0.34901962, 1.0,
    0.41568628, 0.42745098, 0.45490196, 1.0,
    0.52156866, 0.53333336, 0.5647059, 1.0,
    0.627451, 0.6392157, 0.6745098, 1.0,
    0.73333335, 0.74509805, 0.78431374, 1.0,
    0.84313726, 0.85490197, 0.8901961, 1.0,
    0.9490196, 0.9607843, 1.0, 1.0,
    0.9490196, 0.9607843, 1.0, 1.0,
    0.9490196, 0.9607843, 1.0, 1.0,
    0.9490196, 0.9607843, 1.0, 1.0,
    0.9490196, 0.9607843, 1.0, 1.0,
]);

const SIZE_WORD = 0;
const TIME_WORD = 2;
const ANIMATED = true;
const CLEAR_ALPHA = 0;
export default function OrbFerrofluidView() {
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
