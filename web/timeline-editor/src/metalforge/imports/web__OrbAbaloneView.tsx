"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:           vec2<f32>,
  time:           f32,
  speed:          f32,
  radius:         f32,
  swirl:          f32,
  thickness:      f32,
  bands:          f32,
  grooves:        f32,
  glow:           f32,
  exposure:       f32,
  spectrum:       f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  tintColor:      vec4<f32>,
  shellColor:     vec4<f32>,
  sheenColor:     vec4<f32>,
  bloomColor:     vec4<f32>,
  bounceColor:    vec4<f32>,
  wallColor:      vec4<f32>,
  wallTintColor:  vec4<f32>,
  lampColor:      vec4<f32>,
  fillColor:      vec4<f32>,
  keyColor:       vec4<f32>,
  irisColor:      vec4<f32>,
  irisTintColor:  vec4<f32>,
  shellTintColor: vec4<f32>,
  specColor:      vec4<f32>,
  filmColor:      vec4<f32>,
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

fn abSstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn abHash(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

fn abNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = abHash(i);
  let b = abHash(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = abHash(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = abHash(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = abHash(i + vec3<f32>(0.0, 0.0, 1.0));
  let g = abHash(i + vec3<f32>(1.0, 0.0, 1.0));
  let j = abHash(i + vec3<f32>(0.0, 1.0, 1.0));
  let k = abHash(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

fn abFbm(pIn: vec3<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * abNoise(p);
    p = p * 2.03 + vec3<f32>(7.1, 3.7, 1.3);
    a = a * 0.5;
  }
  return v;
}

fn abAces(x: vec3<f32>) -> vec3<f32> {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14),
               vec3<f32>(0.0), vec3<f32>(1.0));
}

fn abRotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

fn abStudioBG(p: vec2<f32>, wallC: vec3<f32>, wallT: vec3<f32>,
              lampC: vec3<f32>, fillC: vec3<f32>) -> vec3<f32> {
  var wall = mix(wallC * 0.0112, wallT * 0.0027, smoothstep(-0.55, 1.25, p.y));
  let s1 = (p - vec2<f32>(-0.80, 0.74)) * vec2<f32>(1.00, 1.65);
  wall = wall + lampC * 0.0270 * exp(-dot(s1, s1) * 1.30);
  let s2 = (p - vec2<f32>(0.94, 0.14)) * vec2<f32>(1.30, 2.05);
  wall = wall + fillC * 0.0135 * exp(-dot(s2, s2) * 1.85);
  return wall;
}

fn abEnvMirror(uv: vec2<f32>, R: vec3<f32>, keyP: f32, keyI: f32,
               wallC: vec3<f32>, wallT: vec3<f32>, lampC: vec3<f32>, fillC: vec3<f32>,
               keyC: vec3<f32>, irisC: vec3<f32>, irisT: vec3<f32>,
               sheen: vec3<f32>, bloom: vec3<f32>, bounce: vec3<f32>) -> vec3<f32> {
  let L1 = normalize(vec3<f32>(-0.60, 0.64, 0.48));
  var e = abStudioBG(uv * 0.55 + R.xy * 0.72, wallC, wallT, lampC, fillC) * 7.5;
  e = e + keyC * pow(max(dot(R, L1), 0.0), keyP) * keyI;
  e = e + sheen * pow(max(dot(R, L1), 0.0), 22.0) * 0.55;
  e = e + bloom * pow(max(dot(R, L1), 0.0), 4.0) * 0.30;
  e = e + mix(irisC, irisT, 0.5 + 0.5 * R.x) * pow(1.0 - abs(R.y), 3.0) * 0.42;
  e = e + bounce * abSstep(0.2, -0.9, R.y) * 0.16;
  return e;
}

fn orbAbaloneAnim(uv01: vec2<f32>) -> vec4<f32> {
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let t    = u.time * u.speed;
  let rad  = max(u.radius, 0.05);
  let tint = u.tintColor.rgb;

  let wallC = u.wallColor.rgb;
  let wallT = u.wallTintColor.rgb;
  let lampC = u.lampColor.rgb;
  let fillC = u.fillColor.rgb;

  let su = (uv - vec2<f32>(0.0, 0.06)) / rad;
  let r  = length(su);

  var col = abStudioBG(uv, wallC, wallT, lampC, fillC);
  col = col + tint * exp(-max(r - 1.0, 0.0) * 11.0) * 0.045 * u.glow;

  if (r < 1.004 + mfEdgeD(u.edgeSoftness)) {
    let m = abSstep(1.0 + mfEdgeD(u.edgeSoftness), 1.0 - u.edgeSoftness, r);
    let z = sqrt(max(1.0 - r * r, 0.0));
    let N = vec3<f32>(su, z);
    let V = vec3<f32>(0.0, 0.0, 1.0);
    let L = normalize(vec3<f32>(-0.58, 0.62, 0.52));

    let d  = abRotY(N, t * 0.035);
    let g  = abFbm(d * 2.4 + vec3<f32>(0.0, t * 0.03, 0.0));
    let sw = abFbm(d * 4.8 + vec3<f32>(g * u.swirl));

    let bnd = sin((d.x + d.y * 0.7) * u.bands + sw * 8.0) * 0.5 + 0.5;
    let th  = 0.9 + g * u.thickness + sw * 1.5 + (1.0 - z) * 1.2;
    let baseF = vec3<f32>(1.0, 1.45, 1.88);
    let freq  = vec3<f32>(1.0) + (baseF - vec3<f32>(1.0)) * u.spectrum;
    let pal = mfRampOf(u.paletteCount,
                       u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                       u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                       u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                       u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb);

    let nac0 = select(vec3<f32>(0.5) - 0.5 * cos(6.2831853 * th * freq),
                      mfRampCycR(th, pal), u.paletteCount > 0.5);
    let nac = mix(nac0, nac0.gbr, bnd * 0.45) * u.filmColor.rgb;

    let ridge = pow(1.0 - abs(sw - 0.5) * 2.0, u.grooves);
    let body  = mix(u.shellTintColor.rgb * 0.07, u.shellColor.rgb, g);
    let lam   = 0.30 + 0.70 * max(dot(N, L), 0.0);

    var c = body * lam;
    c = c + nac * (0.30 + 0.55 * pow(1.0 - z, 1.6) + 0.45 * ridge) * 1.35 * u.glow;
    c = c + nac * pow(max(dot(N, normalize(L + V)), 0.0), 14.0) * 0.9;
    c = c * (1.0 - ridge * 0.35);
    c = c + u.specColor.rgb * pow(max(dot(N, normalize(L + V)), 0.0), 260.0) * 1.3;
    c = c + abEnvMirror(uv, reflect(-V, N), 800.0, 5.5,
                        wallC, wallT, lampC, fillC,
                        u.keyColor.rgb, u.irisColor.rgb, u.irisTintColor.rgb,
                        u.sheenColor.rgb, u.bloomColor.rgb, u.bounceColor.rgb) * nac * 0.30;
    c = c * (0.32 + 0.68 * smoothstep(-0.95, 0.33, N.y));
    c = c * (0.35 + 0.65 * u.glow);
    col = mix(col, c, m);
  }

  col = pow(abAces(col * max(u.exposure, 0.0)), vec3<f32>(1.0 / 2.2));
  let edged = mfEdgeGlow(col, uv, vec2<f32>(0.0, 0.06), rad,
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
  let c = orbAbaloneAnim(in.uv);

  let fc = vec2<f32>(in.uv.x, 1.0 - in.uv.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);
  let rad = max(u.radius, 0.05);

  let d = length(uv - vec2<f32>(0.0000, 0.0600));
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
    0.6,
    2.6,
    2.0,
    7.0,
    5.0,
    1.0,
    1.0,
    1.0,
    0.005,
    0.0,
    0.0,
    0.0,
    0.3019608, 0.8509804, 0.8, 1.0,
    0.101960786, 0.12941177, 0.14117648, 1.0,
    0.9019608, 0.9490196, 1.0, 1.0,
    0.72156864, 0.81960785, 1.0, 1.0,
    0.9490196, 0.61960787, 0.41960785, 1.0,
    0.7137255, 0.76862746, 1.0, 1.0,
    0.5921569, 0.5921569, 1.0, 1.0,
    0.7764706, 0.8156863, 1.0, 1.0,
    0.5921569, 0.68235296, 1.0, 1.0,
    1.0, 0.98039216, 0.9411765, 1.0,
    0.101960786, 0.25882354, 0.7019608, 1.0,
    0.61960787, 0.2, 0.8, 1.0,
    0.6431373, 0.85882354, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    0.3019608, 0.8509804, 0.8, 1.0,
    0.0, 0.0, 0.0, 1.0,
    0.14509805, 0.2901961, 0.45490196, 1.0,
    0.49803922, 0.8235294, 0.99215686, 1.0,
    0.85490197, 0.98039216, 0.6392157, 1.0,
    1.0, 0.5764706, 0.03529412, 1.0,
    0.85490197, 0.08235294, 0.27450982, 1.0,
    0.5019608, 0.07450981, 0.92156863, 1.0,
    0.14509805, 0.5568628, 0.80784315, 1.0,
    0.14509805, 0.5568628, 0.80784315, 1.0,
    0.14509805, 0.5568628, 0.80784315, 1.0,
    0.14509805, 0.5568628, 0.80784315, 1.0,
    0.14509805, 0.5568628, 0.80784315, 1.0,
]);

const SIZE_WORD = 0;
const TIME_WORD = 2;
const ANIMATED = true;
const CLEAR_ALPHA = 0;
export default function OrbAbaloneView() {
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
