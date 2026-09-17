"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:        vec2<f32>,
  time:        f32,
  anim:        f32,
  animAmount:  f32,
  animShape:   f32,
  speed:       f32,
  radius:      f32,
  rimSize:     f32,
  midSize:     f32,
  deepSize:    f32,
  topSize:     f32,
  grainAmt:    f32,
  intensity:   f32,
  shadowAmt:   f32,
  card:        vec2<f32>,
  light:       vec2<f32>,
  bgTop:       vec4<f32>,
  bgBottom:    vec4<f32>,
  rimColor:    vec4<f32>,
  midColor:    vec4<f32>,
  deepColor:   vec4<f32>,
  topColor:    vec4<f32>,
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

fn mfaRot(d: vec2<f32>, a: f32) -> vec2<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec2<f32>(d.x * c - d.y * s, d.x * s + d.y * c);
}

fn mfaTri(x: f32) -> f32 {
  return abs(fract(x) * 2.0 - 1.0) * 2.0 - 1.0;
}

fn mfaAnim(mode: f32, ph: f32, amt: f32, shp: f32, rest: vec2<f32>) -> vec3<f32> {
  var d = (rest - vec2<f32>(0.5)) * 2.0;
  var z = 1.0;

  if (mode < 0.5) {
    d = mfaRot(d, ph * 0.6 * amt);
    d.y = d.y * mix(1.0, 0.45, shp);
  } else if (mode < 1.5) {
    let w = sin(ph * 1.1);
    d = d * (1.0 + amt * 0.35 * w);
    z = 1.0 + amt * 0.8 * w;
  } else if (mode < 2.5) {
    let ax = mix(1.0, 1.8, shp);
    d = d + amt * 0.5 * vec2<f32>(sin(ph * 0.7) * ax, sin(ph * 0.53 + 1.7));
  } else if (mode < 3.5) {
    let u = fract(ph * 0.45);
    let env = exp(-u * 6.0) + 0.6 * exp(-max(u - 0.18, 0.0) * 7.0);
    z = 1.0 + amt * 1.1 * (env - 0.42);
  } else {
    let s = mfaTri(ph * 0.25);
    let k = s * amt * 1.2;
    d = vec2<f32>(d.x - d.y * k, d.y + d.x * k);
    d = d * mix(1.0, 1.0 - 0.4 * abs(s), shp);
  }

  return vec3<f32>(d.x, d.y, z);
}

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

const GB1B: f32 = 1.0;       const GB1S: f32 = -0.3333333;
const GB2B: f32 = 0.8235294; const GB2S: f32 = -0.2352941;
const GB3B: f32 = 0.7567568; const GB3S: f32 = -0.3783784;
const GB4B: f32 = 1.0;       const GB4S: f32 = -0.3333333;

const GA1: f32 = 0.42;
const GA2: f32 = 0.55;
const GA3: f32 = 1.0;
const GA4: f32 = 0.22;

const GBF: f32 = 0.85;
const GGAIN: f32 = 0.26;
const GSEED: f32 = 17.0;

fn gCardFrame(res: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(393.0, 851.0) * max(min(res.x / 393.0, res.y / 851.0), 0.0001);
}

fn gSdRoundBox(p: vec2<f32>, ext: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - ext + vec2<f32>(r);
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn gInsetBand(q: vec2<f32>, ext: vec2<f32>, r: f32, ldir: vec2<f32>,
              dist: f32, blurK: f32, spreadK: f32, gs: f32) -> f32 {
  let spread = dist * spreadK * gs;
  let off = -ldir * dist * gs;
  let d = gSdRoundBox(q - off, ext - vec2<f32>(spread), max(r - spread, 0.0));
  let sigma = max(dist * blurK * gs * 0.5, 0.0001);
  return smoothstep(-GK * sigma, GK * sigma, d);
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

  let r = clamp(u.radius * gs, 0.0, min(halfExt.x, halfExt.y));

  let an = mfaAnim(u.anim, u.time * u.speed, u.animAmount, u.animShape, u.light);
  let ldir = an.xy;
  let inten = max(0.0, u.intensity * an.z);

  var cardCol = mix(u.bgTop.rgb, u.bgBottom.rgb,
                 clamp((q.y + halfExt.y) / max(2.0 * halfExt.y, 0.0001), 0.0, 1.0));

  let a4 = gInsetBand(q, halfExt, r, -ldir, u.topSize,  GB4B, GB4S, gs) * GA4 * inten;
  cardCol = gOver(cardCol, u.topColor.rgb, a4);
  let a3 = gInsetBand(q, halfExt, r,  ldir, u.deepSize, GB3B, GB3S, gs) * GA3 * inten;
  cardCol = gOver(cardCol, u.deepColor.rgb, a3);
  let a2 = gInsetBand(q, halfExt, r,  ldir, u.midSize,  GB2B, GB2S, gs) * GA2 * inten;
  cardCol = gOver(cardCol, u.midColor.rgb, a2);
  let a1 = gInsetBand(q, halfExt, r,  ldir, u.rimSize,  GB1B, GB1S, gs) * GA1 * inten;
  cardCol = gOver(cardCol, u.rimColor.rgb, a1);

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

fn glow(uv01: vec2<f32>) -> vec4<f32> {
  let res = u.size;
  let p = uv01 * res;
  let frame = gCardFrame(res);
  let halfExt = 0.5 * clamp(u.card, vec2<f32>(0.02), vec2<f32>(1.0)) * frame;
  let q = p - 0.5 * res;
  let gs = max(min(halfExt.x / GREFX, halfExt.y / GREFY), 0.0001);
  let r = clamp(u.radius * gs, 0.0, min(halfExt.x, halfExt.y));

  var col = GCANVAS;

  let anC = mfaAnim(u.anim, u.time * u.speed, u.animAmount, u.animShape, u.light);
  col = mfsCardShadow(col, q, halfExt, r, gs, anC.xy, u.shadowAmt,
                      max(0.0, u.intensity * anC.z), u.shadowColor.rgb);

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
  return glow(in.uv);
}
`;

const UNIFORMS = new Float32Array([
    0.0, 0.0,
    0.0,
    0.0,
    0.42,
    0.0,
    1.0,
    40.0,
    18.0,
    34.0,
    74.0,
    6.0,
    0.15,
    1.0,
    0.1,
    0.0,
    0.86, 0.52,
    0.5, 1.0,
    0.039215688, 0.03529412, 0.03529412, 1.0,
    0.03529412, 0.0627451, 0.12156863, 1.0,
    1.0, 1.0, 1.0, 1.0,
    0.4117647, 0.5803922, 1.0, 1.0,
    0.078431375, 0.29803923, 0.8039216, 1.0,
    0.13725491, 0.39607844, 1.0, 1.0,
    0.078431375, 0.29803923, 0.8039216, 1.0,
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
export type GlowCardProps = {
    badge?: string;
    value?: string;
    caption?: string;
    showsContent?: boolean;
};

export default function GlowCard({
    badge = "+312 bps",
    value = "400%",
    caption = "Conversion rate",
    showsContent = true,
}: GlowCardProps) {
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
