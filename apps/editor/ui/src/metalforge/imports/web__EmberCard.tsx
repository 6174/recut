"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:        vec2<f32>,
  time:        f32,
  anim:        f32,
  radius:      f32,
  wave1Blur:   f32,
  wave2Blur:   f32,
  wave3Blur:   f32,
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
  wellColor:   vec4<f32>,
  wave1Color:  vec4<f32>,
  wave2Color:  vec4<f32>,
  wave3Color:  vec4<f32>,
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

const EREFX: f32 = 160.0;
const EREFY: f32 = 210.0;

const EK: f32 = 2.104;

const ECANVAS: vec3<f32> = vec3<f32>(0.02745098, 0.02745098, 0.04313725);

const EVBW: f32 = 282.0;
const EVBH: f32 = 366.0;
const ESX: f32 = 310.0 / 282.0;
const ESY: f32 = 394.0 / 366.0;
const ERX: f32 = -14.0;
const ERYBACK: f32 = -14.0;
const ERYFRONT: f32 = 16.0;

const EW1P0: vec2<f32> = vec2<f32>(-30.0, 180.0);
const EW1C1: vec2<f32> = vec2<f32>(40.0, 152.0);
const EW1C2: vec2<f32> = vec2<f32>(110.0, 150.0);
const EW1P1: vec2<f32> = vec2<f32>(170.0, 182.0);
const EW1C3: vec2<f32> = vec2<f32>(220.0, 208.0);
const EW1C4: vec2<f32> = vec2<f32>(262.0, 222.0);
const EW1P2: vec2<f32> = vec2<f32>(312.0, 232.0);

const EW2P0: vec2<f32> = vec2<f32>(-30.0, 284.0);
const EW2C1: vec2<f32> = vec2<f32>(30.0, 290.0);
const EW2C2: vec2<f32> = vec2<f32>(80.0, 286.0);
const EW2P1: vec2<f32> = vec2<f32>(140.0, 264.0);
const EW2C3: vec2<f32> = vec2<f32>(200.0, 242.0);
const EW2C4: vec2<f32> = vec2<f32>(256.0, 228.0);
const EW2P2: vec2<f32> = vec2<f32>(312.0, 226.0);

const EW3P0: vec2<f32> = vec2<f32>(-30.0, 295.0);
const EW3C1: vec2<f32> = vec2<f32>(30.0, 278.0);
const EW3C2: vec2<f32> = vec2<f32>(110.0, 278.0);
const EW3P1: vec2<f32> = vec2<f32>(160.0, 306.0);
const EW3C3: vec2<f32> = vec2<f32>(200.0, 328.0);
const EW3C4: vec2<f32> = vec2<f32>(260.0, 322.0);
const EW3P2: vec2<f32> = vec2<f32>(312.0, 314.0);

const EW3ALPHA: f32 = 0.9;

const EW1PAR: f32 = 20.0;
const EW2PAR: f32 = 34.0;
const EW3PAR: f32 = 48.0;

const EAW_MID: f32 = 0.62;
const EAW_BACK: f32 = 0.38;

const EAMP_WAVE: f32 = 15.0;
const EAMP_SWELL: f32 = 24.0;
const EAMP_DRIFT: f32 = 36.0;

const ETAU: f32 = 6.28318530718;

fn eCardFrame(res: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(393.0, 851.0) * max(min(res.x / 393.0, res.y / 851.0), 0.0001);
}

fn eSdRoundBox(p: vec2<f32>, ext: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - ext + vec2<f32>(r);
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn eCoverage(d: f32, sigma: f32) -> f32 {
  let s = max(sigma, 0.000001);
  return 1.0 - smoothstep(-EK * s, EK * s, d);
}

fn eBez1(a: f32, b: f32, c: f32, d: f32, t: f32) -> f32 {
  let m = 1.0 - t;
  return m * m * m * a + 3.0 * m * m * t * b + 3.0 * m * t * t * c + t * t * t * d;
}

fn eSegY(x: f32, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, d: vec2<f32>) -> f32 {
  var lo = 0.0;
  var hi = 1.0;
  for (var i = 0; i < 16; i = i + 1) {
    let mid = 0.5 * (lo + hi);
    if (eBez1(a.x, b.x, c.x, d.x, mid) < x) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  let t = 0.5 * (lo + hi);
  return eBez1(a.y, b.y, c.y, d.y, t);
}

fn eWaveV(uu: f32, ry: f32,
          p0: vec2<f32>, c1: vec2<f32>, c2: vec2<f32>, p1: vec2<f32>,
          c3: vec2<f32>, c4: vec2<f32>, p2: vec2<f32>) -> f32 {
  let px = clamp((uu * EVBW - ERX) / ESX, p0.x, p2.x);
  var py: f32;
  if (px < p1.x) {
    py = eSegY(px, p0, c1, c2, p1);
  } else {
    py = eSegY(px, p1, c3, c4, p2);
  }
  return (ry + py * ESY) / EVBH;
}

fn eParallax(ldir: vec2<f32>, k: f32, gs: f32) -> vec2<f32> {
  return (ldir - vec2<f32>(0.0, 1.0)) * k * gs;
}

fn eOver(dst: vec3<f32>, src: vec3<f32>, a: f32) -> vec3<f32> {
  return mix(dst, src, clamp(a, 0.0, 1.0));
}

fn eAnimT() -> f32 {
  if (i32(u.anim + 0.5) > 2) { return 0.0; }
  return u.time * max(u.animSpeed, 0.0);
}

fn eAnimDepth(layerIdx: i32) -> i32 {
  return 2 - layerIdx;
}

fn eAnimWeight(layerIdx: i32) -> f32 {
  let d = eAnimDepth(layerIdx);
  var w = 1.0;
  if (d == 1) { w = EAW_MID; }
  else if (d == 2) { w = EAW_BACK; }
  return mix(1.0, w, clamp(u.animSpread, 0.0, 2.0));
}

fn eAnimOffset(layerIdx: i32, uu: f32, tt: f32) -> vec2<f32> {
  let mode = i32(u.anim + 0.5);
  var o = vec2<f32>(0.0);
  if (mode <= 2) {
    let d = f32(eAnimDepth(layerIdx));
    let w = eAnimWeight(layerIdx) * max(u.animAmount, 0.0);
    let rate = 1.0 - 0.22 * d;
    let ph = d * 0.9;
    if (mode == 0) {
      o.y = EAMP_WAVE * w * sin(ETAU * max(u.waveFreq, 0.0) * uu - tt * 1.1 * rate + ph);
    } else if (mode == 1) {
      o.y = EAMP_SWELL * w * sin(tt * 0.75 * rate + ph);
      o.x = 0.45 * EAMP_SWELL * w * sin(tt * 0.38 * rate + ph + 1.7);
    } else {
      o.x = EAMP_DRIFT * w * sin(tt * 0.55 * rate + ph);
      o.y = 0.30 * EAMP_DRIFT * w * sin(tt * 0.37 * rate + ph + 2.1);
    }
  }
  return o;
}

fn eLightDir() -> vec2<f32> {
  let tt = eAnimT();
  let s = 0.5 * clamp(u.lightSway, 0.0, 1.0);
  return (u.light - vec2<f32>(0.5)) * 2.0
       + vec2<f32>(sin(tt * 0.31), sin(tt * 0.23)) * s;
}

fn eIntensity() -> f32 {
  let tt = eAnimT();
  let pulse = 1.0 + 0.35 * clamp(u.glowPulse, 0.0, 1.0) * sin(tt * 0.8);
  return max(0.0, u.intensity) * max(pulse, 0.0);
}

fn mfSrc(cuv: vec2<f32>) -> vec3<f32> {
  let res = u.size;

  let frame = eCardFrame(res);
  let halfExt = 0.5 * clamp(u.card, vec2<f32>(0.02), vec2<f32>(1.0)) * frame;
  let q = (cuv - vec2<f32>(0.5)) * 2.0 * halfExt;

  let gs = max(min(halfExt.x / EREFX, halfExt.y / EREFY), 0.0001);

  let ldir = eLightDir();
  let inten = eIntensity();
  let tt = eAnimT();

  let wellExt = halfExt;

  let wellRes = 2.0 * wellExt;

  var cardCol = u.wellColor.rgb;

  let w1 = (q - eParallax(ldir, EW1PAR, gs) + wellExt) / wellRes;
  let a1 = eAnimOffset(0, w1.x, tt) * gs / wellRes;
  let v1 = eWaveV(w1.x + a1.x, ERYBACK, EW1P0, EW1C1, EW1C2, EW1P1, EW1C3, EW1C4, EW1P2) + a1.y;
  let s1 = u.wave1Blur * gs / wellRes.y;
  let cov1 = eCoverage(v1 - w1.y, s1);
  cardCol = eOver(cardCol, u.wave1Color.rgb, cov1 * inten);

  let w2 = (q - eParallax(ldir, EW2PAR, gs) + wellExt) / wellRes;
  let a2 = eAnimOffset(1, w2.x, tt) * gs / wellRes;
  let v2 = eWaveV(w2.x + a2.x, ERYBACK, EW2P0, EW2C1, EW2C2, EW2P1, EW2C3, EW2C4, EW2P2) + a2.y;
  let s2 = u.wave2Blur * gs / wellRes.y;
  let cov2 = eCoverage(v2 - w2.y, s2);
  cardCol = eOver(cardCol, u.wave2Color.rgb, cov2 * inten);

  let w3 = (q - eParallax(ldir, EW3PAR, gs) + wellExt) / wellRes;
  let a3 = eAnimOffset(2, w3.x, tt) * gs / wellRes;
  let v3 = eWaveV(w3.x + a3.x, ERYFRONT, EW3P0, EW3C1, EW3C2, EW3P1, EW3C3, EW3C4, EW3P2) + a3.y;
  let s3 = u.wave3Blur * gs / wellRes.y;
  let cov3 = eCoverage(v3 - w3.y, s3);
  cardCol = cardCol + u.wave3Color.rgb * (EW3ALPHA * cov3 * inten);

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

fn ember(uv01: vec2<f32>) -> vec4<f32> {
  let res = u.size;
  let p = uv01 * res;
  let frame = eCardFrame(res);
  let halfExt = 0.5 * clamp(u.card, vec2<f32>(0.02), vec2<f32>(1.0)) * frame;
  let q = p - 0.5 * res;
  let gs = max(min(halfExt.x / EREFX, halfExt.y / EREFY), 0.0001);
  let r = clamp(u.radius * gs, 0.0, min(halfExt.x, halfExt.y));

  var col = ECANVAS;

  let ldirC = eLightDir();
  col = mfsCardShadow(col, q, halfExt, r, gs, ldirC, u.shadowAmt,
                      eIntensity(), u.shadowColor.rgb);

  let cres = 2.0 * halfExt;
  let cuv = (q + halfExt) / max(cres, vec2<f32>(1.0));
  let cardCol = mfFilter(cuv, cres, u.filterId, frame.x / 393.0,
                         u.fAmount, u.fScale, u.fBlur, u.fFade, u.fSoft, u.fAngle, u.fGrain, u.fBrightness, u.fContrast, u.fSaturation, u.fRound, u.fBevel, u.fInset);

  let dCard = eSdRoundBox(q, halfExt, r);
  col = eOver(col, cardCol, 1.0 - smoothstep(-1.0, 1.0, dCard));

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
  return ember(in.uv);
}
`;

const UNIFORMS = new Float32Array([
    0.0, 0.0,
    0.0,
    0.0,
    42.0,
    60.0,
    45.0,
    26.0,
    1.0,
    0.1,
    1.0,
    1.0,
    1.0,
    2.0,
    0.35,
    0.25,
    0.86, 0.52,
    0.5, 1.0,
    0.039215688, 0.039215688, 0.05490196, 1.0,
    1.0, 0.21176471, 0.21176471, 1.0,
    1.0, 0.89411765, 0.21176471, 1.0,
    1.0, 1.0, 1.0, 1.0,
    1.0, 0.21176471, 0.21176471, 1.0,
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

const CARD = { width: 0.86, height: 0.52 };

function statCardRect(w: number, h: number) {
    const s = Math.max(Math.min(w / 393, h / 851), 0.0001);
    const cw = Math.min(Math.max(CARD.width, 0.02), 1) * 393 * s;
    const ch = Math.min(Math.max(CARD.height, 0.02), 1) * 851 * s;
    const gs = Math.max(Math.min(cw / 320, ch / 420), 0.0001);
    return { left: (w - cw) / 2, top: (h - ch) / 2, width: cw, height: ch, gs };
}
export type EmberCardProps = {
    badge?: string;
    value?: string;
    caption?: string;
    showsContent?: boolean;
};

export default function EmberCard({
    badge = "+312 bps",
    value = "400%",
    caption = "Conversion rate",
    showsContent = true,
}: EmberCardProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [box, setBox] = useState({ w: 0, h: 0 });

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
            setBox({ w: rect.width, h: rect.height });
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

    const card = statCardRect(box.w, box.h);
    const px = (n: number) => n * card.gs;

    return (
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
            <canvas
                ref={canvasRef}
                style={{ display: "block", width: "100%", height: "100%" }}
            />
            {showsContent && box.w > 0 && (
                <div
                    aria-hidden
                    style={{
                        position: "absolute",
                        inset: 0,
                        pointerEvents: "none",
                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                    }}
                >
                    <div
                        style={{
                            position: "absolute",
                            left: card.left,
                            top: card.top,
                            width: card.width,
                            height: card.height,
                            boxSizing: "border-box",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            overflow: "hidden",
                            paddingLeft: px(36.0),
                            paddingRight: px(36.0),
                            justifyContent: "flex-start", paddingTop: px(30.0),
                        }}
                    >
                        <div
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                boxSizing: "border-box",
                                borderStyle: "solid",
                                borderColor: "rgba(255, 255, 255, 0.28)",
                                borderWidth: Math.max(1.0 * card.gs, 1),
                                borderRadius: 9999,
                                color: "#fff",
                                fontWeight: 500,
                                letterSpacing: "-0.01em",
                                whiteSpace: "nowrap",
                                flexShrink: 0,
                                height: px(30.0),
                                paddingInline: px(14.0),
                                fontSize: px(13.0),
                                gap: px(6.0),
                                marginBottom: px(16.0),
                            }}
                        >
                            <span style={{ opacity: 0.9 }}>↗</span>
                            {badge}
                        </div>
                        <div
                            style={{
                                color: "#fff",
                                fontWeight: 500,
                                lineHeight: 1,
                                letterSpacing: "-0.02em",
                                whiteSpace: "nowrap",
                                fontSize: px(66.0),
                                marginBottom: px(6.0),
                            }}
                        >
                            {value}
                        </div>
                        <div
                            style={{
                                color: "rgba(255, 255, 255, 0.85)",
                                fontWeight: 400,
                                lineHeight: 1.2,
                                letterSpacing: "-0.01em",
                                whiteSpace: "nowrap",
                                fontSize: px(15.0),
                            }}
                        >
                            {caption}
                        </div>
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
