"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:        vec2<f32>,
  time:        f32,
  style:       f32,
  anim:        f32,
  radius:      f32,
  mound1Blur:  f32,
  mound2Blur:  f32,
  glowAmt:     f32,
  baseGlow:    f32,
  dotSpacing:  f32,
  dotSize:     f32,
  dotAmt:      f32,
  dotMotion:   f32,
  dotSpeed:    f32,
  dotDepth:    f32,
  dotStyle:    f32,
  dotLayer:    f32,
  dotAngle:    f32,
  dotVary:     f32,
  borderAmt:   f32,
  intensity:   f32,
  shadowAmt:   f32,
  animSpeed:   f32,
  animAmount:  f32,
  animSpread:  f32,
  waveFreq:    f32,
  lightSway:   f32,
  glowPulse:   f32,
  card:        vec2<f32>,
  light:       vec2<f32>,
  bgColor:     vec4<f32>,
  mound1Color: vec4<f32>,
  mound2Color: vec4<f32>,
  poolTint:    vec4<f32>,
  dotColor:    vec4<f32>,
  borderColor: vec4<f32>,
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
const GREFY: f32 = 150.0;

const GK: f32 = 2.104;

const GCANVAS: vec3<f32> = vec3<f32>(0.02745098, 0.02745098, 0.04313725);

const GPAR1: f32 = 8.0;
const GPAR2: f32 = 14.0;

const GBASE_BOTTOM: f32 = -0.06;
const GBASE_HEIGHT: f32 = 0.16;
const GBASE_MID: f32 = 0.72;
const GBASE_BLUR: f32 = 12.0;

const GWAVE_ANGLE: f32 = 0.7853982;
const GWAVE_COUNT: f32 = 2.0;

const GAW_BACK: f32 = 0.62;

const GAMP_WAVE: f32 = 11.0;
const GAMP_SWELL: f32 = 17.0;
const GAMP_DRIFT: f32 = 26.0;

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

fn gMixStop(c1: vec3<f32>, a1: f32, c2: vec3<f32>, a2: f32, f: f32) -> vec4<f32> {
  let p1 = vec4<f32>(c1 * a1, a1);
  let p2 = vec4<f32>(c2 * a2, a2);
  let pm = mix(p1, p2, clamp(f, 0.0, 1.0));
  var rgb = c2;
  if (pm.a > 1e-6) { rgb = pm.rgb / pm.a; }
  return vec4<f32>(rgb, pm.a);
}

fn gParallax(ldir: vec2<f32>, k: f32) -> vec2<f32> {
  return (ldir - vec2<f32>(0.0, 1.0)) * k;
}

fn gAnimT() -> f32 {
  if (i32(u.anim + 0.5) > 2) { return 0.0; }
  return u.time * max(u.animSpeed, 0.0);
}

fn gAnimDepth(layerIdx: i32) -> i32 {
  return 1 - layerIdx;
}

fn gAnimWeight(layerIdx: i32) -> f32 {
  var w = 1.0;
  if (gAnimDepth(layerIdx) == 1) { w = GAW_BACK; }
  return mix(1.0, w, clamp(u.animSpread, 0.0, 2.0));
}

fn gAnimOffset(layerIdx: i32, x: f32, tt: f32) -> vec2<f32> {
  let mode = i32(u.anim + 0.5);
  var o = vec2<f32>(0.0);
  if (mode <= 2) {
    let d = f32(gAnimDepth(layerIdx));
    let w = gAnimWeight(layerIdx) * max(u.animAmount, 0.0);
    let rate = 1.0 - 0.22 * d;
    let ph = d * 0.9;
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

fn gDotHash(cell: vec2<f32>, salt: f32) -> f32 {
  return fract(sin(dot(cell + vec2<f32>(salt), vec2<f32>(127.1, 311.7))) * 43758.5453123);
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

fn mfSpkPurple1(x: f32) -> vec2<f32> {
  let cx = clamp(x, -60.0, 360.0);
  var r = vec2<f32>(0.0);
  if (cx < 150.0) { r = mfRidgeSeg(cx, vec2<f32>(-60.0, 304.0), vec2<f32>(26.0, 288.0), vec2<f32>(104.0, 122.0), vec2<f32>(150.0, 122.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(150.0, 122.0), vec2<f32>(196.0, 122.0), vec2<f32>(274.0, 288.0), vec2<f32>(360.0, 304.0)); }
  return r;
}

fn mfSpkPurple2(x: f32) -> vec2<f32> {
  let cx = clamp(x, -60.0, 360.0);
  var r = vec2<f32>(0.0);
  if (cx < 150.0) { r = mfRidgeSeg(cx, vec2<f32>(-60.0, 306.0), vec2<f32>(34.0, 298.0), vec2<f32>(110.0, 168.0), vec2<f32>(150.0, 168.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(150.0, 168.0), vec2<f32>(190.0, 168.0), vec2<f32>(266.0, 298.0), vec2<f32>(360.0, 306.0)); }
  return r;
}

fn mfSpkAqua1(x: f32) -> vec2<f32> {
  let cx = clamp(x, -60.0, 360.0);
  var r = vec2<f32>(0.0);
  if (cx < 92.0) { r = mfRidgeSeg(cx, vec2<f32>(-60.0, 306.0), vec2<f32>(-30.0, 240.0), vec2<f32>(40.0, 86.0), vec2<f32>(92.0, 110.0)); }
  else if (cx < 300.0) { r = mfRidgeSeg(cx, vec2<f32>(92.0, 110.0), vec2<f32>(150.0, 136.0), vec2<f32>(214.0, 272.0), vec2<f32>(300.0, 300.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(300.0, 300.0), vec2<f32>(320.0, 306.6667), vec2<f32>(340.0, 313.3333), vec2<f32>(360.0, 320.0)); }
  return r;
}

fn mfSpkAqua2(x: f32) -> vec2<f32> {
  let cx = clamp(x, -60.0, 360.0);
  var r = vec2<f32>(0.0);
  if (cx < 92.0) { r = mfRidgeSeg(cx, vec2<f32>(-60.0, 308.0), vec2<f32>(-26.0, 262.0), vec2<f32>(44.0, 150.0), vec2<f32>(92.0, 168.0)); }
  else if (cx < 300.0) { r = mfRidgeSeg(cx, vec2<f32>(92.0, 168.0), vec2<f32>(146.0, 188.0), vec2<f32>(208.0, 282.0), vec2<f32>(300.0, 304.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(300.0, 304.0), vec2<f32>(320.0, 309.3333), vec2<f32>(340.0, 314.6667), vec2<f32>(360.0, 320.0)); }
  return r;
}

fn mfSpkLime1(x: f32) -> vec2<f32> {
  let cx = clamp(x, -60.0, 360.0);
  var r = vec2<f32>(0.0);
  if (cx < 88.0) { r = mfRidgeSeg(cx, vec2<f32>(-60.0, 304.0), vec2<f32>(-14.0, 286.0), vec2<f32>(44.0, 150.0), vec2<f32>(88.0, 150.0)); }
  else if (cx < 168.0) { r = mfRidgeSeg(cx, vec2<f32>(88.0, 150.0), vec2<f32>(130.0, 150.0), vec2<f32>(148.0, 262.0), vec2<f32>(168.0, 262.0)); }
  else if (cx < 246.0) { r = mfRidgeSeg(cx, vec2<f32>(168.0, 262.0), vec2<f32>(190.0, 262.0), vec2<f32>(208.0, 168.0), vec2<f32>(246.0, 168.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(246.0, 168.0), vec2<f32>(292.0, 168.0), vec2<f32>(336.0, 286.0), vec2<f32>(360.0, 304.0)); }
  return r;
}

fn mfSpkLime2(x: f32) -> vec2<f32> {
  let cx = clamp(x, -60.0, 360.0);
  var r = vec2<f32>(0.0);
  if (cx < 90.0) { r = mfRidgeSeg(cx, vec2<f32>(-60.0, 308.0), vec2<f32>(-8.0, 296.0), vec2<f32>(48.0, 196.0), vec2<f32>(90.0, 196.0)); }
  else if (cx < 170.0) { r = mfRidgeSeg(cx, vec2<f32>(90.0, 196.0), vec2<f32>(130.0, 196.0), vec2<f32>(150.0, 278.0), vec2<f32>(170.0, 278.0)); }
  else if (cx < 246.0) { r = mfRidgeSeg(cx, vec2<f32>(170.0, 278.0), vec2<f32>(192.0, 278.0), vec2<f32>(210.0, 212.0), vec2<f32>(246.0, 212.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(246.0, 212.0), vec2<f32>(290.0, 212.0), vec2<f32>(338.0, 296.0), vec2<f32>(360.0, 308.0)); }
  return r;
}

fn mfRidge(styleIdx: i32, layerIdx: i32, x: f32) -> vec2<f32> {
  var r = vec2<f32>(0.0);
  if (styleIdx == 0) {
    if (layerIdx == 0) { r = mfSpkPurple1(x); }
    else { r = mfSpkPurple2(x); }
  }
  else if (styleIdx == 1) {
    if (layerIdx == 0) { r = mfSpkAqua1(x); }
    else { r = mfSpkAqua2(x); }
  }
  else {
    if (layerIdx == 0) { r = mfSpkLime1(x); }
    else { r = mfSpkLime2(x); }
  }
  return r;
}

fn gMoundAt(styleIdx: i32, layerIdx: i32, x: f32, py: f32, sigma: f32, sy: f32,
            tt: f32) -> f32 {
  let o = gAnimOffset(layerIdx, x, tt);
  let r = mfRidge(styleIdx, layerIdx, x + o.x);
  return gCoverage((r.x + o.y - py) * sy, sigma);
}

fn gMoundCoverage(p: vec2<f32>, styleIdx: i32, layerIdx: i32, sigma: f32,
                  sx: f32, sy: f32, tt: f32) -> f32 {
  let sdx = sigma / max(sx, 0.0001);
  let n1 = GQN1 * sdx;
  let n2 = GQN2 * sdx;
  return GQW0 * gMoundAt(styleIdx, layerIdx, p.x, p.y, sigma, sy, tt)
       + GQW1 * (gMoundAt(styleIdx, layerIdx, p.x + n1, p.y, sigma, sy, tt)
               + gMoundAt(styleIdx, layerIdx, p.x - n1, p.y, sigma, sy, tt))
       + GQW2 * (gMoundAt(styleIdx, layerIdx, p.x + n2, p.y, sigma, sy, tt)
               + gMoundAt(styleIdx, layerIdx, p.x - n2, p.y, sigma, sy, tt));
}

fn gPoolBox(styleIdx: i32) -> vec4<f32> {
  var b = vec4<f32>(-0.14, 1.28, -0.18, 0.44);
  if (styleIdx == 1) { b = vec4<f32>(-0.24, 0.70, -0.20, 0.38); }
  else if (styleIdx == 2) { b = vec4<f32>(0.02, 0.96, -0.22, 0.40); }
  return b;
}

fn gPoolStops(styleIdx: i32) -> vec4<f32> {
  var s = vec4<f32>(0.46, 0.72, 0.92, 0.50);
  if (styleIdx == 1) { s = vec4<f32>(0.40, 0.70, 0.90, 0.45); }
  else if (styleIdx == 2) { s = vec4<f32>(0.42, 0.72, 0.82, 0.40); }
  return s;
}

fn gSdTri(p0: vec2<f32>, r: f32) -> f32 {
  let k = 1.7320508;
  var p = vec2<f32>(abs(p0.x) - r, p0.y + r / k);
  if (p.x + k * p.y > 0.0) {
    p = vec2<f32>(p.x - k * p.y, -k * p.x - p.y) * 0.5;
  }
  p.x = p.x - clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

fn gPattern(gp: vec2<f32>, pitch: f32, rad: f32, aa: f32, style: i32) -> vec3<f32> {
  let baseCell = floor(gp / pitch);
  let off = gp - (baseCell + vec2<f32>(0.5)) * pitch;

  if (style == 1) {
    return vec3<f32>(1.0 - smoothstep(rad - aa, rad + aa, length(off)), baseCell);
  }
  if (style == 2) {
    let w = max(rad * 0.38, 0.22);
    let pick = gDotHash(baseCell, 53.9) * 3.0;
    var d: f32;
    if (pick < 1.0) {
      d = abs(length(off) - rad);
    } else if (pick < 2.0) {
      d = abs(max(abs(off.x), abs(off.y)) - rad);
    } else {
      d = abs(gSdTri(vec2<f32>(off.x, -off.y), rad));
    }
    return vec3<f32>(1.0 - smoothstep(w - aa, w + aa, d), baseCell);
  }
  if (style == 3) {
    let w = max(rad * 0.38, 0.15);
    return vec3<f32>(1.0 - smoothstep(w - aa, w + aa, min(abs(off.x), abs(off.y))), baseCell);
  }
  if (style == 4) {
    let w = max(rad * 0.34, 0.18);
    let d = min(max(abs(off.x) - rad, abs(off.y) - w),
                max(abs(off.y) - rad, abs(off.x) - w));
    return vec3<f32>(1.0 - smoothstep(-aa, aa, d), baseCell);
  }
  let lit = 0.1 + 0.9 * gDotHash(baseCell, 41.7);
  let cov = 1.0 - smoothstep(rad - aa, rad + aa, max(abs(off.x), abs(off.y)));
  return vec3<f32>(cov * lit * lit, baseCell);
}

fn gDots(dp: vec2<f32>, t: f32, aa: f32) -> f32 {
  let style = i32(u.dotStyle + 0.5);
  if (style <= 0) { return 0.0; }
  let pitch = max(u.dotSpacing, 0.5);
  let ang = radians(u.dotAngle);
  let ca = cos(ang);
  let sa = sin(ang);
  let gp = vec2<f32>(dp.x * ca - dp.y * sa, dp.x * sa + dp.y * ca);
  let rad = max(u.dotSize, 0.05);

  let hit = gPattern(gp, pitch, rad, aa, style);
  let cov = hit.x;
  let cell = hit.yz;
  if (cov <= 0.0) { return 0.0; }

  let mode = i32(u.dotMotion + 0.5);
  let amount = clamp(u.dotDepth, 0.0, 1.0);
  var level = 1.0;
  if (mode == 1) {
    let jitter = 0.5 + gDotHash(cell, 0.0) * 1.3;
    let phase = gDotHash(cell, 61.7) * 6.2831853;
    let wv = sin(t * u.dotSpeed * jitter + phase);
    let pulse = pow(max(0.0, wv), 1.6);
    level = 1.0 - amount * (1.0 - pulse);
  } else if (mode == 2) {
    let along = (dp.x * cos(GWAVE_ANGLE) + dp.y * sin(GWAVE_ANGLE)) / (2.0 * max(GREFX, GREFY));
    let wv = sin(along * 6.2831853 * GWAVE_COUNT - t * u.dotSpeed * 2.0);
    level = 1.0 - amount * (1.0 - (0.5 + 0.5 * wv));
  } else if (mode == 3) {
    let wv = sin(t * u.dotSpeed);
    level = 1.0 - amount * (1.0 - (0.5 + 0.5 * wv));
  }
  level = level * (1.0 - clamp(u.dotVary, 0.0, 1.0) * gDotHash(cell, 19.3));
  return cov * clamp(level, 0.0, 1.0);
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

  if (u.dotLayer > 0.5 && u.dotAmt > 0.0) {
    cardCol = gOver(cardCol, u.dotColor.rgb,
                    gDots(dp, u.time, max(0.35, 0.8 / gs)) * u.dotAmt);
  }

  let o1 = gParallax(ldir, GPAR1);
  cardCol = gOver(cardCol, u.mound1Color.rgb,
                  gMoundCoverage(dp - o1, sIdx, 0, u.mound1Blur * gs, sx, sy, tt) * inten);

  let o2 = gParallax(ldir, GPAR2);
  cardCol = gOver(cardCol, u.mound2Color.rgb,
                  gMoundCoverage(dp - o2, sIdx, 1, u.mound2Blur * gs, sx, sy, tt) * inten);

  let box = gPoolBox(sIdx);
  let st = gPoolStops(sIdx);
  var bx = vec2<f32>(box.x + box.y * 0.5, 1.0 - box.z - box.w * 0.5);
  let bh = max(vec2<f32>(box.y, box.w) * 0.5, vec2<f32>(0.0001));
  let po = gAnimOffset(1, bx.x * 2.0 * GREFX, tt) / vec2<f32>(2.0 * GREFX, 2.0 * GREFY);
  bx = bx + po;
  let t = length((cuv - bx) / bh);
  let white = vec3<f32>(1.0);
  var g = vec4<f32>(0.0);
  if (t < st.x) {
    g = gMixStop(white, 1.0, white, st.z, t / max(st.x, 0.0001));
  } else if (t < st.y) {
    g = gMixStop(white, st.z, u.poolTint.rgb, st.w, (t - st.x) / max(st.y - st.x, 0.0001));
  } else {
    g = gMixStop(u.poolTint.rgb, st.w, u.poolTint.rgb, 0.0, (t - st.y) / max(0.90 - st.y, 0.0001));
  }
  cardCol = gOver(cardCol, g.rgb, g.a * max(0.0, u.glowAmt) * inten);

  if (u.baseGlow > 0.0) {
    let top = 1.0 - GBASE_BOTTOM - GBASE_HEIGHT + po.y;
    let v = clamp((cuv.y - top) / max(GBASE_HEIGHT * GBASE_MID, 0.0001), 0.0, 1.0);
    let ex = abs(cuv.x - 0.5) * 2.0 * GREFX - GREFX;
    let cov = gCoverage(ex * gs, GBASE_BLUR * gs);
    cardCol = gOver(cardCol, white, v * cov * max(0.0, u.baseGlow) * inten);
  }

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

fn spike(uv01: vec2<f32>) -> vec4<f32> {
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

  let dp = cuv * vec2<f32>(2.0 * GREFX, 2.0 * GREFY);
  let aaDot = max(0.35, 0.8 / gs);
  if (u.dotLayer < 0.5 && u.dotAmt > 0.0) {
    cardCol = gOver(cardCol, u.dotColor.rgb, gDots(dp, u.time, aaDot) * u.dotAmt);
  }

  let dCard = gSdRoundBox(q, halfExt, r);
  col = gOver(col, cardCol, 1.0 - smoothstep(-1.0, 1.0, dCard));

  if (u.borderAmt > 0.0) {
    let w = max(1.0 * gs, 0.5);
    let band = gCoverage(dCard, 0.6) - gCoverage(dCard + w, 0.6);
    col = gOver(col, u.borderColor.rgb, band * u.borderAmt);
    let topMask = clamp(1.0 - cuv.y * 2.0, 0.0, 1.0);
    col = gOver(col, u.borderColor.rgb, band * topMask * u.borderAmt * 1.27);
  }

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
  return spike(in.uv);
}
`;

const UNIFORMS = new Float32Array([
    0.0, 0.0,
    0.0,
    2.0,
    0.0,
    38.0,
    26.0,
    17.0,
    1.0,
    0.0,
    12.0,
    0.8,
    0.45,
    0.0,
    1.6,
    0.85,
    1.0,
    0.0,
    0.0,
    0.0,
    0.11,
    1.0,
    0.1,
    1.0,
    1.0,
    1.0,
    2.0,
    0.35,
    0.25,
    0.0,
    0.87, 0.4,
    0.5, 1.0,
    0.0, 0.0,
    0.019607844, 0.023529412, 0.015686275, 1.0,
    0.30980393, 0.61960787, 0.0, 1.0,
    0.7137255, 0.9607843, 0.23529412, 1.0,
    0.78431374, 0.98039216, 0.47058824, 1.0,
    1.0, 1.0, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    0.7137255, 0.9607843, 0.23529412, 1.0,
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
export default function SpikeLimeView() {
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
