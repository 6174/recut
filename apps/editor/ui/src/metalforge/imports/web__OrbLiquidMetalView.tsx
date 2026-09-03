"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:          vec2<f32>,
  time:          f32,
  speed:         f32,
  radius:        f32,
  merge:         f32,
  drops:         f32,
  ripple:        f32,
  iridescence:   f32,
  glow:          f32,
  exposure:      f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  tintColor:     vec4<f32>,
  metalColor:    vec4<f32>,
  sheenColor:    vec4<f32>,
  bloomColor:    vec4<f32>,
  bounceColor:   vec4<f32>,
  wallColor:     vec4<f32>,
  wallTopColor:  vec4<f32>,
  lampColor:     vec4<f32>,
  lamp2Color:    vec4<f32>,
  specularColor: vec4<f32>,
  softboxColor:  vec4<f32>,
  glintColor:    vec4<f32>,
  edgeColor:     vec4<f32>,
  rimColor:      vec4<f32>,
  keyColor:      vec4<f32>,
  iriColor:      vec4<f32>,
  iriTintColor:  vec4<f32>,
  fresnelColor:  vec4<f32>,
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

fn lmSstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn lmHash(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

fn lmNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = lmHash(i);
  let b = lmHash(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = lmHash(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = lmHash(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = lmHash(i + vec3<f32>(0.0, 0.0, 1.0));
  let g = lmHash(i + vec3<f32>(1.0, 0.0, 1.0));
  let j = lmHash(i + vec3<f32>(0.0, 1.0, 1.0));
  let k = lmHash(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

fn lmFbm(pIn: vec3<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * lmNoise(p);
    p = p * 2.03 + vec3<f32>(7.1, 3.7, 1.3);
    a = a * 0.5;
  }
  return v;
}

fn lmAces(x: vec3<f32>) -> vec3<f32> {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14),
               vec3<f32>(0.0), vec3<f32>(1.0));
}

fn lmSchlick(ct: f32, f0: f32) -> f32 {
  return f0 + (1.0 - f0) * pow(max(1.0 - ct, 0.0), 5.0);
}

fn lmSmin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn lmSphExit(p: vec3<f32>, d: vec3<f32>) -> f32 {
  let b = dot(p, d);
  return -b + sqrt(max(1.0 - dot(p, p) + b * b, 0.0));
}

fn lmKnead(t: f32, a: f32, b: f32, c: f32, ph: f32) -> vec3<f32> {
  return vec3<f32>(sin(t * a) + 0.55 * sin(t * a * 0.41 + ph),
                   cos(t * b) + 0.55 * cos(t * b * 0.37 + ph * 1.7),
                   sin(t * c + ph * 2.3));
}

fn lmStudioBG(p: vec2<f32>, wall0: vec3<f32>, wall1: vec3<f32>,
              lamp1: vec3<f32>, lamp2: vec3<f32>) -> vec3<f32> {
  var wall = mix(wall0 * 0.0112, wall1 * 0.0027,
                 smoothstep(-0.55, 1.25, p.y));
  let s1 = (p - vec2<f32>(-0.80, 0.74)) * vec2<f32>(1.00, 1.65);
  wall = wall + lamp1 * 0.0270 * exp(-dot(s1, s1) * 1.30);
  let s2 = (p - vec2<f32>(0.94, 0.14)) * vec2<f32>(1.30, 2.05);
  wall = wall + lamp2 * 0.0135 * exp(-dot(s2, s2) * 1.85);
  return wall;
}

fn lmBgThrough(uv: vec2<f32>, N: vec3<f32>, wall0: vec3<f32>, wall1: vec3<f32>,
               lamp1: vec3<f32>, lamp2: vec3<f32>) -> vec3<f32> {
  let d1 = refract(vec3<f32>(0.0, 0.0, -1.0), N, 1.0 / 1.500);
  let d2 = refract(vec3<f32>(0.0, 0.0, -1.0), N, 1.0 / 1.524);
  let d3 = refract(vec3<f32>(0.0, 0.0, -1.0), N, 1.0 / 1.552);
  return vec3<f32>(lmStudioBG(uv + d1.xy * 1.15, wall0, wall1, lamp1, lamp2).r,
                   lmStudioBG(uv + d2.xy * 1.15, wall0, wall1, lamp1, lamp2).g,
                   lmStudioBG(uv + d3.xy * 1.15, wall0, wall1, lamp1, lamp2).b) * 2.6;
}

fn lmGlassHi(N: vec3<f32>, su: vec2<f32>, z: f32, spec: vec3<f32>,
             box: vec3<f32>, glint: vec3<f32>, edgeC: vec3<f32>,
             rimC: vec3<f32>) -> vec3<f32> {
  let V = vec3<f32>(0.0, 0.0, 1.0);
  let L1 = normalize(vec3<f32>(-0.62, 0.60, 0.50));
  let L2 = normalize(vec3<f32>(0.66, 0.16, 0.72));
  let H1 = normalize(L1 + V);
  let H2 = normalize(L2 + V);
  let k = max(dot(N, H1), 0.0);
  var c = spec * (pow(k, 420.0) * 2.8 + pow(k, 46.0) * 0.11);
  let sb = (su - vec2<f32>(-0.44, 0.46)) * vec2<f32>(2.0, 4.4);
  c = c + box * exp(-dot(sb, sb) * 2.2) * 0.26;
  c = c + glint * pow(max(dot(N, H2), 0.0), 120.0) * 0.34;
  let e = smoothstep(0.86, 1.0, length(su));
  c = c + edgeC * e * pow(1.0 - z, 1.6) * 0.26;
  c = c + rimC * pow(smoothstep(0.972, 1.0, length(su)), 0.75) * 0.26;
  return c;
}

fn lmMb(p: vec3<f32>, t: f32, k: f32, drops: f32, ripple: f32) -> f32 {
  var d = length(p - vec3<f32>(sin(t * 0.31) * 0.15, cos(t * 0.26) * 0.13, sin(t * 0.22) * 0.13)) - 0.29 * drops;
  d = lmSmin(d, length(p - vec3<f32>(cos(t * 0.24 + 1.1) * 0.22, sin(t * 0.33 + 0.4) * 0.19, cos(t * 0.29) * 0.15)) - 0.21 * drops, k);
  d = lmSmin(d, length(p - vec3<f32>(sin(t * 0.19 + 2.4) * 0.25, cos(t * 0.21 + 2.0) * 0.23, sin(t * 0.27 + 1.0) * 0.17)) - 0.16 * drops, k * 0.9);
  return d + (lmFbm(p * 3.4 + vec3<f32>(0.0, t * 0.11, 0.0)) - 0.5) * ripple;
}

fn lmMbN(p: vec3<f32>, t: f32, k: f32, drops: f32, ripple: f32) -> vec3<f32> {
  let e = vec2<f32>(0.0035, 0.0);
  return normalize(vec3<f32>(lmMb(p + e.xyy, t, k, drops, ripple) - lmMb(p - e.xyy, t, k, drops, ripple),
                             lmMb(p + e.yxy, t, k, drops, ripple) - lmMb(p - e.yxy, t, k, drops, ripple),
                             lmMb(p + e.yyx, t, k, drops, ripple) - lmMb(p - e.yyx, t, k, drops, ripple)));
}

fn orbLiquidMetalAnim(uv01: vec2<f32>) -> vec4<f32> {
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let t     = u.time * u.speed;
  let rad   = max(u.radius, 0.05);
  let mrg   = max(u.merge, 0.005);
  let tint  = u.tintColor.rgb;
  let wall0 = u.wallColor.rgb;
  let wall1 = u.wallTopColor.rgb;
  let lamp1 = u.lampColor.rgb;
  let lamp2 = u.lamp2Color.rgb;

  let su = (uv - vec2<f32>(0.0, 0.06)) / rad;
  let r  = length(su);

  var col = lmStudioBG(uv, wall0, wall1, lamp1, lamp2);
  col = col + tint * exp(-max(r - 1.0, 0.0) * 7.0) * 0.05 * u.glow;

  if (r < 1.004 + mfEdgeD(u.edgeSoftness)) {
    let m = lmSstep(1.0 + mfEdgeD(u.edgeSoftness), 1.0 - u.edgeSoftness, r);
    let z = sqrt(max(1.0 - r * r, 0.0));
    let N = vec3<f32>(su, z);
    let F = lmSchlick(z, 0.045);
    let D = refract(vec3<f32>(0.0, 0.0, -1.0), N, 1.0 / 1.52);
    let bg = lmBgThrough(uv, N, wall0, wall1, lamp1, lamp2);

    let P0 = N * 0.997;
    let exitT = lmSphExit(P0, D);
    var td: f32 = 0.012;
    var hit: f32 = 0.0;
    var hp = P0;
    for (var i: i32 = 0; i < 40; i = i + 1) {
      hp = P0 + D * td;
      let d = lmMb(hp, t, mrg, u.drops, u.ripple);
      if (d < 0.0028) { hit = 1.0; break; }
      td = td + max(d * 0.85, 0.006);
      if (td > exitT) { break; }
    }

    var inner = bg;
    if (hit > 0.5) {
      let Nm = lmMbN(hp, t, mrg, u.drops, u.ripple);
      let L1 = normalize(vec3<f32>(-0.60, 0.64, 0.48));
      let R  = reflect(D, Nm);
      var env = lmStudioBG(uv * 0.55 + R.xy * 0.72, wall0, wall1, lamp1, lamp2) * 7.5;
      env = env + u.keyColor.rgb * pow(max(dot(R, L1), 0.0), 900.0) * 9.0;
      env = env + u.sheenColor.rgb * pow(max(dot(R, L1), 0.0), 22.0) * 0.55;
      env = env + u.bloomColor.rgb * pow(max(dot(R, L1), 0.0), 4.0) * 0.30;
      env = env + mix(u.iriColor.rgb, u.iriTintColor.rgb, 0.5 + 0.5 * R.x)
                * pow(1.0 - abs(R.y), 3.0) * 0.42 * u.iridescence;
      env = env + u.bounceColor.rgb * lmSstep(0.2, -0.9, R.y) * 0.16;
      let fr = lmSchlick(max(dot(-D, Nm), 0.0), 0.55);
      let pal = mfRampOf(u.paletteCount,
                         u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                         u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                         u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                         u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb);

      inner = env * select(mix(u.metalColor.rgb, u.fresnelColor.rgb, fr),
                           mfRampLinR(fr, pal), u.paletteCount > 0.5);
      inner = inner * (0.52 + 0.48 * smoothstep(-0.85, 0.35, Nm.y));
    } else {
      inner = inner + tint * lmFbm(hp * 2.0 + lmKnead(t, 0.15, 0.12, 0.10, 0.7) * 0.35) * 0.05;
    }

    inner = inner * exp(-pow(1.0 - z, 2.0) * 0.60);
    var c = inner * (1.0 - F) * (0.35 + 0.65 * u.glow);
    c = c + lmGlassHi(N, su, z, u.specularColor.rgb, u.softboxColor.rgb,
                      u.glintColor.rgb, u.edgeColor.rgb, u.rimColor.rgb);
    col = mix(col, c, m);
  }

  col = pow(lmAces(col * max(u.exposure, 0.0)), vec3<f32>(1.0 / 2.2));
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
  let c = orbLiquidMetalAnim(in.uv);

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
    0.2,
    1.0,
    0.03,
    1.0,
    1.0,
    1.0,
    0.005,
    0.0,
    0.0,
    0.0, 0.0,
    0.52156866, 0.6784314, 1.0, 1.0,
    0.7019608, 0.74509805, 0.83137256, 1.0,
    0.9019608, 0.9490196, 1.0, 1.0,
    0.72156864, 0.81960785, 1.0, 1.0,
    0.9490196, 0.61960787, 0.41960785, 1.0,
    0.7137255, 0.76862746, 1.0, 1.0,
    0.5921569, 0.5921569, 1.0, 1.0,
    0.7764706, 0.8156863, 1.0, 1.0,
    0.5921569, 0.68235296, 1.0, 1.0,
    1.0, 0.99607843, 0.9882353, 1.0,
    0.9490196, 0.96862745, 1.0, 1.0,
    0.81960785, 0.9019608, 1.0, 1.0,
    0.6, 0.7607843, 1.0, 1.0,
    0.8509804, 0.92156863, 1.0, 1.0,
    1.0, 0.98039216, 0.9411765, 1.0,
    0.101960786, 0.25882354, 0.7019608, 1.0,
    0.61960787, 0.2, 0.8, 1.0,
    1.0, 1.0, 1.0, 1.0,
    0.52156866, 0.6784314, 1.0, 1.0,
    0.7019608, 0.74509805, 0.83137256, 1.0,
    0.74509805, 0.78039217, 0.85490197, 1.0,
    0.7882353, 0.81960785, 0.8784314, 1.0,
    0.83137256, 0.85490197, 0.9019608, 1.0,
    0.87058824, 0.8901961, 0.92941177, 1.0,
    0.9137255, 0.9254902, 0.9529412, 1.0,
    0.95686275, 0.9647059, 0.9764706, 1.0,
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
export default function OrbLiquidMetalView() {
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
