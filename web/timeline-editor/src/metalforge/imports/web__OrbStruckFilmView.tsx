"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:      vec2<f32>,
  time:      f32,
  speed:     f32,
  radius:    f32,
  detail:    f32,
  ripple:    f32,
  impact:    f32,
  rim:       f32,
  glow:      f32,
  exposure:  f32,
  spectrum:  f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  haloColor: vec4<f32>,
  deepColor: vec4<f32>,
  bodyColor: vec4<f32>,
  rimColor:  vec4<f32>,
  rimTint:   vec4<f32>,
  specColor: vec4<f32>,
  filmColor: vec4<f32>,
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

fn sfSstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn sfHash(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

fn sfNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = sfHash(i);
  let b = sfHash(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = sfHash(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = sfHash(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = sfHash(i + vec3<f32>(0.0, 0.0, 1.0));
  let g = sfHash(i + vec3<f32>(1.0, 0.0, 1.0));
  let j = sfHash(i + vec3<f32>(0.0, 1.0, 1.0));
  let k = sfHash(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

fn sfFbm(pIn: vec3<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * sfNoise(p);
    p = p * 2.03 + vec3<f32>(7.1, 3.7, 1.3);
    a = a * 0.5;
  }
  return v;
}

fn sfInterf(th: f32, ca: f32, spec: f32) -> vec3<f32> {
  let d = th * (1.0 + (1.0 - ca) * 0.9);
  let baseF = vec3<f32>(1.0, 1.31, 1.68);
  let freq  = vec3<f32>(1.0) + (baseF - vec3<f32>(1.0)) * spec;
  return vec3<f32>(0.5) - 0.5 * cos(6.2831 * d * freq);
}

fn sfDropPt(seed: f32) -> vec3<f32> {
  let a = fract(sin(seed * 12.9898) * 43758.5453) * 6.2831;
  let b = fract(sin(seed * 39.3468) * 24634.6345) * 1.7 - 0.85;
  let s = sqrt(max(1.0 - b * b, 0.0));
  return vec3<f32>(s * cos(a), b, s * sin(a));
}

fn orbStruckFilmAnim(uv01: vec2<f32>) -> vec4<f32> {
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let t   = u.time * u.speed;
  let rad = max(u.radius, 0.05);
  let r   = length(uv);

  var col = u.haloColor.rgb * exp(-max(r - rad, 0.0) * 12.0) * 0.30 * u.glow;

  let m   = sfSstep(rad + mfEdgeD(u.edgeSoftness), rad - u.edgeSoftness, r);
  let z   = sqrt(max(rad * rad - r * r, 0.0));
  let nrm = vec3<f32>(uv, z) / rad;
  let ca  = nrm.z;

  let o1 = vec3<f32>(sin(t * 0.16) + 0.6 * sin(t * 0.071 + 1.3),
                     cos(t * 0.13) + 0.6 * cos(t * 0.062 + 0.8),
                     sin(t * 0.10 + 3.1)) * 0.5;
  let base = sfFbm(nrm * u.detail + o1) * 1.5;
  var th   = base + sin(t * 0.12) * 0.3;

  var ringE: f32 = 0.0;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    let fi   = f32(i);
    let per  = 7.0 + fi * 2.3;
    let ph   = t / per + fi * 0.41;
    let lt   = fract(ph);
    let seed = floor(ph) * 3.7 + fi * 11.0;
    let cp   = sfDropPt(seed);
    let d    = acos(clamp(dot(nrm, cp), -1.0, 1.0));
    let R    = lt * 2.4;
    let amp  = exp(-lt * 2.6) * smoothstep(0.0, 0.05, lt);
    th    = th + cos((d - R) * u.ripple) * exp(-abs(d - R) * (4.5 - 2.5 * lt)) * amp * u.impact;
    ringE = max(ringE, exp(-abs(d - R) * 9.0) * amp);
  }

  let crease = clamp(fwidth(th) * 6.0, 0.0, 1.0);
  let film   = sfInterf(th, ca, u.spectrum) * u.filmColor.rgb;
  let fres   = pow(1.0 - ca, 2.1);
  let glint  = pow(crease, 1.5) * (0.25 + 1.8 * fres) + ringE * 0.95;

  let pal = mfRampOf(u.paletteCount,
                     u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                     u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                     u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                     u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb);

  let bodyT = smoothstep(-0.9, 1.0, uv.x * 0.4 - uv.y * 0.5 + base * 0.5);
  let deep = select(mix(u.deepColor.rgb, u.bodyColor.rgb, bodyT),
                    mfRampLinR(bodyT, pal), u.paletteCount > 0.5);
  let rimc = mix(u.rimColor.rgb, u.rimTint.rgb,
                 smoothstep(-0.8, 0.8, uv.x + uv.y * 0.3));

  var c2 = deep;
  c2 = c2 + film * glint * u.glow;
  c2 = c2 + film * fres * fres * 0.5 * u.glow;
  c2 = c2 + rimc * fres * u.rim;
  c2 = c2 + u.specColor.rgb * pow(glint * fres, 2.5) * 3.0;
  col = mix(col, c2, m);

  col = vec3<f32>(1.0) - exp(-col * 1.8 * max(u.exposure, 0.0));
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
  let c = orbStruckFilmAnim(in.uv);

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
    0.75,
    1.6,
    24.0,
    1.1,
    1.15,
    1.0,
    1.0,
    1.0,
    0.005,
    0.0,
    0.0,
    0.0,
    0.050980393, 0.050980393, 0.21960784, 1.0,
    0.007843138, 0.007843138, 0.043137256, 1.0,
    0.07058824, 0.03137255, 0.21960784, 1.0,
    0.101960786, 0.4, 1.0, 1.0,
    0.8509804, 0.2509804, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    0.101960786, 0.4, 1.0, 1.0,
    0.007843138, 0.007843138, 0.043137256, 1.0,
    0.019607844, 0.011764706, 0.078431375, 1.0,
    0.03137255, 0.015686275, 0.11372549, 1.0,
    0.047058824, 0.023529412, 0.14901961, 1.0,
    0.05882353, 0.02745098, 0.18431373, 1.0,
    0.07058824, 0.03137255, 0.21960784, 1.0,
    0.07058824, 0.03137255, 0.21960784, 1.0,
    0.07058824, 0.03137255, 0.21960784, 1.0,
    0.07058824, 0.03137255, 0.21960784, 1.0,
    0.07058824, 0.03137255, 0.21960784, 1.0,
    0.07058824, 0.03137255, 0.21960784, 1.0,
    0.07058824, 0.03137255, 0.21960784, 1.0,
]);

const SIZE_WORD = 0;
const TIME_WORD = 2;
const ANIMATED = true;
const CLEAR_ALPHA = 0;
export default function OrbStruckFilmView() {
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
