"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:        vec2<f32>,
  time:        f32,
  radius:      f32,
  bandAngle:   f32,
  bandBlur:    f32,
  bandAmt:     f32,
  blushBlur:   f32,
  footHeight:  f32,
  grainAmt:    f32,
  intensity:   f32,
  shadowAmt:   f32,
  card:        vec2<f32>,
  light:       vec2<f32>,
  bg1:         vec4<f32>,
  bg2:         vec4<f32>,
  bg3:         vec4<f32>,
  bg4:         vec4<f32>,
  bg5:         vec4<f32>,
  bandColor:   vec4<f32>,
  blushColor:  vec4<f32>,
  footColor:   vec4<f32>,
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

const GREFX: f32 = 160.0;
const GREFY: f32 = 210.0;

const GK: f32 = 2.104;

const GCANVAS: vec3<f32> = vec3<f32>(0.02745098, 0.02745098, 0.04313725);

const GBGDIR: vec2<f32> = vec2<f32>(0.66913061, 0.74314483);
const GBGLEN: f32 = 526.24262;

const GBG1: f32 = 0.28;
const GBG2: f32 = 0.50;
const GBG3: f32 = 0.72;

const GBANDCTR: vec2<f32> = vec2<f32>(0.0, -4.2);
const GBANDEXT: vec2<f32> = vec2<f32>(256.0, 63.0);
const GBANDMID: f32 = 0.45;
const GBANDPAR: f32 = 18.0;

const GBLUSHCTR: vec2<f32> = vec2<f32>(-112.0, -176.4);
const GBLUSHEXT: vec2<f32> = vec2<f32>(112.0, 92.4);
const GBLUSHA0: f32 = 0.60;
const GBLUSHEND: f32 = 0.72;
const GBLUSHPAR: f32 = 42.0;

const GFOOTMID: f32 = 0.76;
const GFOOTA: f32 = 0.92;

const GBF: f32 = 0.82;
const GGAIN: f32 = 0.26;
const GSEED: f32 = 17.0;

const GDEG: f32 = 0.017453292519943295;

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

fn gParallax(ldir: vec2<f32>, k: f32, gs: f32) -> vec2<f32> {
  return (ldir - vec2<f32>(0.0, 1.0)) * k * gs;
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

fn gOver(dst: vec3<f32>, src: vec3<f32>, a: f32) -> vec3<f32> {
  return mix(dst, src, clamp(a, 0.0, 1.0));
}

fn mfSrc(cuv: vec2<f32>) -> vec3<f32> {
  let res = u.size;

  let frame = gCardFrame(res);
  let halfExt = 0.5 * clamp(u.card, vec2<f32>(0.02), vec2<f32>(1.0)) * frame;
  let q = (cuv - vec2<f32>(0.5)) * 2.0 * halfExt;

  let gs = max(min(halfExt.x / GREFX, halfExt.y / GREFY), 0.0001);

  let ldir = (u.light - vec2<f32>(0.5)) * 2.0;
  let inten = max(0.0, u.intensity);

  let bp = (cuv - vec2<f32>(0.5)) * vec2<f32>(2.0 * GREFX, 2.0 * GREFY);
  let t = clamp(0.5 + dot(bp, GBGDIR) / GBGLEN, 0.0, 1.0);
  var cardCol: vec3<f32>;
  if (t < GBG1) {
    cardCol = mix(u.bg1.rgb, u.bg2.rgb, t / GBG1);
  } else if (t < GBG2) {
    cardCol = mix(u.bg2.rgb, u.bg3.rgb, (t - GBG1) / (GBG2 - GBG1));
  } else if (t < GBG3) {
    cardCol = mix(u.bg3.rgb, u.bg4.rgb, (t - GBG2) / (GBG3 - GBG2));
  } else {
    cardCol = mix(u.bg4.rgb, u.bg5.rgb, (t - GBG3) / (1.0 - GBG3));
  }

  let ba = u.bandAngle * GDEG;
  let bc = cos(ba);
  let bs = sin(ba);
  let bw = q - GBANDCTR * gs - gParallax(ldir, GBANDPAR, gs);
  let bl = vec2<f32>(bw.x * bc + bw.y * bs, -bw.x * bs + bw.y * bc);
  let bext = GBANDEXT * gs;

  let bt = clamp(0.5 + bl.x / max(2.0 * bext.x, 0.0001), 0.0, 1.0);
  var bramp = bt / GBANDMID;
  if (bt >= GBANDMID) { bramp = (1.0 - bt) / (1.0 - GBANDMID); }

  let bcov = gCoverage(abs(bl.y) - bext.y, u.bandBlur * gs);
  cardCol = gOver(cardCol, u.bandColor.rgb, u.bandAmt * bramp * bcov);

  let hp = q - GBLUSHCTR * gs - gParallax(ldir, GBLUSHPAR, gs);
  let hext = GBLUSHEXT * gs;
  let e = length(hp / max(hext, vec2<f32>(0.0001)));
  var ha = GBLUSHA0 * clamp(1.0 - e / GBLUSHEND, 0.0, 1.0);
  let minR = min(hext.x, hext.y);
  ha = ha * gCoverage((e - GBLUSHEND) * minR, u.blushBlur * gs) * inten;
  cardCol = gOver(cardCol, u.blushColor.rgb, ha);

  let s = clamp((cuv.y - (1.0 - u.footHeight)) / max(u.footHeight, 0.0001), 0.0, 1.0);
  cardCol = gOver(cardCol, u.footColor.rgb, GFOOTA * min(s / GFOOTMID, 1.0));

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

fn duotone(uv01: vec2<f32>) -> vec4<f32> {
  let res = u.size;
  let p = uv01 * res;
  let frame = gCardFrame(res);
  let halfExt = 0.5 * clamp(u.card, vec2<f32>(0.02), vec2<f32>(1.0)) * frame;
  let q = p - 0.5 * res;
  let gs = max(min(halfExt.x / GREFX, halfExt.y / GREFY), 0.0001);
  let r = clamp(u.radius * gs, 0.0, min(halfExt.x, halfExt.y));

  var col = GCANVAS;

  let ldirC = (u.light - vec2<f32>(0.5)) * 2.0;
  col = mfsCardShadow(col, q, halfExt, r, gs, ldirC, u.shadowAmt,
                      max(0.0, u.intensity), u.shadowColor.rgb);

  let cres = 2.0 * halfExt;
  let cuv = (q + halfExt) / max(cres, vec2<f32>(1.0));
  var cardCol = mfFilter(cuv, cres, u.filterId, frame.x / 393.0,
                         u.fAmount, u.fScale, u.fBlur, u.fFade, u.fSoft, u.fAngle, u.fGrain, u.fBrightness, u.fContrast, u.fSaturation, u.fRound, u.fBevel, u.fInset);

  if (u.grainAmt > 0.0) {
    let np = q / gs * GBF;
    let nr = gLinearToSRGB(gFractal(np, 0.0));
    let ng = gLinearToSRGB(gFractal(np, 101.0));
    let nb = gLinearToSRGB(gFractal(np, 211.0));
    let na = gFractal(np, 307.0);
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
  return duotone(in.uv);
}
`;

const UNIFORMS = new Float32Array([
    0.0, 0.0,
    0.0,
    22.0,
    -42.0,
    26.0,
    0.9,
    28.0,
    0.42,
    0.17,
    1.0,
    0.1,
    0.86, 0.52,
    0.5, 1.0,
    1.0, 0.1764706, 0.33333334, 1.0,
    0.7019608, 0.16470589, 0.54509807, 1.0,
    0.35686275, 0.12156863, 0.63529414, 1.0,
    0.105882354, 0.11764706, 0.41960785, 1.0,
    0.019607844, 0.023529412, 0.05882353, 1.0,
    0.0, 0.0, 0.0, 1.0,
    1.0, 0.47058824, 0.5882353, 1.0,
    0.015686275, 0.019607844, 0.05490196, 1.0,
    1.0, 0.1764706, 0.33333334, 1.0,
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
export type DuotoneCardProps = {
    badge?: string;
    value?: string;
    caption?: string;
    showsContent?: boolean;
};

export default function DuotoneCard({
    badge = "+312 bps",
    value = "400%",
    caption = "Conversion rate",
    showsContent = true,
}: DuotoneCardProps) {
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
                            justifyContent: "flex-end", paddingBottom: px(24.0),
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
