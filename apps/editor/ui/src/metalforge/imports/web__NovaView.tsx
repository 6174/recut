"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:         vec2<f32>,
  time:         f32,
  style:        f32,
  speed:        f32,
  scale:        f32,
  turbulence:   f32,
  brightness:   f32,
  contrast:     f32,
  saturation:   f32,
  surfaceColor: vec4<f32>,
  coreColor:    vec4<f32>,
  haloColor:    vec4<f32>,
  tint:         vec4<f32>,
  background:   vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn g2rot(a: f32) -> mat2x2<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat2x2<f32>(c, -s, s, c);
}
fn rotXZ(p: vec3<f32>, a: f32) -> vec3<f32> {
  let r = g2rot(a) * vec2<f32>(p.x, p.z);
  return vec3<f32>(r.x, p.y, r.y);
}
fn rotYZ(p: vec3<f32>, a: f32) -> vec3<f32> {
  let r = g2rot(a) * vec2<f32>(p.y, p.z);
  return vec3<f32>(p.x, r.x, r.y);
}
fn rotXY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let r = g2rot(a) * vec2<f32>(p.x, p.y);
  return vec3<f32>(r.x, r.y, p.z);
}
fn nvGrad3(t: f32, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>) -> vec3<f32> {
  let seg = fract(t) * 3.0;
  if (seg < 1.0) { return mix(a, b, smoothstep(0.0, 1.0, seg)); }
  if (seg < 2.0) { return mix(b, c, smoothstep(0.0, 1.0, seg - 1.0)); }
  return mix(c, a, smoothstep(0.0, 1.0, seg - 2.0));
}
fn nvHalo(col0: vec3<f32>, haloCol: vec3<f32>, corona: f32) -> vec3<f32> {
  let l0 = dot(col0, vec3<f32>(0.2126, 0.7152, 0.0722));
  let glow = haloCol * ((1.0 - exp(-corona)) * (1.0 - clamp(l0, 0.0, 1.0)));
  return col0 + glow - col0 * glow;
}
fn nvHash(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn nvDither(col: vec3<f32>, frag: vec2<f32>) -> vec3<f32> {
  let n = nvHash(frag) + nvHash(frag + 19.19) - 1.0;
  let gate = smoothstep(0.0, 2.0 / 255.0, max(col.r, max(col.g, col.b)));
  return col + vec3<f32>(n * (1.0 / 255.0) * gate);
}

fn nvBoilSolar(ain: vec3<f32>, t: f32) -> vec3<f32> {
  var a = ain;
  for (var d = 2.0; d <= 7.0; d = d + 1.0) {
    a = a - (sin(a * d + t * 1.4)).zxy / d;
  }
  return a;
}
fn nvSolar(cc: vec2<f32>, R: vec2<f32>, t: f32) -> vec3<f32> {
  let turb = u.turbulence;
  let surfCol = u.surfaceColor.rgb;
  let coreCol = u.coreColor.rgb;
  let haloCol = u.haloColor.rgb;
  let dir = normalize(vec3<f32>(cc, R.y * 1.35));
  let rdir = rotYZ(rotXZ(dir, 0.17 * t), 0.11 * t);
  let roff = rotYZ(rotXZ(vec3<f32>(0.0, 0.0, -13.0), 0.17 * t), 0.11 * t);
  var acc = vec3<f32>(0.0);
  var z = 0.0;
  var rPrev = 1.0e9;
  let radius = 2.4 + 0.45 * sin(t * 1.1) + 0.16 * sin(t * 2.7 + 1.0);
  for (var i = 0.0; i < 72.0; i = i + 1.0) {
    let p = z * rdir + roff;
    let r = length(p);
    if (r > 6.0 && r > rPrev) { break; }
    rPrev = r;
    let dr = abs(r - radius);
    var q = vec3<f32>(0.0);
    if (dr < 4.0) { q = nvBoilSolar(p * 1.3, t) * (1.0 - smoothstep(2.5, 4.0, dr)); }
    let s = q.y;
    let boil = 0.55 * (0.5 * q.x + 0.4 * sin(s) + 0.3 * q.z) * turb;
    let shell = abs(r - radius - boil);
    let d = 0.08 * shell + 0.05 * abs(cos(s)) + 0.012;
    z = z + d;
    let core = 1.0 / (0.6 * r * r + 0.04);
    let hue = (cos(s + 0.5 * r - 0.5 * t + vec3<f32>(0.0, 0.9, 1.7)) + 1.0);
    acc = acc + (hue * surfCol * 2.0 + core * coreCol * 2.0) / d;
    if (min(acc.x, min(acc.y, acc.z)) > 2.45e4) { break; }
  }
  var corona = 0.0;
  for (var j = 1.0; j <= 36.0; j = j + 1.0) {
    var p = (0.5 * j) * dir;
    p.z = p.z - 13.0;
    let rr = abs(length(p) - radius);
    corona = corona + 0.06 / (0.25 + rr * rr);
  }
  return nvHalo(tanh(acc / 7.0e3), haloCol, corona);
}

fn nvGran(ain: vec3<f32>, t: f32) -> vec3<f32> {
  var b = ain;
  for (var d = 1.0; d < 7.0; d = d + 1.0) {
    let rr = g2rot(0.20 * t / d) * vec2<f32>(b.x, b.y);
    b.x = rr.x;
    b.y = rr.y;
    b = b + cos(b.yzx * (d * 1.3) + t * 1.1 + 0.7 * d) / d;
  }
  return b;
}
fn nvBreath(t: f32) -> f32 {
  return 0.34 * sin(t * 0.55) + 0.12 * sin(t * 1.45 + 0.6);
}
fn nvGolden(cc: vec2<f32>, R: vec2<f32>, t: f32) -> vec3<f32> {
  let turb = u.turbulence;
  let surfCol = u.surfaceColor.rgb;
  let coreCol = u.coreColor.rgb;
  let haloCol = u.haloColor.rgb;
  let dir = normalize(vec3<f32>(cc, R.y * 1.4));
  let rdir = rotYZ(rotXZ(dir, 0.09 * t), 0.06 * t + 0.3);
  let roff = rotYZ(rotXZ(vec3<f32>(0.0, 0.0, -13.0), 0.09 * t), 0.06 * t + 0.3);
  var acc = vec3<f32>(0.0);
  var z = 0.0;
  var rPrev = 1.0e9;
  let radius = 2.35 + nvBreath(t);
  for (var i = 0.0; i < 72.0; i = i + 1.0) {
    let p = z * rdir + roff;
    let r = length(p);
    if (r > 6.0 && r > rPrev) { break; }
    rPrev = r;
    let dr = abs(r - radius);
    var q = vec3<f32>(0.0);
    if (dr < 4.0) { q = nvGran(p * 1.25, t) * (1.0 - smoothstep(2.5, 4.0, dr)); }
    let s = q.x;
    let boil = 0.34 * (0.5 * sin(s) + 0.4 * q.y + 0.3 * sin(q.z)) * turb;
    let shell = abs(r - radius - boil);
    let d = 0.085 * shell + 0.045 * abs(cos(s)) + 0.012;
    z = z + d;
    let core = 1.0 / (0.55 * r * r + 0.05);
    let hue = (cos(0.6 * s + 0.7 * r - 0.4 * t + vec3<f32>(0.0, 0.55, 1.05)) + 1.0);
    acc = acc + (hue * surfCol * 2.0 + core * coreCol * 2.0) / (d + 1e-4);
    if (min(acc.x, min(acc.y, acc.z)) > 2.6e4) { break; }
  }
  var corona = 0.0;
  for (var j = 0.0; j < 36.0; j = j + 1.0) {
    var p = (0.5 * (j + 1.0)) * dir;
    p.z = p.z - 13.0;
    let rr = abs(length(p) - radius);
    corona = corona + 0.07 / (0.22 + rr * rr);
  }
  return nvHalo(tanh(acc / 7.4e3), haloCol, corona);
}

fn nvSwirl(ain: vec3<f32>, t: f32) -> vec3<f32> {
  var a = ain;
  let ang = atan2(a.y, a.x);
  for (var d = 2.0; d <= 7.0; d = d + 1.0) {
    a = a - (sin(a * d + t * 1.15 + ang * 0.6)).yzx / d;
  }
  return a;
}
fn nvEmerald(cc: vec2<f32>, R: vec2<f32>, t: f32) -> vec3<f32> {
  let turb = u.turbulence;
  let surfCol = u.surfaceColor.rgb;
  let coreCol = u.coreColor.rgb;
  let haloCol = u.haloColor.rgb;
  let dir = normalize(vec3<f32>(cc, R.y * 1.45));
  var acc = vec3<f32>(0.0);
  var z = 0.0;
  var rPrev = 1.0e9;
  let radius = 2.3 + 0.38 * sin(t * 1.6) + 0.20 * sin(t * 0.7 + 0.5);
  for (var i = 0.0; i < 72.0; i = i + 1.0) {
    var p = z * dir;
    p.z = p.z - 13.0;
    let sp = 0.55 * t + 0.22 * z;
    p = rotXY(p, sp);
    p = rotYZ(p, 0.13 * t);
    let r = length(p);
    if (r > 6.0 && r > rPrev) { break; }
    rPrev = r;
    let dr = abs(r - radius);
    var q = vec3<f32>(0.0);
    if (dr < 4.0) { q = nvSwirl(p * 1.25, t) * (1.0 - smoothstep(2.5, 4.0, dr)); }
    let s = q.y;
    let boil = 0.50 * (0.45 * q.x + 0.45 * sin(s) + 0.30 * q.z) * turb;
    let shell = abs(r - radius - boil);
    let d = 0.08 * shell + 0.05 * abs(cos(s)) + 0.012;
    z = z + d;
    let core = 1.0 / (0.6 * r * r + 0.04);
    let hue = (cos(s + 0.45 * r - 0.4 * t + vec3<f32>(2.2, 0.0, 4.2)) + 1.0);
    acc = acc + (hue * surfCol * 2.0 + core * coreCol * 2.0) / d;
    if (min(acc.x, min(acc.y, acc.z)) > 9.1e3) { break; }
  }
  var corona = 0.0;
  for (var j = 1.0; j <= 36.0; j = j + 1.0) {
    var p = (0.5 * j) * dir;
    p.z = p.z - 13.0;
    let rr = abs(length(p) - radius);
    corona = corona + 0.06 / (0.25 + rr * rr);
  }
  return nvHalo(tanh(acc / 2.6e3), haloCol, corona);
}

fn nvBoilViolet(ain: vec3<f32>, t: f32) -> vec3<f32> {
  var a = ain;
  for (var d = 2.0; d <= 7.0; d = d + 1.0) {
    a = a - cos(a.yzx * d - t * 0.9) / d;
    a = a + (sin(a.zxy * (d * 0.6) + t * 1.1)).yzx / (d + 0.5);
  }
  return a;
}
fn nvWobble(n: vec3<f32>, t: f32) -> f32 {
  var w = 0.0;
  w = w + 0.42 * sin(2.0 * n.y + t * 1.7);
  w = w + 0.34 * cos(3.0 * n.x - t * 1.3 + 0.6);
  w = w + 0.26 * sin(4.0 * n.z + 2.0 * n.x + t * 2.1);
  w = w + 0.18 * cos(5.0 * n.y - 3.0 * n.z + t * 0.9);
  return w;
}
fn nvViolet(cc: vec2<f32>, R: vec2<f32>, t: f32) -> vec3<f32> {
  let turb = u.turbulence;
  let surfCol = u.surfaceColor.rgb;
  let coreCol = u.coreColor.rgb;
  let haloCol = u.haloColor.rgb;
  let dir = normalize(vec3<f32>(cc, R.y * 1.3));
  let rdir = rotYZ(rotXZ(dir, 0.13 * t), 0.09 * t + 0.4);
  let roff = rotYZ(rotXZ(vec3<f32>(0.0, 0.0, -12.8), 0.13 * t), 0.09 * t + 0.4);
  var acc = vec3<f32>(0.0);
  var z = 0.0;
  var rPrev = 1.0e9;
  let beat = sin(t * 1.45) + 0.5 * sin(t * 2.9 + 0.7);
  let radius = 2.3 + 0.40 * sin(t * 0.85) + 0.22 * beat;
  for (var i = 0.0; i < 72.0; i = i + 1.0) {
    let p = z * rdir + roff;
    let r = length(p);
    if (r > 7.0 && r > rPrev) { break; }
    rPrev = r;
    let nrm = p / (r + 1e-3);
    let dr = abs(r - radius);
    var q = vec3<f32>(0.0);
    if (dr < 4.0) { q = nvBoilViolet(p * 1.15, t) * (1.0 - smoothstep(2.5, 4.0, dr)); }
    let s = q.y;
    let boil = 0.5 * (0.45 * q.x + 0.4 * sin(s) + 0.3 * q.z) * turb;
    var wob = 0.0;
    if (dr < 4.0) { wob = nvWobble(nrm, t) * (1.0 - smoothstep(2.5, 4.0, dr)); }
    let effR = radius + 0.8 * wob;
    let shell = abs(r - effR - boil);
    let d = 0.075 * shell + 0.05 * abs(cos(s)) + 0.012;
    z = z + d;
    let core = 1.0 / (0.6 * r * r + 0.05);
    let hue = (cos(s + 0.45 * r - 0.4 * t + vec3<f32>(0.9, 1.9, 0.4)) + 1.0);
    acc = acc + (hue * surfCol * 2.0 + core * coreCol * 2.0) / d;
    if (min(acc.x, min(acc.y, acc.z)) > 1.54e4) { break; }
  }
  var corona = 0.0;
  for (var j = 1.0; j <= 36.0; j = j + 1.0) {
    var p = (0.5 * j) * dir;
    p.z = p.z - 12.8;
    let rr = abs(length(p) - radius);
    corona = corona + 0.06 / (0.25 + rr * rr);
  }
  return nvHalo(tanh(acc / 4.4e3), haloCol, corona);
}

fn nvBoilCrimson(ain: vec3<f32>, t: f32) -> vec3<f32> {
  var a = ain;
  for (var d = 2.0; d <= 7.0; d = d + 1.0) {
    a = a - cos(a.yzx * d + t * 2.1 + d) / (d + 0.3);
  }
  return a;
}
fn nvFlares(n: vec3<f32>, t: f32, rim: f32) -> f32 {
  var flare = 0.0;
  for (var k = 1.0; k <= 6.0; k = k + 1.0) {
    let a = k * 1.7 + t * (0.6 + 0.13 * k);
    let b = k * 0.9 + sin(t * 0.7 + k) * 1.4;
    let axis = normalize(vec3<f32>(cos(a) * cos(b), sin(b), sin(a) * cos(b)) + vec3<f32>(1e-5));
    let al = max(dot(n, axis), 0.0);
    let spike = pow(al, 22.0);
    let flick = 0.55 + 0.45 * sin(t * (3.1 + 0.7 * k) + k * 2.3);
    flare = flare + spike * flick;
  }
  return flare * rim;
}
fn nvCrimson(cc: vec2<f32>, R: vec2<f32>, t: f32) -> vec3<f32> {
  let turb = u.turbulence;
  let surfCol = u.surfaceColor.rgb;
  let coreCol = u.coreColor.rgb;
  let haloCol = u.haloColor.rgb;
  let dir = normalize(vec3<f32>(cc, R.y * 1.30));
  let rdir = rotYZ(rotXZ(dir, 0.23 * t), 0.15 * t + 0.4);
  let roff = rotYZ(rotXZ(vec3<f32>(0.0, 0.0, -12.4), 0.23 * t), 0.15 * t + 0.4);
  var acc = vec3<f32>(0.0);
  var z = 0.0;
  var rPrev = 1.0e9;
  let radius = 2.2 + 0.50 * sin(t * 1.6) + 0.14 * sin(t * 4.3 + 0.7) + 0.07 * sin(t * 9.1);
  for (var i = 0.0; i < 72.0; i = i + 1.0) {
    let p = z * rdir + roff;
    let r = length(p) + 1e-4;
    if (r > 7.0 && r > rPrev) { break; }
    rPrev = r;
    let n = p / r;
    let dr = abs(r - radius);
    var q = vec3<f32>(0.0);
    if (dr < 4.0) { q = nvBoilCrimson(p * 1.5, t) * (1.0 - smoothstep(2.5, 4.0, dr)); }
    let s = q.y;
    let boil = 0.62 * (0.5 * q.x + 0.45 * sin(s) + 0.35 * q.z) * turb;
    let rim = exp(-2.2 * dr);
    var flare = 0.0;
    if (dr < 4.0) { flare = nvFlares(n, t, rim); }
    let shell = abs(r - radius - boil - 0.55 * flare);
    let d = 0.075 * shell + 0.05 * abs(cos(s)) + 0.012;
    z = z + d;
    let dd = d + 1e-3;
    let core = 1.0 / (0.55 * r * r + 0.045);
    let hue = (cos(s + 0.5 * r - 0.6 * t + vec3<f32>(0.0, 0.55, 1.1)) + 1.0);
    let flareCol = mix(vec3<f32>(1.7, 1.4, 1.0), vec3<f32>(1.9, 0.35, 0.08),
                       clamp((r - radius) * 1.6 + 0.5, 0.0, 1.0));
    acc = acc + (hue * surfCol * 2.0 + core * coreCol * 2.0 + flareCol * flare * 1.3) / dd;
    if (min(acc.x, min(acc.y, acc.z)) > 7.7e3) { break; }
  }
  var corona = 0.0;
  for (var j = 1.0; j <= 36.0; j = j + 1.0) {
    var p = (0.45 * j) * dir;
    p.z = p.z - 12.4;
    let rr = abs(length(p) - radius);
    corona = corona + 0.06 / (0.22 + rr * rr);
  }
  return nvHalo(max(tanh(acc / 2.2e3), vec3<f32>(0.0)), haloCol, corona);
}

fn nvBoilAurora(ain: vec3<f32>, t: f32) -> vec3<f32> {
  var a = ain;
  for (var d = 1.0; d < 7.0; d = d + 1.0) {
    a = a - cos(a.yzx * d + t * 0.9 + d * 0.4) / (d + 0.5);
  }
  return a;
}
fn nvAurora(cc: vec2<f32>, R: vec2<f32>, t: f32) -> vec3<f32> {
  let turb = u.turbulence;
  let surfCol = u.surfaceColor.rgb;
  let coreCol = u.coreColor.rgb;
  let haloCol = u.haloColor.rgb;
  let dir = normalize(vec3<f32>(cc, R.y * 1.28));
  let rdir = rotYZ(rotXZ(dir, 0.13 * t), -0.09 * t + 0.5);
  let roff = rotYZ(rotXZ(vec3<f32>(0.0, 0.0, -13.0), 0.13 * t), -0.09 * t + 0.5);
  var col = vec3<f32>(0.0);
  var z = 0.0;
  var rPrev = 1.0e9;
  let radius = 2.3 + 0.40 * sin(t * 0.85) + 0.10 * sin(t * 3.3 + 0.7);
  let hueDrift = 0.08 * t;
  for (var i = 0.0; i < 72.0; i = i + 1.0) {
    let p = z * rdir + roff;
    let r = length(p);
    if (r > 6.0 && r > rPrev) { break; }
    rPrev = r;
    let dr = abs(r - radius);
    var q = vec3<f32>(0.0);
    if (dr < 4.0) { q = nvBoilAurora(p * 1.25, t) * (1.0 - smoothstep(2.5, 4.0, dr)); }
    let s = q.y;
    let boil = 0.50 * (0.5 * q.x + 0.4 * sin(s) + 0.3 * q.z) * turb;
    let shell = abs(r - radius - boil);
    let d = 0.085 * shell + 0.05 * abs(cos(s)) + 0.012;
    z = z + d;
    let core = 0.55 / (0.9 * r * r + 0.20);
    let ph = 0.16 * z + 0.22 * r + 0.18 * s + hueDrift;
    let iris = nvGrad3(ph, surfCol, coreCol, haloCol);
    let band = 0.5 * cos(s + 0.5 * r - 0.4 * t) + 0.7;
    col = col + (iris * band + core * coreCol * 1.6) / d;
    if (min(col.x, min(col.y, col.z)) > 9.1e3) { break; }
  }
  var corona = vec3<f32>(0.0);
  for (var j = 1.0; j <= 36.0; j = j + 1.0) {
    var p = (0.5 * j) * dir;
    p.z = p.z - 13.0;
    let rr = abs(length(p) - radius);
    let g = 0.06 / (0.25 + rr * rr);
    corona = corona + nvGrad3(0.05 * j + hueDrift + 0.3, surfCol, coreCol, haloCol) * g;
  }
  col = col + corona * 900.0;
  return tanh(col / 2.6e3);
}

fn novaAnim(uv01: vec2<f32>) -> vec4<f32> {
  let R = u.size;
  let frag = uv01 * R;
  var U = vec2<f32>(frag.x, R.y - frag.y);
  U = R * 0.5 + (U - R * 0.5) * 2.0;
  let cc = (U * 2.0 - R) / max(u.scale, 0.001);
  let t = u.time * u.speed;

  let si = i32(u.style);
  var base: vec3<f32>;
  if (si == 1) { base = nvGolden(cc, R, t); }
  else if (si == 2) { base = nvEmerald(cc, R, t); }
  else if (si == 3) { base = nvViolet(cc, R, t); }
  else if (si == 4) { base = nvCrimson(cc, R, t); }
  else if (si == 5) { base = nvAurora(cc, R, t); }
  else { base = nvSolar(cc, R, t); }

  base = select(base, vec3<f32>(0.0), base != base);
  var col = base * u.brightness * u.tint.rgb;
  let luma = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
  col = mix(vec3<f32>(luma), col, u.saturation);
  col = (col - vec3<f32>(0.5)) * u.contrast + vec3<f32>(0.5);
  let lum = max(col.r, max(col.g, col.b));
  col = col + u.background.rgb * (1.0 - clamp(lum, 0.0, 1.0));
  col = nvDither(col, frag);
  col = clamp(col, vec3<f32>(0.0), vec3<f32>(1.0));
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
  return novaAnim(in.uv);
}
`;

const UNIFORMS = new Float32Array([
    0.0, 0.0,
    0.0,
    0.0,
    1.0,
    1.0,
    1.0,
    1.0,
    1.0,
    1.0,
    0.0, 0.0,
    0.8509804, 0.42352942, 0.2, 1.0,
    0.6509804, 0.5019608, 0.34901962, 1.0,
    0.0, 0.0, 0.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    0.0, 0.0, 0.0, 1.0,
]);

const SIZE_WORD = 0;
const TIME_WORD = 2;
const ANIMATED = true;
const CLEAR_ALPHA = 1;
export default function NovaView() {
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
