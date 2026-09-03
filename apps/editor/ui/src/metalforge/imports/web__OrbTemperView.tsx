"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:          vec2<f32>,
  time:          f32,
  speed:         f32,
  radius:        f32,
  terraces:      f32,
  facet:         f32,
  oxide:         f32,
  heat:          f32,
  iridescence:   f32,
  glow:          f32,
  exposure:      f32,
  spectrum:      f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  tintColor:     vec4<f32>,
  metalColor:    vec4<f32>,
  sheenColor:    vec4<f32>,
  bloomColor:    vec4<f32>,
  bounceColor:   vec4<f32>,
  wallColor:     vec4<f32>,
  wallTintColor: vec4<f32>,
  lampColor:     vec4<f32>,
  fillColor:     vec4<f32>,
  glintColor:    vec4<f32>,
  bandColor:     vec4<f32>,
  bandTintColor: vec4<f32>,
  ambientColor:  vec4<f32>,
  filmBaseColor: vec4<f32>,
  specularColor: vec4<f32>,
  filmColor:     vec4<f32>,
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

fn tmSstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn tmHash(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

fn tmNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = tmHash(i);
  let b = tmHash(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = tmHash(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = tmHash(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = tmHash(i + vec3<f32>(0.0, 0.0, 1.0));
  let g = tmHash(i + vec3<f32>(1.0, 0.0, 1.0));
  let j = tmHash(i + vec3<f32>(0.0, 1.0, 1.0));
  let k = tmHash(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

fn tmFbm(pIn: vec3<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * tmNoise(p);
    p = p * 2.03 + vec3<f32>(7.1, 3.7, 1.3);
    a = a * 0.5;
  }
  return v;
}

fn tmAces(x: vec3<f32>) -> vec3<f32> {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14),
               vec3<f32>(0.0), vec3<f32>(1.0));
}

fn tmSchlick(ct: f32, f0: f32) -> f32 {
  return f0 + (1.0 - f0) * pow(max(1.0 - ct, 0.0), 5.0);
}

fn tmRotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

fn tmStudioBG(p: vec2<f32>, wallA: vec3<f32>, wallB: vec3<f32>,
              lamp: vec3<f32>, fill: vec3<f32>) -> vec3<f32> {
  var wall = mix(wallA, wallB, smoothstep(-0.55, 1.25, p.y));
  let s1 = (p - vec2<f32>(-0.80, 0.74)) * vec2<f32>(1.00, 1.65);
  wall = wall + lamp * exp(-dot(s1, s1) * 1.30);
  let s2 = (p - vec2<f32>(0.94, 0.14)) * vec2<f32>(1.30, 2.05);
  wall = wall + fill * exp(-dot(s2, s2) * 1.85);
  return wall;
}

fn tmEnvMirror(uv: vec2<f32>, R: vec3<f32>,
               wallA: vec3<f32>, wallB: vec3<f32>, lamp: vec3<f32>, fill: vec3<f32>,
               glint: vec3<f32>, sheen: vec3<f32>, bloom: vec3<f32>, bounce: vec3<f32>,
               band: vec3<f32>, bandT: vec3<f32>, irid: f32) -> vec3<f32> {
  let L1 = normalize(vec3<f32>(-0.60, 0.64, 0.48));
  var e = tmStudioBG(uv * 0.55 + R.xy * 0.72, wallA, wallB, lamp, fill) * 7.5;
  e = e + glint * pow(max(dot(R, L1), 0.0), 900.0) * 6.5;
  e = e + sheen * pow(max(dot(R, L1), 0.0), 22.0) * 0.55;
  e = e + bloom * pow(max(dot(R, L1), 0.0), 4.0) * 0.30;
  e = e + mix(band, bandT, 0.5 + 0.5 * R.x)
        * pow(1.0 - abs(R.y), 3.0) * 0.42 * irid;
  e = e + bounce * tmSstep(0.2, -0.9, R.y) * 0.16;
  return e;
}

fn tmTerf(d: vec3<f32>) -> f32 {
  return tmFbm(d * 2.6) * 1.45 + tmFbm(d * 5.6) * 0.45;
}

fn orbTemperAnim(uv01: vec2<f32>) -> vec4<f32> {
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let t    = u.time * u.speed;
  let rad  = max(u.radius, 0.05);
  let tint = u.tintColor.rgb;

  let wallA = u.wallColor.rgb     * 0.0112;
  let wallB = u.wallTintColor.rgb * 0.0027;
  let lamp  = u.lampColor.rgb     * 0.0270;
  let fill  = u.fillColor.rgb     * 0.0135;
  let amb   = u.ambientColor.rgb  * 0.032;

  let su = (uv - vec2<f32>(0.0, 0.06)) / rad;
  let r  = length(su);

  var col = tmStudioBG(uv, wallA, wallB, lamp, fill);
  col = col + tint * exp(-max(r - 1.0, 0.0) * 11.0) * 0.045 * u.glow;

  if (r < 1.004 + mfEdgeD(u.edgeSoftness)) {
    let m = tmSstep(1.0 + mfEdgeD(u.edgeSoftness), 1.0 - u.edgeSoftness, r);
    let z = sqrt(max(1.0 - r * r, 0.0));
    let N = vec3<f32>(su, z);
    let V = vec3<f32>(0.0, 0.0, 1.0);

    let d   = tmRotY(N, t * 0.032);
    let f   = tmTerf(d);
    let lev = floor(f * u.terraces);
    let stp = fract(f * u.terraces);

    let jn = vec3<f32>(tmHash(vec3<f32>(lev * 3.1, 7.7, 1.3)),
                       tmHash(vec3<f32>(lev * 3.1, 2.2, 9.9)),
                       tmHash(vec3<f32>(lev * 3.1, 5.5, 4.4))) - vec3<f32>(0.5);
    let fnrm = normalize(N + jn * u.facet);
    let edge = tmSstep(0.07, 0.0, stp) + smoothstep(0.93, 1.0, stp);

    let ph    = fract(t * 0.042);
    let front = sqrt(ph) * 3.0;
    let hotd  = normalize(vec3<f32>(-0.34, -1.0, 0.22));
    let ang   = acos(clamp(dot(d, hotd), -1.0, 1.0));
    let q  = (ang - front) / max(u.heat, 0.02);
    var Tt = exp(-q * q) * (1.0 - ph * 0.30);
    Tt = Tt + exp(-ang * 1.6) * (1.0 - ph) * 0.45;

    let ox    = 16.0 + u.oxide * clamp(Tt, 0.0, 1.2) + 26.0 * tmFbm(d * 7.0);
    let baseW = vec3<f32>(612.0, 548.0, 462.0);
    let wl    = vec3<f32>(612.0) + (baseW - vec3<f32>(612.0)) * u.spectrum;
    let pal = mfRampOf(u.paletteCount,
                       u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                       u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                       u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                       u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb);

    let film  = select(vec3<f32>(0.5) - 0.5 * cos(vec3<f32>(12.5663706 * 2.55 * ox) / wl),
                       mfRampCycR(ox / 120.0, pal), u.paletteCount > 0.5)
                * u.filmColor.rgb;

    let ndv = max(dot(fnrm, V), 0.0);
    let fr  = tmSchlick(ndv, 0.62);
    let R   = reflect(-V, fnrm);
    let env = tmEnvMirror(uv, R, wallA, wallB, lamp, fill,
                          u.glintColor.rgb, u.sheenColor.rgb,
                          u.bloomColor.rgb, u.bounceColor.rgb,
                          u.bandColor.rgb, u.bandTintColor.rgb, u.iridescence);

    var c = env * mix(u.metalColor.rgb,
                      film * 1.35 + u.filmBaseColor.rgb, 0.62) * fr;
    c = c + amb
          * (0.4 + 0.9 * max(dot(fnrm, normalize(vec3<f32>(-0.60, 0.64, 0.48))), 0.0));
    c = c + film * edge * (0.30 + 0.75 * Tt) * 1.15 * u.glow;
    c = c + u.specularColor.rgb
          * pow(max(dot(fnrm, normalize(normalize(vec3<f32>(-0.60, 0.64, 0.48)) + V)), 0.0), 260.0) * 2.2;
    c = c + film * pow(1.0 - ndv, 3.2) * 0.85;
    c = c * (0.30 + 0.70 * smoothstep(-0.95, 0.30, fnrm.y));
    c = c * (0.35 + 0.65 * u.glow);
    col = mix(col, c, m);
  }

  col = pow(tmAces(col * max(u.exposure, 0.0)), vec3<f32>(1.0 / 2.2));
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
  let c = orbTemperAnim(in.uv);

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
    7.0,
    0.42,
    150.0,
    0.62,
    1.0,
    1.0,
    1.0,
    1.0,
    0.005,
    0.0,
    0.0,
    0.72156864, 0.6, 1.0, 1.0,
    0.72156864, 0.7019608, 0.7411765, 1.0,
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
    0.9372549, 0.8745098, 1.0, 1.0,
    0.21960784, 0.21960784, 0.21960784, 1.0,
    1.0, 1.0, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    0.72156864, 0.6, 1.0, 1.0,
    0.0, 0.0, 0.0, 1.0,
    0.14509805, 0.18039216, 0.24705882, 1.0,
    0.49803922, 0.5921569, 0.74509805, 1.0,
    0.85490197, 0.9372549, 1.0, 1.0,
    1.0, 0.96862745, 0.7607843, 1.0,
    0.85490197, 0.65882355, 0.26666668, 1.0,
    0.5019608, 0.23921569, 0.0, 1.0,
    0.14509805, 0.003921569, 0.23137255, 1.0,
    0.14509805, 0.003921569, 0.23137255, 1.0,
    0.14509805, 0.003921569, 0.23137255, 1.0,
    0.14509805, 0.003921569, 0.23137255, 1.0,
    0.14509805, 0.003921569, 0.23137255, 1.0,
]);

const SIZE_WORD = 0;
const TIME_WORD = 2;
const ANIMATED = true;
const CLEAR_ALPHA = 0;
export default function OrbTemperView() {
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
