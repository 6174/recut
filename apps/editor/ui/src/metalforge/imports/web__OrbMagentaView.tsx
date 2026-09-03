"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:         vec2<f32>,
  time:         f32,
  speed:        f32,
  radius:       f32,
  flow:         f32,
  turbulence:   f32,
  scale:        f32,
  marble:       f32,
  wobble:       f32,
  shimmer:      f32,
  refraction:   f32,
  contrast:     f32,
  bias:         f32,
  fringe:       f32,
  iridescence:  f32,
  rim:          f32,
  glint:        f32,
  innerGlow:    f32,
  halo:         f32,
  grain:        f32,
  seed:         f32,
  exposure:     f32,
  edgeSoftness: f32,
  edgeGlow:     f32,
  paletteCount: f32,
  light:        vec2<f32>,
  colorA:       vec4<f32>,
  colorB:       vec4<f32>,
  rimColor:     vec4<f32>,
  glintColor:   vec4<f32>,
  iridColor:    vec4<f32>,
  glowColor:    vec4<f32>,
  paletteStop0:  vec4<f32>,
  paletteStop1:  vec4<f32>,
  paletteStop2:  vec4<f32>,
  paletteStop3:  vec4<f32>,
  paletteStop4:  vec4<f32>,
  paletteStop5:  vec4<f32>,
  paletteStop6:  vec4<f32>,
  paletteStop7:  vec4<f32>,
  paletteStop8:  vec4<f32>,
  paletteStop9:  vec4<f32>,
  paletteStop10: vec4<f32>,
  paletteStop11: vec4<f32>,
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

const LQO_PI2: f32 = 6.28318530718;

const LQO_LOOP:  f32 = 7.0;
const LQO_SOFT:  f32 = 1.4;
const LQO_GRAIN: f32 = 0.055;

fn lqoHash(pIn: vec2<f32>) -> f32 {
  var p = fract(pIn * vec2<f32>(127.1, 311.7));
  p = p + vec2<f32>(dot(p, p + vec2<f32>(34.56)));
  return fract(p.x * p.y);
}

fn lqoNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(lqoHash(i), lqoHash(i + vec2<f32>(1.0, 0.0)), w.x),
             mix(lqoHash(i + vec2<f32>(0.0, 1.0)), lqoHash(i + vec2<f32>(1.0, 1.0)), w.x),
             w.y);
}

fn lqoFbm(pIn: vec2<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * lqoNoise(p);
    p = vec2<f32>(1.6 * p.x - 1.2 * p.y, 1.2 * p.x + 1.6 * p.y);
    a = a * 0.5;
  }
  return v;
}

fn lqoSrgb(cIn: vec3<f32>) -> vec3<f32> {
  let c = clamp(cIn, vec3<f32>(0.0), vec3<f32>(1.0));
  return mix(12.92 * c,
             1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055),
             step(vec3<f32>(0.0031308), c));
}

fn lqoOkl(cs: vec3<f32>) -> vec3<f32> {
  let hi = pow((cs + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  let lo = cs / 12.92;
  let lin = mix(hi, lo, step(cs, vec3<f32>(0.04045)));
  let l = pow(dot(vec3<f32>(0.4122214708, 0.5363325363, 0.0514459929), lin), 1.0 / 3.0);
  let m = pow(dot(vec3<f32>(0.2119034982, 0.6806995451, 0.1073969566), lin), 1.0 / 3.0);
  let s = pow(dot(vec3<f32>(0.0883024619, 0.2817188376, 0.6299787005), lin), 1.0 / 3.0);
  return vec3<f32>(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
                   1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                   0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}

fn lqoLab2Lin(c: vec3<f32>) -> vec3<f32> {
  let l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  let m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  let s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  let L = vec3<f32>(l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_);
  return vec3<f32>(dot(vec3<f32>( 4.0767416621, -3.3077115913,  0.2309699292), L),
                   dot(vec3<f32>(-1.2684380046,  2.6097574011, -0.7034186147), L),
                   dot(vec3<f32>(-0.0041960863, -0.7034186147,  1.7076147010), L));
}

fn lqoPal(x: f32, A: vec3<f32>, B: vec3<f32>) -> vec3<f32> {
  let s = clamp(x, 0.0, 1.0);
  let f = s * s * (3.0 - 2.0 * s);
  let c = mix(A, B, f);
  let k = 1.0 + 0.5 * f * (1.0 - f);
  return vec3<f32>(c.x, c.y * k, c.z * k);
}

fn orbMagentaAnim(uv01: vec2<f32>) -> vec4<f32> {
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let mn = max(min(u.size.x, u.size.y), 1.0);
  let uv = (2.0 * fc - u.size) / mn;

  let R0 = max(u.radius, 0.05);
  let rr = length(uv);

  let px = 2.0 / mn;
  let aa = px * max(1.25, LQO_SOFT);
  let haloOuter = R0 + 0.125;

  let rMax = max(R0 * (1.0 + u.wobble * 0.044) + aa, haloOuter) + mfEdgeD(u.edgeSoftness);
  if (rr > rMax) {
    return vec4<f32>(clamp(mfEdgeGlow(vec3<f32>(0.0), uv, vec2<f32>(0.0), R0,
                                      u.edgeSoftness, u.edgeGlow, u.glowColor.rgb),
                           vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
  }

  let ph  = fract(u.time * u.speed / LQO_LOOP);
  let ANG = LQO_PI2 * ph;

  let th  = atan2(uv.y, uv.x);
  let wob = u.wobble * (0.020 * sin(3.0 * th - ANG + 0.7)
                      + 0.014 * sin(5.0 * th + 2.0 * ANG + 2.1)
                      + 0.010 * sin(7.0 * th - 3.0 * ANG + 4.4));
  let Rl  = R0 * (1.0 + wob);

  let sN = rr / Rl;
  let z  = sqrt(max(1.0 - sN * sN, 0.0));
  let pn = uv / Rl;
  let pu = normalize(pn + vec2<f32>(1e-5, 0.0));
  let Ld = normalize(u.light);

  let q0 = pn * mix(1.0, 0.55 + 0.45 * z, u.refraction * 0.8);
  let q  = q0 + vec2<f32>(u.seed * 11.17, u.seed * 5.31);

  let ph1 = LQO_PI2 * lqoFbm(q * 1.05 + vec2<f32>(3.7, 17.3));
  let am1 = 0.55 + 0.9 * lqoFbm(q * 0.85 + vec2<f32>(27.1, 9.4));
  let o1  = u.flow * am1 * vec2<f32>(cos(ANG + ph1), sin(ANG + ph1));
  let ph2 = LQO_PI2 * lqoFbm(q * 2.7 + vec2<f32>(43.9, 5.2));
  let am2 = 0.45 + 0.9 * lqoFbm(q * 3.1 + vec2<f32>(8.8, 31.7));
  let o2  = u.turbulence * am2 * vec2<f32>(cos(ph2 - ANG), sin(ph2 - ANG));
  let wp  = (q + o1 + o2) * u.scale;
  let n1  = lqoFbm(wp + u.marble * vec2<f32>(lqoFbm(wp + vec2<f32>(5.2, 1.3)),
                                             lqoFbm(wp + vec2<f32>(9.7, 8.1))));

  let x = (n1 - 0.5) * u.contrast + 0.5 + u.bias;

  let shim = u.shimmer * sin(ANG + LQO_PI2 * lqoFbm(q * 0.75 + vec2<f32>(61.3, 2.9)));
  let cs = cos(shim);
  let sn = sin(shim);

  let band = smoothstep(0.45, 1.0, sN);
  let fr   = u.fringe * band;

  let shade = 0.045 * sN * dot(pu, Ld);
  let gp    = -Ld * 0.40;
  let glow  = u.innerGlow * exp(-dot(pn - gp, pn - gp) * 2.6);
  let ib    = clamp(u.iridescence * smoothstep(0.55, 0.95, sN)
                    * (0.6 + 0.4 * sin(2.0 * th + ANG)), 0.0, 1.0);

  let pal = mfRampOf(u.paletteCount,
                     u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                     u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                     u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                     u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb);
  let oklA = lqoOkl(u.colorA.rgb);
  let oklB = lqoOkl(u.colorB.rgb);
  let iridAB = lqoOkl(u.iridColor.rgb).yz;

  var lin = vec3<f32>(0.0);
  let off0 = -0.05 * fr;
  let off2 =  0.05 * fr;

  var L3 = lqoPal(x + off0, oklA, oklB);
  L3 = select(L3, lqoOkl(mfRampLinR(x + off0, pal)), u.paletteCount > 0.5);
  L3 = vec3<f32>(L3.x, cs * L3.y - sn * L3.z, sn * L3.y + cs * L3.z);
  L3 = vec3<f32>(L3.x + shade + 0.10 * glow + 0.04 * ib, L3.y, L3.z);
  L3 = vec3<f32>(L3.x, L3.y * (1.0 - 0.45 * glow), L3.z * (1.0 - 0.45 * glow));
  L3 = vec3<f32>(L3.x, mix(L3.y, iridAB.x, ib), mix(L3.z, iridAB.y, ib));
  lin.x = lqoLab2Lin(L3).x;

  L3 = lqoPal(x, oklA, oklB);
  L3 = select(L3, lqoOkl(mfRampLinR(x, pal)), u.paletteCount > 0.5);
  L3 = vec3<f32>(L3.x, cs * L3.y - sn * L3.z, sn * L3.y + cs * L3.z);
  L3 = vec3<f32>(L3.x + shade + 0.10 * glow + 0.04 * ib, L3.y, L3.z);
  L3 = vec3<f32>(L3.x, L3.y * (1.0 - 0.45 * glow), L3.z * (1.0 - 0.45 * glow));
  L3 = vec3<f32>(L3.x, mix(L3.y, iridAB.x, ib), mix(L3.z, iridAB.y, ib));
  lin.y = lqoLab2Lin(L3).y;

  L3 = lqoPal(x + off2, oklA, oklB);
  L3 = select(L3, lqoOkl(mfRampLinR(x + off2, pal)), u.paletteCount > 0.5);
  L3 = vec3<f32>(L3.x, cs * L3.y - sn * L3.z, sn * L3.y + cs * L3.z);
  L3 = vec3<f32>(L3.x + shade + 0.10 * glow + 0.04 * ib, L3.y, L3.z);
  L3 = vec3<f32>(L3.x, L3.y * (1.0 - 0.45 * glow), L3.z * (1.0 - 0.45 * glow));
  L3 = vec3<f32>(L3.x, mix(L3.y, iridAB.x, ib), mix(L3.z, iridAB.y, ib));
  lin.z = lqoLab2Lin(L3).z;

  let eSc = vec3<f32>(1.0) + u.fringe * vec3<f32>(0.006, 0.0, -0.006);
  let aEdge = 1.0 - smoothstep(-aa - mfEdgeD(u.edgeSoftness),
                                aa + mfEdgeD(u.edgeSoftness), rr - Rl);
  let rim3 = u.rim * vec3<f32>(pow(smoothstep(0.55, 1.0, rr / (Rl * eSc.x)), 4.0),
                               pow(smoothstep(0.55, 1.0, rr / (Rl * eSc.y)), 4.0),
                               pow(smoothstep(0.55, 1.0, rr / (Rl * eSc.z)), 4.0));

  let nrm  = vec3<f32>(pn.x, pn.y, z);
  let H    = normalize(vec3<f32>(Ld * 0.85, 0.55));
  let spec = pow(max(dot(nrm, H), 0.0), 48.0) * u.glint * (0.4 + 0.6 * z);
  lin = lin + rim3 * u.rimColor.rgb + spec * u.glintColor.rgb;

  var col = lqoSrgb(max(lin * max(u.exposure, 0.0), vec3<f32>(0.0)));

  let grainF = floor(ph * 24.0);
  let g = lqoHash(floor(fc) + vec2<f32>(grainF * 17.13, grainF * 7.77)) - 0.5;
  col = col + vec3<f32>(g * LQO_GRAIN * u.grain);

  let w = clamp(1.0 - (rr - Rl) / max(haloOuter - Rl, 1e-4), 0.0, 1.0);
  let haloA = select(0.0, u.halo * 0.85 * pow(w, 2.4), u.halo > 0.001 && rr > Rl);
  var hc = lqoOkl(u.colorA.rgb);
  hc = vec3<f32>(min(1.0, hc.x + 0.12), hc.y * 0.85, hc.z * 0.85);
  let haloRGB = lqoSrgb(max(lqoLab2Lin(hc), vec3<f32>(0.0)));

  var out = col * aEdge + haloRGB * (haloA * (1.0 - aEdge));
  out = mfEdgeGlow(out, uv, vec2<f32>(0.0), R0,
                   u.edgeSoftness, u.edgeGlow, u.glowColor.rgb);
  return vec4<f32>(clamp(out, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
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
  let c = orbMagentaAnim(in.uv);

  let fc = vec2<f32>(in.uv.x, 1.0 - in.uv.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);
  let rad = max(u.radius, 0.05);

  let d = length(uv - vec2<f32>(0.0, 0.0));
  let soft = max(u.edgeSoftness - 0.005, 0.0);
  let rr = max(rad * (1.0 - (u.wobble * 0.0440)) - 0.005, 0.04);
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
    0.86,
    0.3,
    0.15,
    1.35,
    1.7,
    0.0,
    0.1,
    0.55,
    1.25,
    -0.04,
    0.8,
    0.0,
    0.9,
    0.5,
    0.55,
    0.0,
    1.0,
    0.0,
    1.0,
    0.005,
    0.0,
    0.0,
    -0.62, -0.78,
    0.9490196, 0.3529412, 0.92941177, 1.0,
    1.0, 1.0, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    0.31764707, 0.18431373, 0.49803922, 1.0,
    0.9490196, 0.3529412, 0.92941177, 1.0,
    0.9490196, 0.3529412, 0.92941177, 1.0,
    0.9607843, 0.3882353, 0.9411765, 1.0,
    0.9882353, 0.48235294, 0.96862745, 1.0,
    1.0, 0.6156863, 0.9882353, 1.0,
    1.0, 0.75686276, 0.99607843, 1.0,
    1.0, 0.88235295, 0.99607843, 1.0,
    1.0, 0.96862745, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
]);

const SIZE_WORD = 0;
const TIME_WORD = 2;
const ANIMATED = true;
const CLEAR_ALPHA = 0;
export default function OrbMagentaView() {
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
