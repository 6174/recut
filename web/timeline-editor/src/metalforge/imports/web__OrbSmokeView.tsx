"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:         vec2<f32>,
  time:         f32,
  speed:        f32,
  radius:       f32,
  density:      f32,
  detail:       f32,
  shadow:       f32,
  scatter:      f32,
  glow:         f32,
  exposure:     f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  tint:         vec4<f32>,
  keyColor:     vec4<f32>,
  fillColor:    vec4<f32>,
  rimColor:     vec4<f32>,
  wallColor:    vec4<f32>,
  wallTint:     vec4<f32>,
  lampColor:    vec4<f32>,
  bounceColor:  vec4<f32>,
  specColor:    vec4<f32>,
  softboxColor: vec4<f32>,
  hiColor:      vec4<f32>,
  edgeColor:    vec4<f32>,
  albedoColor:  vec4<f32>,
  albedoTint:   vec4<f32>,
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

fn smSstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn smHash(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

fn smNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = smHash(i);
  let b = smHash(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = smHash(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = smHash(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = smHash(i + vec3<f32>(0.0, 0.0, 1.0));
  let g = smHash(i + vec3<f32>(1.0, 0.0, 1.0));
  let j = smHash(i + vec3<f32>(0.0, 1.0, 1.0));
  let k = smHash(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

fn smFbm(pIn: vec3<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * smNoise(p);
    p = p * 2.03 + vec3<f32>(7.1, 3.7, 1.3);
    a = a * 0.5;
  }
  return v;
}

fn smFbm2(p: vec3<f32>) -> f32 {
  return smNoise(p) * 0.62 + smNoise(p * 2.07 + vec3<f32>(7.1, 3.3, 1.7)) * 0.31;
}

fn smHg(ct: f32, g: f32) -> f32 {
  let gg = g * g;
  let d = 1.0 + gg - 2.0 * g * ct;
  return (1.0 - gg) / (12.5664 * d * sqrt(max(d, 1e-4)));
}

fn smAces(x: vec3<f32>) -> vec3<f32> {
  return clamp((x * (2.51 * x + vec3<f32>(0.03))) / (x * (2.43 * x + vec3<f32>(0.59)) + vec3<f32>(0.14)),
               vec3<f32>(0.0), vec3<f32>(1.0));
}

fn smSphExit(p: vec3<f32>, d: vec3<f32>) -> f32 {
  let b = dot(p, d);
  return -b + sqrt(max(1.0 - dot(p, p) + b * b, 0.0));
}

fn smKnead(t: f32, a: f32, b: f32, c: f32, ph: f32) -> vec3<f32> {
  return vec3<f32>(sin(t * a) + 0.55 * sin(t * a * 0.41 + ph),
                   cos(t * b) + 0.55 * cos(t * b * 0.37 + ph * 1.7),
                   sin(t * c + ph * 2.3));
}

fn smSchlick(ct: f32, f0: f32) -> f32 {
  return f0 + (1.0 - f0) * pow(max(1.0 - ct, 0.0), 5.0);
}

fn smStudioBG(p: vec2<f32>, wallC: vec3<f32>, wallT: vec3<f32>,
              lampC: vec3<f32>, bounceC: vec3<f32>) -> vec3<f32> {
  var wall = mix(wallC, wallT, smoothstep(-0.55, 1.25, p.y));
  let s1 = (p - vec2<f32>(-0.80, 0.74)) * vec2<f32>(1.00, 1.65);
  wall = wall + lampC * exp(-dot(s1, s1) * 1.30);
  let s2 = (p - vec2<f32>(0.94, 0.14)) * vec2<f32>(1.30, 2.05);
  wall = wall + bounceC * exp(-dot(s2, s2) * 1.85);
  return wall;
}

fn smBgThrough(uv: vec2<f32>, N: vec3<f32>, wallC: vec3<f32>, wallT: vec3<f32>,
               lampC: vec3<f32>, bounceC: vec3<f32>) -> vec3<f32> {
  let d1 = refract(vec3<f32>(0.0, 0.0, -1.0), N, 1.0 / 1.500);
  let d2 = refract(vec3<f32>(0.0, 0.0, -1.0), N, 1.0 / 1.524);
  let d3 = refract(vec3<f32>(0.0, 0.0, -1.0), N, 1.0 / 1.552);
  return vec3<f32>(smStudioBG(uv + d1.xy * 1.15, wallC, wallT, lampC, bounceC).r,
                   smStudioBG(uv + d2.xy * 1.15, wallC, wallT, lampC, bounceC).g,
                   smStudioBG(uv + d3.xy * 1.15, wallC, wallT, lampC, bounceC).b) * 2.6;
}

fn smGlassHi(N: vec3<f32>, su: vec2<f32>, z: f32, rimC: vec3<f32>, specC: vec3<f32>,
             softC: vec3<f32>, hiC: vec3<f32>, edgeC: vec3<f32>) -> vec3<f32> {
  let V = vec3<f32>(0.0, 0.0, 1.0);
  let L1 = normalize(vec3<f32>(-0.62, 0.60, 0.50));
  let L2 = normalize(vec3<f32>(0.66, 0.16, 0.72));
  let H1 = normalize(L1 + V);
  let H2 = normalize(L2 + V);
  let k = max(dot(N, H1), 0.0);
  var c = specC * (pow(k, 420.0) * 2.8 + pow(k, 46.0) * 0.11);
  let sb = (su - vec2<f32>(-0.44, 0.46)) * vec2<f32>(2.0, 4.4);
  c = c + softC * exp(-dot(sb, sb) * 2.2) * 0.26;
  c = c + hiC * pow(max(dot(N, H2), 0.0), 120.0) * 0.34;
  let e = smoothstep(0.86, 1.0, length(su));
  c = c + rimC * e * pow(1.0 - z, 1.6) * 0.26;
  c = c + edgeC * pow(smoothstep(0.972, 1.0, length(su)), 0.75) * 0.26;
  return c;
}

fn smSmk(p: vec3<f32>, t: f32, density: f32, detail: f32) -> f32 {
  let k = smKnead(t, 0.16, 0.13, 0.10, 1.4) * 0.40;
  let g = smFbm(p * 1.85 + k);
  let w = smFbm(p * detail + vec3<f32>(g * 1.85) + k.zxy * 0.6);
  return pow(smoothstep(0.30, 0.76, w), 1.5) * smSstep(1.0, 0.66, length(p)) * density;
}

fn smSmkLo(p: vec3<f32>, t: f32, density: f32, detail: f32) -> f32 {
  let k = smKnead(t, 0.16, 0.13, 0.10, 1.4) * 0.40;
  let w = smFbm2(p * detail + vec3<f32>(smFbm2(p * 1.85 + k) * 1.85) + k.zxy * 0.6);
  return pow(smoothstep(0.30, 0.76, w), 1.5) * smSstep(1.0, 0.66, length(p)) * density;
}

fn orbSmokeAnim(uv01: vec2<f32>) -> vec4<f32> {
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let t   = u.time * u.speed;
  let rad = max(u.radius, 0.05);
  let tn  = u.tint.rgb;

  let wallC   = u.wallColor.rgb   * 0.0112;
  let wallT   = u.wallTint.rgb    * 0.0027;
  let lampC   = u.lampColor.rgb   * 0.0270;
  let bounceC = u.bounceColor.rgb * 0.0135;

  let su = (uv - vec2<f32>(0.0, 0.06)) / rad;
  let r  = length(su);

  var col = smStudioBG(uv, wallC, wallT, lampC, bounceC);
  col = col + tn * exp(-max(r - 1.0, 0.0) * 7.0) * 0.05 * u.glow;

  if (r < 1.004 + mfEdgeD(u.edgeSoftness)) {
    let m = smSstep(1.0 + mfEdgeD(u.edgeSoftness), 1.0 - u.edgeSoftness, r);
    let z = sqrt(max(1.0 - r * r, 0.0));
    let N = vec3<f32>(su, z);
    let F = smSchlick(z, 0.045);
    let D = refract(vec3<f32>(0.0, 0.0, -1.0), N, 1.0 / 1.52);
    let bg = smBgThrough(uv, N, wallC, wallT, lampC, bounceC);

    let P0 = N * 0.997;
    let len = smSphExit(P0, D);
    let L = normalize(vec3<f32>(-0.60, 0.62, 0.50));
    let ph = smHg(dot(D, L), clamp(u.scatter, 0.0, 0.95)) * 1.1 + 0.30;

    let pal = mfRampOf(u.paletteCount,
                       u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                       u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                       u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                       u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb);

    let albC = u.albedoColor.rgb;
    let albT = u.albedoTint.rgb;
    let keyC = u.keyColor.rgb;
    let filC = u.fillColor.rgb;

    var acc = vec3<f32>(0.0);
    var T: f32 = 1.0;
    let NS: i32 = 16;
    let dl = len / f32(NS);
    for (var i: i32 = 0; i < NS; i = i + 1) {
      let p = P0 + D * ((f32(i) + 0.5) * dl);
      let d = smSmk(p, t, u.density, u.detail);
      if (d > 0.012) {
        let sh = exp(-(smSmkLo(p + L * 0.17, t, u.density, u.detail) * 1.0
                     + smSmkLo(p + L * 0.42, t, u.density, u.detail) * 0.65) * u.shadow);
        let aa = 1.0 - exp(-d * 3.4 * dl);
        let lit = keyC * sh * ph * 1.8 + filC * 0.42;
        let albT01 = clamp(d * 0.5, 0.0, 1.0);
        let alb = select(mix(albC, albT, albT01),
                         mfRampLinR(albT01, pal), u.paletteCount > 0.5);
        acc = acc + T * alb * lit * aa;
        T   = T * (1.0 - aa * 0.93);
      }
    }

    var inner = acc + bg * T;
    inner = inner * exp(-pow(1.0 - z, 2.0) * 0.60);
    var c = inner * (1.0 - F) * (0.35 + 0.65 * u.glow);
    c = c + smGlassHi(N, su, z, u.rimColor.rgb, u.specColor.rgb,
                      u.softboxColor.rgb, u.hiColor.rgb, u.edgeColor.rgb);
    col = mix(col, c, m);
  }

  col = pow(smAces(col * max(u.exposure, 0.0)), vec3<f32>(1.0 / 2.2));
  let edged = mfEdgeGlow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), uv, vec2<f32>(0.0, 0.06), rad,
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
  let c = orbSmokeAnim(in.uv);

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
    1.7,
    1.2,
    1.7,
    0.42,
    1.0,
    1.0,
    0.005,
    0.0,
    0.0,
    0.0, 0.0,
    1.0, 0.6, 0.3019608, 1.0,
    1.0, 0.8392157, 0.6313726, 1.0,
    0.16078432, 0.21960784, 0.52156866, 1.0,
    0.6, 0.7607843, 1.0, 1.0,
    0.7137255, 0.76862746, 1.0, 1.0,
    0.5921569, 0.5921569, 1.0, 1.0,
    0.7764706, 0.8156863, 1.0, 1.0,
    0.5921569, 0.68235296, 1.0, 1.0,
    1.0, 0.99607843, 0.9882353, 1.0,
    0.9490196, 0.96862745, 1.0, 1.0,
    0.81960785, 0.9019608, 1.0, 1.0,
    0.8509804, 0.92156863, 1.0, 1.0,
    0.45882353, 0.4392157, 0.54901963, 1.0,
    0.8784314, 0.8392157, 0.92156863, 1.0,
    1.0, 0.6, 0.3019608, 1.0,
    0.45882353, 0.4392157, 0.54901963, 1.0,
    0.5176471, 0.49803922, 0.6039216, 1.0,
    0.5803922, 0.5529412, 0.654902, 1.0,
    0.6392157, 0.6117647, 0.70980394, 1.0,
    0.69803923, 0.6666667, 0.7607843, 1.0,
    0.75686276, 0.7254902, 0.8156863, 1.0,
    0.81960785, 0.78039217, 0.8666667, 1.0,
    0.8784314, 0.8392157, 0.92156863, 1.0,
    0.8784314, 0.8392157, 0.92156863, 1.0,
    0.8784314, 0.8392157, 0.92156863, 1.0,
    0.8784314, 0.8392157, 0.92156863, 1.0,
    0.8784314, 0.8392157, 0.92156863, 1.0,
]);

const SIZE_WORD = 0;
const TIME_WORD = 2;
const ANIMATED = true;
const CLEAR_ALPHA = 0;
export default function OrbSmokeView() {
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
