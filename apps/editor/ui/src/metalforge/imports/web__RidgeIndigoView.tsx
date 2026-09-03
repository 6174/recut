"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:        vec2<f32>,
  time:        f32,
  style:       f32,
  anim:        f32,
  radius:      f32,
  layer1Blur:  f32,
  layer2Blur:  f32,
  layer3Blur:  f32,
  grainAmt:    f32,
  grainFreq:   f32,
  intensity:   f32,
  shadowAmt:   f32,
  animSpeed:   f32,
  animAmount:  f32,
  animSpread:  f32,
  waveFreq:    f32,
  lightSway:   f32,
  grainDrift:  f32,
  glowPulse:   f32,
  card:        vec2<f32>,
  light:       vec2<f32>,
  bgColor:     vec4<f32>,
  layer1Color: vec4<f32>,
  layer2Color: vec4<f32>,
  layer3Color: vec4<f32>,
  shadowColor: vec4<f32>,
  filterId:    f32,
  fAmount:     f32,
  fScale:      f32,
  fBlur:       f32,
  fFade:       f32,
  fSoft:       f32,
  fAngle:      f32,
  fGrain:      f32,
  fBrightness: f32,
  fContrast:   f32,
  fSaturation: f32,
  fRound:      f32,
  fBevel:      f32,
  fInset:      f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

const MFSK: f32 = 2.104;

const MFSOFF: f32 = 34.0;
const MFSBLUR: f32 = 70.0;
const MFSSPREAD: f32 = -24.0;

const MFSALPHA: f32 = 0.55;

fn mfsSdRoundBox(p: vec2<f32>, ext: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - ext + vec2<f32>(r);
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn mfsCardShadow(dst: vec3<f32>, q: vec2<f32>, ext: vec2<f32>, r: f32, gs: f32,
                 ldir: vec2<f32>, amt: f32, inten: f32, tint: vec3<f32>) -> vec3<f32> {
  let spread = MFSSPREAD * gs;
  let sext = max(ext + vec2<f32>(spread), vec2<f32>(0.0));
  let sr = clamp(r + spread, 0.0, min(sext.x, sext.y));
  let off = ldir * MFSOFF * gs;
  let sigma = max(MFSBLUR * gs * 0.5, 0.0001);
  let d = mfsSdRoundBox(q - off, sext, sr);
  let cov = 1.0 - smoothstep(-MFSK * sigma, MFSK * sigma, d);
  return mix(dst, tint, clamp(cov * MFSALPHA * amt * inten, 0.0, 1.0));
}

const GREFX: f32 = 150.0;
const GREFY: f32 = 192.0;

const GK: f32 = 2.104;

const GCANVAS: vec3<f32> = vec3<f32>(0.02745098, 0.02745098, 0.04313725);

const GPAR1: f32 = 10.0;
const GPAR2: f32 = 16.0;
const GPAR3: f32 = 22.0;

const GGAIN: f32 = 0.26;
const GSEED: f32 = 17.0;

const GAW2: f32 = 0.62;
const GAW3: f32 = 0.38;

const GAMP_WAVE: f32 = 14.0;
const GAMP_SWELL: f32 = 22.0;
const GAMP_DRIFT: f32 = 34.0;

const GTAU: f32 = 6.28318530718;

const GQN1: f32 = 0.9;
const GQN2: f32 = 1.8;
const GQW0: f32 = 0.36633;
const GQW1: f32 = 0.24434;
const GQW2: f32 = 0.07249;

fn gCardFrame(res: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(393.0, 851.0) * max(min(res.x / 393.0, res.y / 851.0), 0.0001);
}

fn gSdRoundBox(p: vec2<f32>, ext: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - ext + vec2<f32>(r);
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn gCoverage(d: f32, sigma: f32) -> f32 {
  let s = max(sigma, 0.0001);
  return 1.0 - smoothstep(-GK * s, GK * s, d);
}

fn gOver(dst: vec3<f32>, src: vec3<f32>, a: f32) -> vec3<f32> {
  return mix(dst, src, clamp(a, 0.0, 1.0));
}

fn gParallax(ldir: vec2<f32>, k: f32) -> vec2<f32> {
  return (ldir - vec2<f32>(0.0, 1.0)) * k;
}

fn gAnimT() -> f32 {
  if (i32(u.anim + 0.5) > 2) { return 0.0; }
  return u.time * max(u.animSpeed, 0.0);
}

fn gAnimWeight(layerIdx: i32) -> f32 {
  var w = 1.0;
  if (layerIdx == 1) { w = GAW2; }
  else if (layerIdx == 2) { w = GAW3; }
  return mix(1.0, w, clamp(u.animSpread, 0.0, 2.0));
}

fn gAnimOffset(layerIdx: i32, x: f32, tt: f32) -> vec2<f32> {
  let mode = i32(u.anim + 0.5);
  var o = vec2<f32>(0.0);
  if (mode <= 2) {
    let w = gAnimWeight(layerIdx) * max(u.animAmount, 0.0);
    let rate = 1.0 - 0.22 * f32(layerIdx);
    let ph = f32(layerIdx) * 0.9;
    if (mode == 0) {
      let k = GTAU * max(u.waveFreq, 0.0) / (2.0 * GREFX);
      o.y = GAMP_WAVE * w * sin(k * x - tt * 1.1 * rate + ph);
    } else if (mode == 1) {
      o.y = GAMP_SWELL * w * sin(tt * 0.75 * rate + ph);
      o.x = 0.45 * GAMP_SWELL * w * sin(tt * 0.38 * rate + ph + 1.7);
    } else {
      o.x = GAMP_DRIFT * w * sin(tt * 0.55 * rate + ph);
      o.y = 0.30 * GAMP_DRIFT * w * sin(tt * 0.37 * rate + ph + 2.1);
    }
  }
  return o;
}

fn gLightDir() -> vec2<f32> {
  let tt = gAnimT();
  let s = 0.5 * clamp(u.lightSway, 0.0, 1.0);
  return (u.light - vec2<f32>(0.5)) * 2.0
       + vec2<f32>(sin(tt * 0.31), sin(tt * 0.23)) * s;
}

fn gIntensity() -> f32 {
  let tt = gAnimT();
  let pulse = 1.0 + 0.35 * clamp(u.glowPulse, 0.0, 1.0) * sin(tt * 0.8);
  return max(0.0, u.intensity) * max(pulse, 0.0);
}

fn gGrainPhase(tt: f32) -> f32 {
  let fr = floor(tt * 14.0 * clamp(u.grainDrift, 0.0, 1.0));
  return fract(sin(fr * 12.9898) * 43758.5453) * 97.0;
}

fn gHash(lattice: vec2<f32>, channel: f32) -> f32 {
  let v = vec3<f32>(lattice, channel + GSEED);
  return fract(sin(dot(v, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453123);
}

fn gValueNoise(p: vec2<f32>, channel: f32) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let a = gHash(i, channel);
  let b = gHash(i + vec2<f32>(1.0, 0.0), channel);
  let c = gHash(i + vec2<f32>(0.0, 1.0), channel);
  let d = gHash(i + vec2<f32>(1.0, 1.0), channel);
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y) * 2.0 - 1.0;
}

fn gFractal(p: vec2<f32>, channel: f32) -> f32 {
  var sum = 0.0;
  var amp = 1.0;
  var freq = 1.0;
  for (var i = 0; i < 3; i = i + 1) {
    sum = sum + gValueNoise(p * freq, channel + f32(i) * 37.0) * amp;
    freq = freq * 2.0;
    amp = amp * 0.5;
  }
  return clamp(0.5 + GGAIN * sum, 0.0, 1.0);
}

fn gLinearToSRGB(c: f32) -> f32 {
  if (c <= 0.0031308) { return c * 12.92; }
  return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

fn gOverlay(base: f32, blend: f32) -> f32 {
  if (base < 0.5) { return 2.0 * base * blend; }
  return 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
}

fn mfRidgeSeg(x: f32, p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>) -> vec2<f32> {
  let xa = p3.x - 3.0 * p2.x + 3.0 * p1.x - p0.x;
  let xb = 3.0 * p2.x - 6.0 * p1.x + 3.0 * p0.x;
  let xc = 3.0 * p1.x - 3.0 * p0.x;
  var t = clamp((x - p0.x) / max(p3.x - p0.x, 0.0001), 0.0, 1.0);
  for (var i = 0; i < 4; i = i + 1) {
    let f = ((xa * t + xb) * t + xc) * t + p0.x - x;
    let df = (3.0 * xa * t + 2.0 * xb) * t + xc;
    t = clamp(t - f / max(df, 0.0001), 0.0, 1.0);
  }
  let ya = p3.y - 3.0 * p2.y + 3.0 * p1.y - p0.y;
  let yb = 3.0 * p2.y - 6.0 * p1.y + 3.0 * p0.y;
  let yc = 3.0 * p1.y - 3.0 * p0.y;
  let y = ((ya * t + yb) * t + yc) * t + p0.y;
  let dy = (3.0 * ya * t + 2.0 * yb) * t + yc;
  let dx = (3.0 * xa * t + 2.0 * xb) * t + xc;
  return vec2<f32>(y, dy / max(dx, 0.0001));
}

fn mfRdgViolet1(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 96.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 330.0), vec2<f32>(-10.0, 240.0), vec2<f32>(60.0, 150.0), vec2<f32>(96.0, 150.0)); }
  else if (cx < 190.0) { r = mfRidgeSeg(cx, vec2<f32>(96.0, 150.0), vec2<f32>(132.0, 150.0), vec2<f32>(152.0, 262.0), vec2<f32>(190.0, 262.0)); }
  else if (cx < 282.0) { r = mfRidgeSeg(cx, vec2<f32>(190.0, 262.0), vec2<f32>(226.0, 262.0), vec2<f32>(250.0, 196.0), vec2<f32>(282.0, 196.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(282.0, 196.0), vec2<f32>(316.0, 196.0), vec2<f32>(344.0, 270.0), vec2<f32>(370.0, 330.0)); }
  return r;
}

fn mfRdgViolet2(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 98.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 356.0), vec2<f32>(0.0, 286.0), vec2<f32>(62.0, 212.0), vec2<f32>(98.0, 212.0)); }
  else if (cx < 192.0) { r = mfRidgeSeg(cx, vec2<f32>(98.0, 212.0), vec2<f32>(134.0, 212.0), vec2<f32>(154.0, 300.0), vec2<f32>(192.0, 300.0)); }
  else if (cx < 284.0) { r = mfRidgeSeg(cx, vec2<f32>(192.0, 300.0), vec2<f32>(228.0, 300.0), vec2<f32>(252.0, 254.0), vec2<f32>(284.0, 254.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(284.0, 254.0), vec2<f32>(318.0, 254.0), vec2<f32>(346.0, 300.0), vec2<f32>(370.0, 356.0)); }
  return r;
}

fn mfRdgViolet3(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 100.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 386.0), vec2<f32>(10.0, 340.0), vec2<f32>(66.0, 296.0), vec2<f32>(100.0, 296.0)); }
  else if (cx < 194.0) { r = mfRidgeSeg(cx, vec2<f32>(100.0, 296.0), vec2<f32>(136.0, 296.0), vec2<f32>(156.0, 344.0), vec2<f32>(194.0, 344.0)); }
  else if (cx < 288.0) { r = mfRidgeSeg(cx, vec2<f32>(194.0, 344.0), vec2<f32>(230.0, 344.0), vec2<f32>(256.0, 312.0), vec2<f32>(288.0, 312.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(288.0, 312.0), vec2<f32>(320.0, 312.0), vec2<f32>(348.0, 346.0), vec2<f32>(370.0, 386.0)); }
  return r;
}

fn mfRdgIndigo1(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 176.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 392.0), vec2<f32>(40.0, 368.0), vec2<f32>(110.0, 300.0), vec2<f32>(176.0, 214.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(176.0, 214.0), vec2<f32>(216.0, 162.0), vec2<f32>(250.0, 120.0), vec2<f32>(370.0, 96.0)); }
  return r;
}

fn mfRdgIndigo2(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 184.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 404.0), vec2<f32>(50.0, 386.0), vec2<f32>(118.0, 330.0), vec2<f32>(184.0, 254.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(184.0, 254.0), vec2<f32>(222.0, 210.0), vec2<f32>(256.0, 176.0), vec2<f32>(370.0, 152.0)); }
  return r;
}

fn mfRdgIndigo3(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 192.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 424.0), vec2<f32>(60.0, 412.0), vec2<f32>(126.0, 372.0), vec2<f32>(192.0, 314.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(192.0, 314.0), vec2<f32>(230.0, 280.0), vec2<f32>(262.0, 254.0), vec2<f32>(370.0, 238.0)); }
  return r;
}

fn mfRdgGraphite1(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 96.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 330.0), vec2<f32>(-4.0, 290.0), vec2<f32>(44.0, 206.0), vec2<f32>(96.0, 206.0)); }
  else if (cx < 210.0) { r = mfRidgeSeg(cx, vec2<f32>(96.0, 206.0), vec2<f32>(142.0, 206.0), vec2<f32>(168.0, 150.0), vec2<f32>(210.0, 150.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(210.0, 150.0), vec2<f32>(262.0, 150.0), vec2<f32>(336.0, 278.0), vec2<f32>(370.0, 330.0)); }
  return r;
}

fn mfRdgGraphite2(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 100.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 356.0), vec2<f32>(4.0, 324.0), vec2<f32>(52.0, 254.0), vec2<f32>(100.0, 254.0)); }
  else if (cx < 214.0) { r = mfRidgeSeg(cx, vec2<f32>(100.0, 254.0), vec2<f32>(146.0, 254.0), vec2<f32>(172.0, 208.0), vec2<f32>(214.0, 208.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(214.0, 208.0), vec2<f32>(264.0, 208.0), vec2<f32>(338.0, 306.0), vec2<f32>(370.0, 356.0)); }
  return r;
}

fn mfRdgGraphite3(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 104.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 386.0), vec2<f32>(14.0, 358.0), vec2<f32>(60.0, 310.0), vec2<f32>(104.0, 310.0)); }
  else if (cx < 218.0) { r = mfRidgeSeg(cx, vec2<f32>(104.0, 310.0), vec2<f32>(150.0, 310.0), vec2<f32>(178.0, 278.0), vec2<f32>(218.0, 278.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(218.0, 278.0), vec2<f32>(266.0, 278.0), vec2<f32>(344.0, 344.0), vec2<f32>(370.0, 386.0)); }
  return r;
}

fn mfRidge(styleIdx: i32, layerIdx: i32, x: f32) -> vec2<f32> {
  var r = vec2<f32>(0.0);
  if (styleIdx == 0) {
    if (layerIdx == 0) { r = mfRdgViolet1(x); }
    else if (layerIdx == 1) { r = mfRdgViolet2(x); }
    else { r = mfRdgViolet3(x); }
  }
  else if (styleIdx == 1) {
    if (layerIdx == 0) { r = mfRdgIndigo1(x); }
    else if (layerIdx == 1) { r = mfRdgIndigo2(x); }
    else { r = mfRdgIndigo3(x); }
  }
  else {
    if (layerIdx == 0) { r = mfRdgGraphite1(x); }
    else if (layerIdx == 1) { r = mfRdgGraphite2(x); }
    else { r = mfRdgGraphite3(x); }
  }
  return r;
}

fn gRidgeAt(styleIdx: i32, layerIdx: i32, x: f32, py: f32, sigma: f32, sy: f32,
            tt: f32) -> f32 {
  let o = gAnimOffset(layerIdx, x, tt);
  let r = mfRidge(styleIdx, layerIdx, x + o.x);
  return gCoverage((r.x + o.y - py) * sy, sigma);
}

fn gRidgeCoverage(p: vec2<f32>, styleIdx: i32, layerIdx: i32, sigma: f32,
                  sx: f32, sy: f32, tt: f32) -> f32 {
  let sdx = sigma / max(sx, 0.0001);
  let n1 = GQN1 * sdx;
  let n2 = GQN2 * sdx;
  return GQW0 * gRidgeAt(styleIdx, layerIdx, p.x, p.y, sigma, sy, tt)
       + GQW1 * (gRidgeAt(styleIdx, layerIdx, p.x + n1, p.y, sigma, sy, tt)
               + gRidgeAt(styleIdx, layerIdx, p.x - n1, p.y, sigma, sy, tt))
       + GQW2 * (gRidgeAt(styleIdx, layerIdx, p.x + n2, p.y, sigma, sy, tt)
               + gRidgeAt(styleIdx, layerIdx, p.x - n2, p.y, sigma, sy, tt));
}

fn mfSrc(cuv: vec2<f32>) -> vec3<f32> {
  let res = u.size;

  let frame = gCardFrame(res);
  let halfExt = 0.5 * clamp(u.card, vec2<f32>(0.02), vec2<f32>(1.0)) * frame;

  let sx = max(halfExt.x / GREFX, 0.0001);
  let sy = max(halfExt.y / GREFY, 0.0001);
  let gs = max(min(sx, sy), 0.0001);

  let ldir = gLightDir();
  let inten = gIntensity();
  let sIdx = i32(u.style + 0.5);
  let tt = gAnimT();

  let dp = cuv * vec2<f32>(2.0 * GREFX, 2.0 * GREFY);

  var cardCol = u.bgColor.rgb;

  let o1 = gParallax(ldir, GPAR1);
  cardCol = gOver(cardCol, u.layer1Color.rgb,
                  gRidgeCoverage(dp - o1, sIdx, 0, u.layer1Blur * gs, sx, sy, tt) * inten);

  let o2 = gParallax(ldir, GPAR2);
  cardCol = gOver(cardCol, u.layer2Color.rgb,
                  gRidgeCoverage(dp - o2, sIdx, 1, u.layer2Blur * gs, sx, sy, tt) * inten);

  let o3 = gParallax(ldir, GPAR3);
  cardCol = gOver(cardCol, u.layer3Color.rgb,
                  gRidgeCoverage(dp - o3, sIdx, 2, u.layer3Blur * gs, sx, sy, tt) * inten);

  return cardCol;
}

fn mfTap(uv: vec2<f32>) -> vec3<f32> {
  return mfSrc(clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)));
}

fn mfBlurAt(uv: vec2<f32>, res: vec2<f32>, radiusPx: f32) -> vec3<f32> {
  if (radiusPx < 0.35) { return mfTap(uv); }
  let step = radiusPx / max(res, vec2<f32>(1.0));
  var sum = mfTap(uv) * 0.18;
  for (var i = 0; i < 8; i = i + 1) {
    let ang = (f32(i) / 8.0) * 6.2831853;
    let d = vec2<f32>(cos(ang), sin(ang));
    sum = sum + mfTap(uv + d * step * 0.55) * 0.075;
    sum = sum + mfTap(uv + d * step) * 0.0275;
  }
  return sum;
}

fn mfMotionAt(uv: vec2<f32>, res: vec2<f32>, radiusPx: f32, angleDeg: f32) -> vec3<f32> {
  if (radiusPx < 0.35) { return mfTap(uv); }
  let th = angleDeg * 0.017453292;
  let d = vec2<f32>(cos(th), sin(th)) * radiusPx / max(res, vec2<f32>(1.0));
  var sum = vec3<f32>(0.0);
  for (var i = -8; i <= 8; i = i + 1) {
    sum = sum + mfTap(uv + d * (f32(i) / 8.0));
  }
  return sum / 17.0;
}

fn mfLuma(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn mfFilmGrain(uv: vec2<f32>) -> f32 {
  let x = (uv.x + 4.0) * (uv.y + 4.0) * 10.0;
  return (((x % 13.0) + 1.0) * ((x % 123.0) + 1.0)) % 0.01 - 0.005;
}

fn mfHash21(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn mfVnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mfHash21(i), mfHash21(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(mfHash21(i + vec2<f32>(0.0, 1.0)), mfHash21(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y,
  );
}

fn mfAspect(res: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(res.x / max(res.y, 1.0), 1.0);
}

fn mfFilter(uv: vec2<f32>, res: vec2<f32>, mode: f32, ppp: f32,
            fAmount: f32,
            fScale: f32,
            fBlur: f32,
            fFade: f32,
            fSoft: f32,
            fAngle: f32,
            fGrain: f32,
            fBrightness: f32,
            fContrast: f32,
            fSaturation: f32,
            fRound: f32,
            fBevel: f32,
            fInset: f32) -> vec3<f32> {
  let m = i32(mode + 0.5);
  var col = mfTap(uv);

  if (m == 5) {
    let a = fBlur;
    col = mfBlurAt(uv, res, a * ppp);
  } else if (m == 6) {
    let a = fBlur;
    let b = fFade;
    let k = smoothstep(clamp(1.0 - b, 0.0, 0.999), 1.0, uv.y);
    col = mix(col, mfBlurAt(uv, res, a * ppp), k);
  } else if (m == 11) {
    col = mfMotionAt(uv, res, fBlur * ppp, fAngle);
  } else if (m == 7) {
    let a = fAmount;
    let b = fSoft;
    let halfDiag = length(res) * 0.5;
    let r = length((uv - vec2<f32>(0.5)) * res) / max(halfDiag, 1.0);
    let inner = mix(0.95, 0.15, clamp(b, 0.0, 1.0));
    let k = clamp((r - inner) / max(1.05 - inner, 0.001), 0.0, 1.0);
    col = col * (1.0 - clamp(a, 0.0, 1.0) * k);
  } else if (m == 8) {
    let a = fBrightness;
    col = clamp(col + vec3<f32>(a), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 9) {
    let a = fContrast;
    col = clamp((col - vec3<f32>(0.5)) * a + vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 10) {
    let a = fSaturation;
    col = clamp(mix(vec3<f32>(mfLuma(col)), col, a), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 1) {
    let a = fGrain;
    col = clamp(col + vec3<f32>(mfFilmGrain(uv) * a), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 2) {
    let a = fAmount;
    let b = fScale;
    let s = max(b, 0.5);
    let w = vec2<f32>(
      sin(uv.y * s * 6.2831853 + 1.3) + 0.5 * sin(uv.y * s * 12.9 + 0.7),
      cos(uv.x * s * 6.2831853 + 2.1) + 0.5 * cos(uv.x * s * 11.3 + 1.9),
    );
    col = mfTap(uv + w * a * 0.02);
  } else if (m == 4) {
    let a = fAmount;
    let b = fScale;
    let asp = mfAspect(res);
    let cell = floor(uv * asp * max(b, 1.0));
    let h1 = mfHash21(cell);
    let h2 = mfHash21(cell + vec2<f32>(37.0, 17.0));
    let off = (vec2<f32>(h1, h2) - vec2<f32>(0.5)) * a * 0.06 / asp;
    col = clamp(mfTap(uv + off) * (1.0 + (h1 - 0.5) * a * 0.35), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 3) {
    let a = fAmount;
    let b = fBlur;
    let asp = mfAspect(res);
    let p = uv * asp * 42.0;
    let n = vec2<f32>(mfVnoise(p), mfVnoise(p + vec2<f32>(7.3, 2.1))) - vec2<f32>(0.5);
    col = mfBlurAt(uv + n * a * 0.05 / asp, res, b * ppp);
  }
  return col;
}

fn ridge(uv01: vec2<f32>) -> vec4<f32> {
  let res = u.size;
  let p = uv01 * res;
  let frame = gCardFrame(res);
  let halfExt = 0.5 * clamp(u.card, vec2<f32>(0.02), vec2<f32>(1.0)) * frame;
  let q = p - 0.5 * res;
  let gs = max(min(halfExt.x / GREFX, halfExt.y / GREFY), 0.0001);
  let r = clamp(u.radius * gs, 0.0, min(halfExt.x, halfExt.y));

  var col = GCANVAS;

  let ldirC = gLightDir();
  col = mfsCardShadow(col, q, halfExt, r, gs, ldirC, u.shadowAmt,
                      gIntensity(), u.shadowColor.rgb);

  let cres = 2.0 * halfExt;
  let cuv = (q + halfExt) / max(cres, vec2<f32>(1.0));
  var cardCol = mfFilter(cuv, cres, u.filterId, frame.x / 393.0,
                         u.fAmount, u.fScale, u.fBlur, u.fFade, u.fSoft, u.fAngle, u.fGrain, u.fBrightness, u.fContrast, u.fSaturation, u.fRound, u.fBevel, u.fInset);

  if (u.grainAmt > 0.0) {
    let np = q / gs * max(u.grainFreq, 0.0001);
    let gp = gGrainPhase(gAnimT());
    let nr = gLinearToSRGB(gFractal(np, 0.0 + gp));
    let ng = gLinearToSRGB(gFractal(np, 101.0 + gp));
    let nb = gLinearToSRGB(gFractal(np, 211.0 + gp));
    let na = gFractal(np, 307.0 + gp);
    let mixed = vec3<f32>(gOverlay(cardCol.r, nr), gOverlay(cardCol.g, ng), gOverlay(cardCol.b, nb));
    cardCol = mix(cardCol, mixed, clamp(u.grainAmt * na, 0.0, 1.0));
  }

  let dCard = gSdRoundBox(q, halfExt, r);
  col = gOver(col, cardCol, 1.0 - smoothstep(-1.0, 1.0, dCard));

  let dth = (fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  return vec4<f32>(clamp(col + vec3<f32>(dth), vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
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
  return ridge(in.uv);
}
`;

const UNIFORMS = new Float32Array([
    0.0, 0.0,
    0.0,
    1.0,
    0.0,
    28.0,
    44.0,
    28.0,
    20.0,
    0.2,
    0.78,
    1.0,
    0.1,
    1.0,
    1.0,
    1.0,
    2.0,
    0.35,
    0.4,
    0.25,
    0.88, 0.52,
    0.5, 1.0,
    1.0, 1.0, 1.0, 1.0,
    0.48235294, 0.44705883, 1.0, 1.0,
    0.16470589, 0.11764706, 0.61960787, 1.0,
    0.019607844, 0.015686275, 0.09411765, 1.0,
    0.32941177, 0.28235295, 1.0, 1.0,
    0.0,
    0.5,
    5.0,
    8.0,
    0.45,
    0.5,
    0.0,
    16.0,
    0.0,
    1.0,
    1.0,
    0.45,
    0.3,
    0.08,
    0.0, 0.0,
]);

const SIZE_WORD = 0;
const TIME_WORD = 2;
const ANIMATED = true;
const CLEAR_ALPHA = 1;
export default function RidgeIndigoView() {
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
