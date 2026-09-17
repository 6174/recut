"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:       vec2<f32>,
  time:       f32,
  style:      f32,
  progress:   f32,
  alive:      f32,
  warp:       f32,
  scale:      f32,
  amount:     f32,
  lag:        f32,
  echo:       f32,
  bloom:      f32,
  jitter:     f32,
  grain:      f32,
  frontIn:    f32,
  frontOut:   f32,
  feather:    f32,
  churn:      f32,
  ripple:     f32,
  falloff:    f32,
  trails:     f32,
  trailGlow:  f32,
  haze:       f32,
  vignette:   f32,
  pulse:      f32,
  pulseRate:  f32,
  stagger:    f32,
  cellSize:   f32,
  fill:       f32,
  density:    f32,
  turbulence: f32,
  sparkle:    f32,
  background: vec4<f32>,
  color1:     vec4<f32>,
  color2:     vec4<f32>,
  color3:     vec4<f32>,
  color4:     vec4<f32>,
  color5:     vec4<f32>,
  color6:     vec4<f32>,
  color7:     vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn mfp_h21(p0: vec2<f32>) -> f32 {
  var p = fract(p0 * vec2<f32>(123.34, 345.45));
  p = p + vec2<f32>(dot(p, p + vec2<f32>(34.345, 34.345)));
  return fract(p.x * p.y);
}

fn mfp_vn(p0: vec2<f32>) -> f32 {
  let i = floor(p0);
  let f = fract(p0);
  let w = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mfp_h21(i), mfp_h21(i + vec2<f32>(1.0, 0.0)), w.x),
    mix(mfp_h21(i + vec2<f32>(0.0, 1.0)), mfp_h21(i + vec2<f32>(1.0, 1.0)), w.x),
    w.y,
  );
}

fn mfp_fbm(p0: vec2<f32>) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var p = p0;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * mfp_vn(p);
    p = p * 2.03 + vec2<f32>(11.7, 11.7);
    a = a * 0.5;
  }
  return v;
}

fn mfp_mod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}

fn mfp_sstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn mfp_wave(sid: i32, y: f32, tt: f32, amp: f32) -> f32 {
  if (sid == 1) {
    var slosh = sin(y * 3.0 * u.ripple + tt * 0.50 * u.churn) * 0.95;
    slosh = slosh + (y - 0.5) * sin(tt * 0.38 * u.churn) * 1.30;
    return slosh * amp;
  }
  if (sid == 3) {
    let env = sin(y * 3.14159);
    let w = sin(y * 24.0 * u.ripple + tt * 1.70 * u.churn) * 0.70 + sin(y * 11.0 * u.ripple - tt * 0.95 * u.churn) * 0.45;
    return w * env * env * amp;
  }
  if (sid == 5) {
    let q = floor(y * u.scale);
    let s1 = sin(q * 2.10 * u.ripple + tt * 1.50 * u.churn);
    let s2 = sin(q * 0.90 * u.ripple - tt * 0.85 * u.churn);
    return (s1 * 0.72 + s2 * 0.34) * amp;
  }
  var w = sin(y * 19.0 * u.ripple + tt * 1.55 * u.churn) * 0.55
        + sin(y * 31.0 * u.ripple - tt * 1.05 * u.churn + 1.3) * 0.24
        + sin(y * 8.5 * u.ripple + tt * 0.62 * u.churn) * 0.46;
  w = w + (mfp_fbm(vec2<f32>(y * 2.6 * u.ripple, tt * 0.42 * u.churn)) - 0.5) * 1.15;
  return w * amp;
}

fn mfp_liquid(sid: i32, p: vec2<f32>, uv: vec2<f32>, asp: f32, t: f32,
              uP: f32, uA: f32, res: vec2<f32>) -> vec3<f32> {
  let amp = u.amount * uA;
  let ex = mix(u.frontIn, asp + u.frontOut, uP);
  let off = mfp_wave(sid, uv.y, t, amp);
  let d = p.x - (ex + off);
  let px = 1.6 * u.feather / res.y;
  let inside = 1.0 - smoothstep(-px, px, d);
  let dl = max(0.0, -d);
  let prot = clamp(off / max(amp, 0.0001) * 0.5 + 0.5, 0.0, 1.0);
  let lum = u.bloom;

  var col = u.color1.rgb;
  col = mix(col, u.color2.rgb, exp(-dl * 2.1 * u.falloff));
  col = mix(col, u.color3.rgb, exp(-dl * 5.2 * u.falloff) * 0.9);
  col = mix(col, u.color4.rgb, exp(-dl * 9.0 * u.falloff) * (0.72 + 0.28 * prot) * lum);
  col = mix(col, u.color5.rgb, exp(-dl * 17.0 * u.falloff) * (0.55 + 0.45 * prot) * lum);

  for (var k: i32 = 1; k < 7; k = k + 1) {
    if (k > i32(u.trails + 0.5)) { break; }
    let fk = f32(k);
    let ok = mfp_wave(sid, uv.y, t - fk * u.lag, amp * (1.0 + fk * 0.22));
    let dk = p.x - (ex + ok - fk * (u.echo + 0.030 * uA));
    col = col + u.color6.rgb * exp(-abs(dk) * max(0.5, 15.0 - fk * 3.2) * u.falloff) * (0.34 / fk) * u.trailGlow;
    col = col + u.color7.rgb * exp(-abs(dk) * max(0.5, 40.0 - fk * 7.0) * u.falloff) * (0.16 / fk) * lum * u.trailGlow;
  }

  let hz = mfp_fbm(vec2<f32>(p.x * 1.6 - t * 0.06 * uA * u.churn, uv.y * 1.9 + t * 0.05 * uA * u.churn));
  col = col * mix(1.0, 0.86 + 0.28 * hz, u.haze);
  let vig = smoothstep(0.0, 0.42, uv.y) * mfp_sstep(1.0, 0.58, uv.y);
  col = col * mix(1.0, mix(0.78, 1.06, vig), u.vignette);
  return mix(u.background.rgb, col, inside);
}

fn mfp_hex(p: vec2<f32>, uv: vec2<f32>, asp: f32, t: f32, uP: f32, uA: f32) -> vec3<f32> {
  let sc = u.scale;
  var q = vec2<f32>(p.x * sc, uv.y * sc * 1.15);
  q.x = q.x + mfp_mod(floor(q.y), 2.0) * 0.5;
  let ci = floor(q);
  let cf = fract(q) - vec2<f32>(0.5);
  let cell = max(abs(cf.x) * 1.15 + abs(cf.y) * 0.66, abs(cf.y) * 1.32);
  let body = 1.0 - smoothstep(0.46 - 0.04 * u.feather, 0.46 + 0.04 * u.feather, cell / u.cellSize);
  let inner = 1.0 - smoothstep(0.35 - 0.05 * u.feather, 0.35 + 0.05 * u.feather, cell / u.cellSize);
  let cx = (ci.x + 0.5) / sc;
  let front = mix(u.frontIn, asp + u.frontOut, uP);
  let lit = smoothstep(0.0, 0.12, front - cx - (mfp_h21(ci) - 0.5) * u.stagger);
  let puls = (1.0 - u.pulse) + u.pulse * sin(t * u.pulseRate * uA * u.churn + mfp_h21(ci) * 30.0);
  var col = u.background.rgb;
  col = col + u.color1.rgb * body * 0.85;
  col = col + u.color3.rgb * body * lit * puls;
  col = col + u.color2.rgb * inner * lit * 0.45;
  return col;
}

fn mfp_smoke(p: vec2<f32>, uv: vec2<f32>, asp: f32, t: f32, uP: f32, uA: f32) -> vec3<f32> {
  let front = mix(u.frontIn, asp + u.frontOut, uP);
  let w = vec2<f32>(p.x * u.scale - t * 0.12 * uA * u.churn, uv.y * 2.00 + t * 0.05 * uA * u.churn);
  let n = mfp_fbm(w + vec2<f32>(mfp_fbm(w * 1.70) * 1.60 * u.turbulence));
  let dens = mfp_sstep(0.62, 0.05, (p.x - front) * 1.40 * u.density + (0.5 - n) * 1.50 * u.turbulence);
  var col = u.background.rgb;
  col = col + u.color1.rgb * dens;
  col = col + u.color2.rgb * pow(dens, 2.20) * 0.80;
  col = col + u.color3.rgb * pow(dens, 7.00) * 0.65;
  return col;
}

fn mfp_drops(p: vec2<f32>, uv: vec2<f32>, asp: f32, t: f32, uP: f32, uA: f32) -> vec3<f32> {
  let front = mix(u.frontIn, asp + u.frontOut, uP);
  let grade = mfp_sstep(front + 0.34, front - 0.30, p.x);
  let g = u.scale;
  let cell = floor(vec2<f32>(p.x, uv.y) * g);
  let cf = fract(vec2<f32>(p.x, uv.y) * g) - vec2<f32>(0.5);
  let rnd = mfp_h21(cell);
  let rnd2 = mfp_h21(cell + vec2<f32>(13.0, 13.0));
  let jit = uA * u.jitter;
  let off = vec2<f32>(sin(t * 4.0 * u.churn + rnd * 40.0), cos(t * 3.1 * u.churn + rnd2 * 40.0)) * jit;
  let on = step(1.0 - grade * u.fill, rnd);
  let rad = (0.16 + 0.26 * grade) * u.cellSize;
  let disc = 1.0 - mfp_sstep(rad - 0.12 * u.feather, rad + 0.04 * u.feather, length(cf - off));
  var col = u.background.rgb;
  col = col + u.color1.rgb * grade * 0.55;
  col = col + mix(u.color2.rgb, u.color3.rgb, grade) * disc * on;
  return col;
}

fn mfp_threads(p: vec2<f32>, uv: vec2<f32>, asp: f32, t: f32, uP: f32, uA: f32,
               res: vec2<f32>) -> vec3<f32> {
  let n = u.scale;
  let ti = floor(uv.y * n);
  let tf = fract(uv.y * n) - 0.5;
  let strand = 1.0 - smoothstep(0.18 * u.cellSize, 0.42 * u.cellSize, abs(tf));
  let len = mix(u.frontIn, asp + u.frontOut, uP)
          + (mfp_h21(vec2<f32>(ti, 5.0)) - 0.5) * u.stagger
          + sin(t * 2.20 * u.churn + ti * 0.70) * 0.055 * uA;
  let d = p.x - len;
  let px = 1.6 * u.feather / res.y;
  let on = 1.0 - smoothstep(-px * 2.0, px * 2.0, d);
  let dd = max(0.0, -d);
  var col = u.background.rgb;
  col = col + u.color1.rgb * on * strand;
  col = col + u.color2.rgb * exp(-dd * 3.00 * u.falloff) * on * strand;
  col = col + u.color3.rgb * exp(-dd * 14.0 * u.falloff) * on * strand;
  return col;
}

fn mfp_diamond(p: vec2<f32>, uv: vec2<f32>, asp: f32, t: f32, uP: f32, uA: f32) -> vec3<f32> {
  let sc = u.scale;
  let q = vec2<f32>((p.x + uv.y) * 0.7071, (uv.y - p.x) * 0.7071) * sc;
  let ci = floor(q);
  let cf = fract(q) - vec2<f32>(0.5);
  let dia = abs(cf.x) + abs(cf.y);
  let cxw = (ci.x - ci.y) * 0.7071 / sc;
  let front = mix(u.frontIn, asp + u.frontOut, uP);
  let rnd = mfp_h21(ci);
  let appear = smoothstep(0.02, 0.14, front - cxw - (rnd - 0.5) * u.stagger);
  let size = mix(0.06, 0.44, appear) * u.cellSize;
  let tile = 1.0 - mfp_sstep(size - 0.05 * u.feather, size + 0.02 * u.feather, dia);
  let puls = (1.0 - u.pulse) + u.pulse * sin(t * u.pulseRate * uA * u.churn + rnd * 30.0);
  var col = u.background.rgb;
  col = col + u.color1.rgb * mfp_sstep(front + 0.10, front - 0.20, p.x);
  let tint = mix(u.color2.rgb, u.color3.rgb, rnd);
  col = col + tint * tile * appear * puls;
  let rim = (1.0 - smoothstep(0.0, 0.06 * u.feather, abs(dia - size))) * appear;
  col = col + u.color4.rgb * rim * 0.40;
  return col;
}

fn mfp_grain(p: vec2<f32>, uv: vec2<f32>, asp: f32, t: f32, uP: f32, uA: f32) -> vec3<f32> {
  let front = mix(u.frontIn, asp + u.frontOut, uP);
  let grade = mfp_sstep(front + 0.30, front - 0.35, p.x);
  let g = u.scale;
  let cell = floor(vec2<f32>(p.x, uv.y) * g);
  let rnd = mfp_h21(cell);
  let rnd2 = mfp_h21(cell + vec2<f32>(9.0, 9.0));
  let flick = mfp_h21(cell + vec2<f32>(floor(t * 7.0 * uA * u.churn) * 3.0));
  let on = step(1.0 - grade * u.fill, rnd * 0.85 + flick * 0.15);
  let tint = mix(u.color1.rgb, u.color2.rgb, rnd2);
  var col = u.background.rgb + tint * on * (0.30 + 0.70 * grade);
  col = col + u.color3.rgb * on * step(1.0 - 0.015 * u.sparkle, rnd2) * grade * 0.85;
  return col;
}

fn progressBar(uv01: vec2<f32>) -> vec4<f32> {
  let res = max(u.size, vec2<f32>(1.0, 1.0));
  let fc = floor(vec2<f32>(uv01.x, 1.0 - uv01.y) * res) + vec2<f32>(0.5, 0.5);
  let uv = fc / res;
  let asp = res.x / res.y;
  let p = vec2<f32>(uv.x * asp, uv.y);

  let uP = clamp(u.progress * 0.01, 0.0, 1.0);
  let uA = clamp(u.alive, 0.0, 1.0);
  let t = u.warp;
  let sid = i32(u.style + 0.5);

  var col: vec3<f32>;
  if (sid == 0) { col = mfp_hex(p, uv, asp, t, uP, uA); }
  else if (sid == 2) { col = mfp_smoke(p, uv, asp, t, uP, uA); }
  else if (sid == 4) { col = mfp_drops(p, uv, asp, t, uP, uA); }
  else if (sid == 6) { col = mfp_threads(p, uv, asp, t, uP, uA, res); }
  else if (sid == 7) { col = mfp_diamond(p, uv, asp, t, uP, uA); }
  else if (sid == 8) { col = mfp_grain(p, uv, asp, t, uP, uA); }
  else { col = mfp_liquid(sid, p, uv, asp, t, uP, uA, res); }

  col = col + vec3<f32>(mfp_h21(fc) - 0.5) * u.grain;
  return vec4<f32>(max(col, vec3<f32>(0.0)), 1.0);
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
  return progressBar(in.uv);
}
`;

const STYLES = [
    { behaviour: "seismic", caption: "#94808C", u: new Float32Array([0, 0, 0, 0, 60, 0, 0, 9.5, 0.085, 0.55, 0.055, 1, 0.3, 0.01, -0.15, 0.25, 1, 1, 1, 1, 3, 1, 1, 1, 0.28, 3, 0.18, 1, 1, 1, 1, 1, 0.07450981, 0.0627451, 0.1254902, 1, 0.101960786, 0.05882353, 0.2784314, 1, 0.29803923, 0.2, 0.6, 1, 0.65882355, 0.54901963, 1, 1, 0.2784314, 0.5803922, 1, 1, 0.78039217, 0.9019608, 1, 1, 0.05882353, 0.23921569, 0.69803923, 1, 0.2784314, 0.5803922, 1, 1]) },
    { behaviour: "sweep", caption: "#7D8797", u: new Float32Array([0, 0, 0, 1, 60, 0, 0, 9.5, 0.135, 1.4, 0.082, 0.95, 0.3, 0.01, -0.12, 0.12, 1, 1, 1, 1, 3, 1, 1, 1, 0.28, 3, 0.18, 1, 1, 1, 1, 1, 0.0627451, 0.07450981, 0.105882354, 1, 0.015686275, 0.03137255, 0.09803922, 1, 0.023529412, 0.08627451, 0.27058825, 1, 0.05882353, 0.23921569, 0.69803923, 1, 0.2784314, 0.5803922, 1, 1, 0.78039217, 0.9019608, 1, 1, 0.05882353, 0.23921569, 0.69803923, 1, 0.2784314, 0.5803922, 1, 1]) },
    { behaviour: "breath", caption: "#848D7C", u: new Float32Array([0, 0, 0, 2, 60, 0, 0, 1.3, 0.085, 0.55, 0.055, 1, 0.3, 0.01, -0.35, 0.55, 1, 1, 1, 1, 3, 1, 1, 1, 0.28, 3, 0.18, 1, 1, 1, 1, 1, 0.07450981, 0.0627451, 0.09803922, 1, 0.101960786, 0.07058824, 0.16078432, 1, 0.41960785, 0.21960784, 0.72156864, 1, 0.8784314, 0.78039217, 1, 1, 0.2784314, 0.5803922, 1, 1, 0.78039217, 0.9019608, 1, 1, 0.05882353, 0.23921569, 0.69803923, 1, 0.2784314, 0.5803922, 1, 1]) },
    { behaviour: "spring", caption: "#8F817A", u: new Float32Array([0, 0, 0, 3, 60, 0, 0, 9.5, 0.105, 0.42, 0.055, 1, 0.3, 0.01, -0.12, 0.12, 1, 1, 1, 1, 3, 1, 1, 1, 0.28, 3, 0.18, 1, 1, 1, 1, 1, 0.09411765, 0.07450981, 0.06666667, 1, 0.09803922, 0.023529412, 0.007843138, 1, 0.2509804, 0.07058824, 0.015686275, 1, 0.6784314, 0.2, 0.03137255, 1, 1, 0.47843137, 0.14117648, 1, 1, 0.8392157, 0.61960787, 1, 0.6784314, 0.2, 0.03137255, 1, 1, 0.47843137, 0.14117648, 1]) },
    { behaviour: "jitter", caption: "#847F94", u: new Float32Array([0, 0, 0, 4, 60, 0, 0, 110, 0.085, 0.55, 0.055, 1, 0.3, 0.01, -0.3, 0.3, 1, 1, 1, 1, 3, 1, 1, 1, 0.28, 3, 0.18, 1, 1, 1, 1, 1, 0.07058824, 0.08627451, 0.05882353, 1, 0.05490196, 0.14117648, 0.019607844, 1, 0.18039216, 0.52156866, 0.05882353, 1, 0.69803923, 1, 0.34901962, 1, 0.2784314, 0.5803922, 1, 1, 0.78039217, 0.9019608, 1, 1, 0.05882353, 0.23921569, 0.69803923, 1, 0.2784314, 0.5803922, 1, 1]) },
    { behaviour: "metro", caption: "#8B9099", u: new Float32Array([0, 0, 0, 5, 60, 0, 0, 9, 0.072, 0.5, 0.048, 1, 0.3, 0.01, -0.12, 0.12, 1, 1, 1, 1, 3, 1, 1, 1, 0.28, 3, 0.18, 1, 1, 1, 1, 1, 0.105882354, 0.10980392, 0.11764706, 1, 0.043137256, 0.05490196, 0.08627451, 1, 0.10980392, 0.14901961, 0.23921569, 1, 0.32156864, 0.41960785, 0.61960787, 1, 0.72156864, 0.8509804, 1, 1, 0.9607843, 0.9882353, 1, 1, 0.32156864, 0.41960785, 0.61960787, 1, 0.72156864, 0.8509804, 1, 1]) },
    { behaviour: "attract", caption: "#8F8083", u: new Float32Array([0, 0, 0, 6, 60, 0, 0, 64, 0.085, 0.55, 0.055, 1, 0.3, 0.01, -0.1, 0.3, 1, 1, 1, 1, 3, 1, 1, 1, 0.28, 3, 0.32, 1, 1, 1, 1, 1, 0.09019608, 0.05882353, 0.078431375, 1, 0.16078432, 0.03137255, 0.09019608, 1, 1, 0.36862746, 0.6901961, 1, 1, 0.8509804, 0.9490196, 1, 0.2784314, 0.5803922, 1, 1, 0.78039217, 0.9019608, 1, 1, 0.05882353, 0.23921569, 0.69803923, 1, 0.2784314, 0.5803922, 1, 1]) },
    { behaviour: "hop", caption: "#7C8D85", u: new Float32Array([0, 0, 0, 7, 60, 0, 0, 7.5, 0.085, 0.55, 0.055, 1, 0.3, 0.01, -0.18, 0.3, 1, 1, 1, 1, 3, 1, 1, 1, 0.25, 2.8, 0.16, 1, 1, 1, 1, 1, 0.09411765, 0.0627451, 0.07058824, 1, 0.07450981, 0.043137256, 0.05490196, 1, 0.72156864, 0.2, 0.32941177, 1, 1, 0.56078434, 0.43137255, 1, 1, 0.8, 0.72156864, 1, 0.78039217, 0.9019608, 1, 1, 0.05882353, 0.23921569, 0.69803923, 1, 0.2784314, 0.5803922, 1, 1]) },
    { behaviour: "steps", caption: "#8A8C92", u: new Float32Array([0, 0, 0, 8, 60, 0, 0, 150, 0.085, 0.55, 0.055, 1, 0.3, 0.01, -0.3, 0.4, 1, 1, 1, 1, 3, 1, 1, 1, 0.28, 3, 0.18, 1, 1, 1, 1, 1, 0.078431375, 0.06666667, 0.09411765, 1, 0.29803923, 0.14117648, 0.54901963, 1, 0.69803923, 0.5019608, 1, 1, 0.92156863, 0.8509804, 1, 1, 0.2784314, 0.5803922, 1, 1, 0.78039217, 0.9019608, 1, 1, 0.05882353, 0.23921569, 0.69803923, 1, 0.2784314, 0.5803922, 1, 1]) },
    { behaviour: "liquid", caption: "#84868C", u: new Float32Array([0, 0, 0, 9, 60, 0, 0, 9.5, 0.085, 0.55, 0.055, 1, 0.3, 0.01, -0.12, 0.12, 1, 1, 1, 1, 3, 1, 1, 1, 0.28, 3, 0.18, 1, 1, 1, 1, 1, 0.12941177, 0.12941177, 0.14117648, 1, 0.03529412, 0.043137256, 0.08627451, 1, 0.043137256, 0.09803922, 0.2901961, 1, 0.05490196, 0.30980393, 0.78039217, 1, 0.25882354, 0.72156864, 0.98039216, 1, 0.6392157, 0.92941177, 1, 1, 0.07450981, 0.32941177, 0.7607843, 1, 0.2, 0.56078434, 0.8784314, 1]) },
];

const SIZE_WORD = 0;
const PROGRESS_WORD = 4;
const ALIVE_WORD = 5;
const WARP_WORD = 6;
const INK_WORDS: Record<string, number> = {
    track: 32,
    deep: 36,
    mid: 40,
    glow: 44,
    bright: 48,
    core: 52,
    trail: 56,
    trailHot: 60,
};
const SPEED = 1.0;
const ASPECT = 3.6;
const CORNER = 0.144;
const REF_W = 1040;

type ProgressSim = {
    p: number;
    activity: number;
    wt: number;
    frames: number;
    target: number;
    from: number;
    u: number;
    vel: number;
    rate: number;
    mode: string;
    wait: number;
    burst: number;
    clock: number;
    shocks: number;
    seed: number;
    index: number;
};

function rand(s: ProgressSim): number {
    s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0;
    return s.seed / 4294967296;
}

function rnd(s: ProgressSim, a: number, b: number): number {
    return a + rand(s) * (b - a);
}

function b_seismic(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'reset') return bDrain(s, dt, sp);
    s.wait -= dt * sp;
    if (s.wait <= 0) {
      if (s.p >= 0.999) { s.mode = 'reset'; return true; }
      s.shocks = (s.shocks || 0);
      s.p = Math.min(1, s.p + 0.075);
      s.shocks += 1;
      s.burst = 0.45;
      if (s.shocks >= 3) { s.shocks = 0; s.wait = 2.4; } else { s.wait = 0.20; }
    }
    s.burst = Math.max(0, s.burst - dt);
    return s.burst > 0;
}
function b_sweep(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'reset') return bDrain(s, dt, sp);
    if (s.mode !== 'move') {
      s.wait -= dt * sp;
      if (s.wait <= 0) {
        if (s.p >= 0.999) { s.mode = 'reset'; return true; }
        s.from = s.p; s.target = Math.min(1, s.p + 0.25); s.u = 0; s.mode = 'move';
      }
      return false;
    }
    s.u = Math.min(1, s.u + dt * sp / 2.6);
    const e = 0.5 - 0.5 * Math.cos(Math.PI * s.u);
    s.p = s.from + (s.target - s.from) * e;
    if (s.u >= 1) { s.mode = 'pause'; s.wait = 0.9; return false; }
    return true;
}
function b_breath(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'reset') return bDrain(s, dt, sp);
    if (s.p >= 0.999) {
      s.wait -= dt * sp;
      if (s.wait <= 0) s.mode = 'reset';
      return false;
    }
    if (s.mode === 'rest') {
      s.wait -= dt * sp;
      if (s.wait <= 0) s.mode = 'go';
      return false;
    }
    s.p = Math.min(1, s.p + 0.030 * sp * dt);
    s.clock -= dt * sp;
    if (s.clock <= 0) { s.mode = 'rest'; s.wait = rnd(s, 0.8, 1.4); s.clock = rnd(s, 2.5, 4.0); }
    if (s.p >= 0.999) s.wait = 1.5;
    return true;
}
function b_spring(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'reset') return bDrain(s, dt, sp);
    if (s.mode !== 'move') {
      s.wait -= dt * sp;
      if (s.wait <= 0) {
        if (s.p >= 0.995) { s.mode = 'reset'; return true; }
        s.target = Math.min(1, s.p + 0.22); s.vel = 0; s.mode = 'move';
      }
      return false;
    }
    s.vel += ((s.target - s.p) * 7.5 - s.vel * 3.4) * dt * sp;
    s.p += s.vel * dt * sp;
    if (Math.abs(s.vel) < 0.010 && Math.abs(s.target - s.p) < 0.004) {
      s.p = s.target; s.vel = 0; s.mode = 'pause'; s.wait = 1.1;
      return false;
    }
    return true;
}
function b_jitter(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'reset') return bDrain(s, dt, sp);
    s.wait -= dt * sp;
    if (s.wait <= 0) {
      if (s.p >= 0.999) { s.mode = 'reset'; return true; }
      s.target = Math.min(1, s.p + rnd(s, 0.01, 0.035));
      s.wait = rnd(s, 0.08, 0.22);
      s.burst = 0.3;
    }
    const gap = s.target - s.p;
    s.p += gap * Math.min(1, 6.5 * sp * dt);
    s.burst = Math.max(0, s.burst - dt);
    return s.burst > 0;
}
function b_metro(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'reset') return bDrain(s, dt, sp);
    s.wait -= dt * sp;
    if (s.wait <= 0) {
      if (s.p >= 0.999) { s.mode = 'reset'; return true; }
      s.target = Math.min(1, Math.round(s.p * 10 + 1) / 10);
      s.wait = 1.35;
    }
    const gap = s.target - s.p;
    s.p += gap * Math.min(1, 3.4 * sp * dt);
    return Math.abs(gap) > 0.002;
}
function b_attract(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'reset') return bDrain(s, dt, sp);
    if (s.mode !== 'move') {
      s.wait -= dt * sp;
      if (s.wait <= 0) {
        if (s.p >= 0.995) { s.mode = 'reset'; return true; }
        s.target = Math.min(1, s.p + 0.22); s.mode = 'move';
      }
      return false;
    }
    const gap = s.target - s.p;
    s.p += gap * Math.min(1, (0.55 + 5.5 * Math.abs(gap)) * sp * dt);
    if (Math.abs(gap) < 0.0025) { s.p = s.target; s.mode = 'pause'; s.wait = 0.6; return false; }
    return true;
}
function b_hop(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'reset') return bDrain(s, dt, sp);
    s.wait -= dt * sp;
    if (s.wait <= 0) {
      if (s.p >= 0.999) { s.mode = 'reset'; return true; }
      s.target = Math.min(1, s.target + 0.08);
      s.wait = 0.42;
    }
    const gap = s.target - s.p;
    s.p += gap * Math.min(1, 5.0 * sp * dt);
    return Math.abs(gap) > 0.002;
}
function b_steps(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'pause') {
      s.wait -= dt * sp;
      if (s.wait <= 0) {
        if (s.p >= 0.999) { s.mode = 'reset'; }
        else { s.target = Math.min(1, s.p + rnd(s, 0.17, 0.23)); s.mode = 'move'; }
      }
      return false;
    }
    if (s.mode === 'reset') {
      s.p -= 1.0 * sp * dt;
      if (s.p <= 0) { s.p = 0; s.target = 0; s.mode = 'pause'; s.wait = 0.8; }
      return true;
    }
    const gap = s.target - s.p;
    s.p += gap * Math.min(1, 1.7 * sp * dt);
    if (Math.abs(gap) < 0.004) {
      s.p = s.target; s.mode = 'pause';
      s.wait = s.p >= 0.999 ? 1.9 : rnd(s, 0.9, 1.5);
      return false;
    }
    return true;
}

function bDrain(s: ProgressSim, dt: number, sp: number): boolean {
    s.p -= 1.0 * sp * dt;
    if (s.p <= 0) { s.p = 0; s.target = 0; s.vel = 0; s.mode = 'pause'; s.wait = 0.8; }
    return true;
}

function b_liquid(s: ProgressSim, dt: number, sp: number): boolean {
    let moved = false;
    if (s.mode === 'pause') {
      s.wait -= dt * sp;
      if (s.wait <= 0) {
        if (s.p >= 0.999) { s.target = 0; s.rate = 1.2; }
        else { s.target = Math.min(1, s.p + rnd(s, 0.06, 0.22)); s.rate = rnd(s, 0.05, 0.16); }
        s.mode = 'move';
      }
    }
    if (s.mode === 'move') {
      const dir = Math.sign(s.target - s.p);
      s.p += dir * s.rate * sp * dt;
      moved = true;
      if ((dir >= 0 && s.p >= s.target) || (dir < 0 && s.p <= s.target)) {
        s.p = s.target; s.mode = 'pause';
        s.wait = s.p >= 0.999 ? 1.8 : (s.p <= 0.001 ? 0.6 : rnd(s, 0.7, 2.0));
      }
    }
    return moved;
}

function stepBeh(s: ProgressSim, dt: number, sp: number, beh: string): boolean {
    switch (beh) {
        case "seismic": return b_seismic(s, dt, sp);
        case "sweep": return b_sweep(s, dt, sp);
        case "breath": return b_breath(s, dt, sp);
        case "spring": return b_spring(s, dt, sp);
        case "jitter": return b_jitter(s, dt, sp);
        case "metro": return b_metro(s, dt, sp);
        case "attract": return b_attract(s, dt, sp);
        case "hop": return b_hop(s, dt, sp);
        case "steps": return b_steps(s, dt, sp);
        case "liquid": return b_liquid(s, dt, sp);
        default: return b_steps(s, dt, sp);
    }
}

const RATES: Record<string, { up: number; dn: number; wB: number; wG: number }> = {
    liquid: { up: 3.0, dn: 0.75, wB: 0.35, wG: 1.35 },
};
const RATES_DEFAULT = { up: 1.8, dn: 0.7, wB: 0.45, wG: 0.85 };

function newSim(index: number): ProgressSim {
    return {
        p: 0,
        activity: 0,
        wt: ((index * 2654435761) % 600) / 10,
        frames: 0,
        target: 0,
        from: 0,
        u: 0,
        vel: 0,
        rate: 0.08,
        mode: "pause",
        wait: 0.5,
        burst: 0,
        clock: 0,
        shocks: 0,
        seed: (index * 2246822519 + 374761393) >>> 0,
        index,
    };
}

function simStep(s: ProgressSim, dt: number, sp: number, beh: string, manual: number): void {
    const r = RATES[beh] ?? RATES_DEFAULT;
    let moving = false;
    if (manual >= 0) {
        const gap = Math.min(Math.max(manual, 0), 1) - s.p;
        if (Math.abs(gap) > 0.002) { s.p += Math.sign(gap) * Math.min(Math.abs(gap), 0.5 * sp * dt); moving = true; }
    } else {
        moving = stepBeh(s, dt, sp, beh);
    }
    s.p = Math.max(0, Math.min(1, s.p));
    s.activity += ((moving ? 1 : 0) - s.activity) * (1 - Math.exp(-(moving ? r.up : r.dn) * dt));
    s.wt += dt * (r.wB + s.activity * r.wG);
    s.frames += 1;
}

const SIM_STEP = 1 / 60;

function simTo(s: ProgressSim, t: number, sp: number, beh: string, manual: number): ProgressSim {
    const want = Math.max(0, Math.floor(t / SIM_STEP));
    if (want < s.frames) {
        const fresh = newSim(s.index);
        for (const k of Object.keys(fresh) as (keyof ProgressSim)[]) {
            (s[k] as number | string) = fresh[k];
        }
    }
    let steps = want - s.frames;
    if (steps > 600) {
        s.frames = want - 600;
        steps = 600;
    }
    for (let i = 0; i < steps; i++) simStep(s, SIM_STEP, sp, beh, manual);
    return s;
}

function simPercent(s: ProgressSim): number {
    return Math.round(Math.min(Math.max(s.p, 0), 1) * 100);
}

export type ProgressBarColors = {
    track?: string;
    deep?: string;
    mid?: string;
    glow?: string;
    bright?: string;
    core?: string;
    trail?: string;
    trailHot?: string;
};

export type ProgressBarProps = {
    progress?: number;
    style?: number;
    colors?: ProgressBarColors;
    title?: string;
    subtitle?: string;
    showsContent?: boolean;
};

export default function ProgressBar({
    progress = -1,
    style = 0,
    colors = {},
    title = "SYNCING LIBRARY",
    subtitle = "PREPARING YOUR FILES",
    showsContent = true,
}: ProgressBarProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [box, setBox] = useState({ w: 0, h: 0 });

    const epoch = useRef(0);
    if (epoch.current === 0) epoch.current = performance.now();

    const sim = useRef(newSim(0));
    const [pct, setPct] = useState(0);

    const live = useRef({ progress, style, colors });
    live.current = { progress, style, colors };

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
            const uniforms = STYLES[0].u.slice();
            let applied = -1;
            let appliedInks = "";
            let lastPct = -1;
            const buffer = dev.createBuffer({
                size: uniforms.byteLength,
                usage: usage.UNIFORM | usage.COPY_DST,
            });
            const bindGroup = dev.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [{ binding: 0, resource: { buffer } }],
            });

            const draw = () => {
                if (disposed) return;
                const t = (performance.now() - epoch.current) / 1000;
                const s = Math.min(Math.max(Math.round(live.current.style), 0), STYLES.length - 1);
                if (s !== applied) {
                    uniforms.set(STYLES[s].u);
                    sim.current = newSim(s);
                    applied = s;
                    appliedInks = "";
                }
                const inkKey = JSON.stringify(live.current.colors ?? {});
                if (inkKey !== appliedInks) {
                    uniforms.set(STYLES[s].u);
                    for (const [prop, hex] of Object.entries(live.current.colors ?? {})) {
                        const w = INK_WORDS[prop];
                        if (w === undefined || typeof hex !== "string") continue;
                        const h = hex.replace("#", "");
                        uniforms[w] = parseInt(h.slice(0, 2), 16) / 255;
                        uniforms[w + 1] = parseInt(h.slice(2, 4), 16) / 255;
                        uniforms[w + 2] = parseInt(h.slice(4, 6), 16) / 255;
                        uniforms[w + 3] = 1;
                    }
                    appliedInks = inkKey;
                }
                simTo(sim.current, t, SPEED, STYLES[s].behaviour, live.current.progress);
                uniforms[SIZE_WORD] = canvas.width;
                uniforms[SIZE_WORD + 1] = canvas.height;
                uniforms[PROGRESS_WORD] = sim.current.p * 100;
                uniforms[ALIVE_WORD] = sim.current.activity;
                uniforms[WARP_WORD] = sim.current.wt;
                dev.queue.writeBuffer(buffer, 0, uniforms);
                const shown = simPercent(sim.current);
                if (shown !== lastPct) {
                    lastPct = shown;
                    setPct(shown);
                }

                const encoder = dev.createCommandEncoder();
                const pass = encoder.beginRenderPass({
                    colorAttachments: [
                        {
                            view: context.getCurrentTexture().createView(),
                            loadOp: "clear",
                            storeOp: "store",
                            clearValue: { r: 0, g: 0, b: 0, a: 1 },
                        },
                    ],
                });
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, bindGroup);
                pass.draw(3);
                pass.end();
                dev.queue.submit([encoder.finish()]);

                frame = requestAnimationFrame(draw);
            };

            const resize = () => {
                const rect = canvas.getBoundingClientRect();
                setBox({ w: rect.width, h: rect.height });
                const scale = Math.min(window.devicePixelRatio || 1, 2);
                const w = Math.max(1, Math.round(rect.width * scale));
                const h = Math.max(1, Math.round(rect.height * scale));
                if (w === canvas.width && h === canvas.height) return;
                canvas.width = w;
                canvas.height = h;
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

    const styleIndex = Math.min(Math.max(Math.round(style), 0), STYLES.length - 1);

    const gs = box.w / REF_W;
    const px = (v: number) => v * gs;

    return (
        <div
            style={{
                position: "relative",
                width: "100%",
                aspectRatio: String(ASPECT),
                borderRadius: CORNER * box.h,
                overflow: "hidden",
                boxSizing: "border-box",
            }}
        >
            <canvas
                ref={canvasRef}
                style={{ display: "block", width: "100%", height: "100%" }}
            />
            {showsContent && box.w > 0 && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        boxSizing: "border-box",
                        paddingLeft: px(87.36),
                        paddingRight: px(87.36),
                        pointerEvents: "none",
                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                    }}
                >
                    <div style={{ minWidth: 0 }}>
                        <div
                            style={{
                                color: "#FFFFFF",
                                fontWeight: 800,
                                fontSize: px(32.0),
                                lineHeight: 1.05,
                                letterSpacing: "0.005em",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {title}
                        </div>
                        <div
                            style={{
                                color: STYLES[styleIndex].caption,
                                fontWeight: 700,
                                fontSize: px(16.0),
                                letterSpacing: px(2.4),
                                marginTop: px(8.0),
                                lineHeight: 1,
                                whiteSpace: "nowrap",
                            }}
                        >
                            {subtitle}
                        </div>
                    </div>
                    <div
                        style={{
                            color: "#FFFFFF",
                            fontWeight: 700,
                            fontSize: px(60.0),
                            lineHeight: 1,
                            letterSpacing: "-0.01em",
                            fontVariantNumeric: "tabular-nums",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {pct}%
                    </div>
                </div>
            )}
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
