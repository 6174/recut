"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

const WGSL = `struct Uniforms {
  viewport   : vec2<f32>,
  center     : vec2<f32>,
  radius     : f32,
  phase      : f32,
  squash     : f32,
  twistK     : f32,
  rings      : u32,
  shells     : u32,
  segments   : u32,
  style      : u32,
  dashScale  : f32,
  brightness : f32,
  glowAmt    : f32,
  vignetteAmt: f32,
  dpr        : f32,
  _pad0      : f32,
  _pad1      : f32,
  _pad2      : f32,
  dustColor  : vec4<f32>,
  glowColor  : vec4<f32>,
  vigColor   : vec4<f32>,
  bgColor    : vec4<f32>,
};

@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> P: array<vec4<f32>>;
@group(1) @binding(0) var tiers: texture_2d<f32>;

const TAU = 6.283185307179586;
const PI  = 3.141592653589793;
const TABLE_LEN = 3600u;

const TIER_A = array<f32, 3>(0.16, 0.42, 0.92);
const TIER_W = array<f32, 3>(0.65, 0.95, 1.4);

const kQuad = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
  vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
);

struct DashOut {
  @builtin(position) position : vec4<f32>,
  @location(0)                   local  : vec2<f32>,
  @location(1) @interpolate(flat) segLen : f32,
  @location(2) @interpolate(flat) halfW  : f32,
  @location(3) @interpolate(flat) chan   : vec3<f32>,
};

fn dropped() -> DashOut {
  var o: DashOut;
  o.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
  o.local = vec2<f32>(0.0, 0.0);
  o.segLen = 0.0;
  o.halfW = 0.0;
  o.chan = vec3<f32>(0.0, 0.0, 0.0);
  return o;
}

@vertex
fn dash_vertex(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> DashOut {
  let seg = max(U.segments, 1u);
  let rings = max(U.rings, 2u);
  let ph = U.phase;
  let cssW = U.viewport.x / U.dpr;
  let cssH = U.viewport.y / U.dpr;

  var pos: vec2<f32>;
  var dvec: vec2<f32>;
  var al: f32;

  if (U.style == 0u) {
    let j = iid / seg;
    let k = iid % seg;
    if (j >= rings) { return dropped(); }

    let f = f32(j) / f32(rings - 1u);
    let r = U.radius * (0.95 + 0.35 * sin(f * 5.0 - ph));
    if (r <= 0.5) { return dropped(); }
    let ry = cssH * 0.06 + f * cssH * 0.88;
    let tw = f * U.twistK + ph;

    let band = 0.5 + 0.5 * sin(f * 9.0 - ph * 2.0);
    let amp = 0.35 + 0.85 * band;

    let p = P[(j * seg + k * 7u + j) % TABLE_LEN];
    let a = (f32(k) / f32(seg)) * TAU + tw;
    let rr = r * (1.0 + (p.x - 0.5) * 0.05);
    let sa = sin(a);
    let ca = cos(a);

    pos = vec2<f32>(U.center.x + ca * rr, ry + sa * rr * U.squash + (p.y - 0.5) * 3.2);
    if (pos.x < -30.0 || pos.x > cssW + 30.0 || pos.y < -30.0 || pos.y > cssH + 30.0) {
      return dropped();
    }
    let front = 0.4 + 0.6 * (0.5 + 0.5 * sa);
    al = (0.06 + 0.9 * p.z) * front * amp;
    let len = (1.1 + 2.6 * p.y) * U.dashScale;
    dvec = vec2<f32>(-sa * len, ca * len * (U.squash + 0.35));
  } else {
    let k = iid % seg;
    let rest = iid / seg;
    let j = rest % rings;
    let sh = rest / rings;
    if (sh >= max(U.shells, 1u)) { return dropped(); }

    let shf = f32(sh);
    let pulse = 1.0 + 0.12 * sin(ph * 2.0 - shf * 1.1);
    let RS = U.radius * (0.42 + 0.33 * shf) * pulse;
    let th = ((f32(j) + 0.5) / f32(rings)) * PI;
    let rr = sin(th) * RS;
    let yy = -cos(th) * RS;

    let p = P[(sh * 1500u + j * 100u + k * 3u) % TABLE_LEN];
    let a = (f32(k) / f32(seg)) * TAU + ph * (1.0 + shf);
    let sa = sin(a);
    let ca = cos(a);

    pos = vec2<f32>(U.center.x + ca * rr, U.center.y + yy * 0.92 + sa * rr * U.squash);
    let front = 0.4 + 0.6 * (0.5 + 0.5 * sa);
    al = (0.05 + 0.8 * p.z) * front * (1.0 - shf * 0.13);
    dvec = vec2<f32>(-sa * 2.2, ca * 0.8) * U.dashScale;
  }

  al = al * U.brightness;
  if (al < 0.05) { return dropped(); }
  var tier = 0;
  if (al > 0.62) { tier = 2; } else if (al > 0.28) { tier = 1; }

  let A = pos * U.dpr;
  let D = dvec * U.dpr;
  let halfW = TIER_W[tier] * 0.5 * U.dpr;

  let ln = length(D);
  var tan = vec2<f32>(1.0, 0.0);
  if (ln > 1e-5) { tan = D / ln; }
  let nrm = vec2<f32>(-tan.y, tan.x);

  let pad = halfW + 1.0;
  let q = kQuad[vid];
  let s = (q.x * 0.5 + 0.5) * (ln + 2.0 * pad) - pad;
  let v = q.y * pad;
  let px = A + tan * s + nrm * v;

  var o: DashOut;
  o.position = vec4<f32>(
    px.x / U.viewport.x * 2.0 - 1.0,
    1.0 - px.y / U.viewport.y * 2.0,
    0.0,
    1.0,
  );
  o.local = vec2<f32>(s, v);
  o.segLen = ln;
  o.halfW = halfW;
  o.chan = vec3<f32>(f32(tier == 0), f32(tier == 1), f32(tier == 2));
  return o;
}

fn coverage(dist: f32, halfW: f32) -> f32 {
  return clamp(dist + halfW, -0.5, 0.5) - clamp(dist - halfW, -0.5, 0.5);
}

@fragment
fn dash_fragment(in: DashOut) -> @location(0) vec4<f32> {
  let across = coverage(abs(in.local.y), in.halfW);
  let capH = in.halfW * 0.7853981634;
  let e = min(in.local.x + capH, in.segLen + capH - in.local.x);
  let along = clamp(e + 0.5, 0.0, 1.0);
  let cov = across * along;
  return vec4<f32>(in.chan * cov, 0.0);
}

struct FullOut {
  @builtin(position) position : vec4<f32>,
};

@vertex
fn full_vertex(@builtin(vertex_index) vid: u32) -> FullOut {
  var o: FullOut;
  let x = f32(i32(vid) / 2) * 4.0 - 1.0;
  let y = f32(i32(vid) & 1) * 4.0 - 1.0;
  o.position = vec4<f32>(x, y, 0.0, 1.0);
  return o;
}

@fragment
fn composite_fragment(in: FullOut) -> @location(0) vec4<f32> {
  let c = textureLoad(tiers, vec2<i32>(in.position.xy), 0);
  let a = TIER_A[0] * c.r + TIER_A[1] * c.g + TIER_A[2] * c.b;
  return vec4<f32>(U.dustColor.rgb * a, a);
}

@fragment
fn glow_fragment(in: FullOut) -> @location(0) vec4<f32> {
  let p = in.position.xy / U.dpr;
  let r = max(U.radius * 0.4, 1e-4);
  let q = distance(p, U.center) / r;
  var a = 0.0;
  if (q < 0.3) {
    a = mix(U.glowAmt, U.glowAmt * 0.3, q / 0.3);
  } else if (q < 1.0) {
    a = mix(U.glowAmt * 0.3, 0.0, (q - 0.3) / 0.7);
  }
  return vec4<f32>(U.glowColor.rgb * a, a);
}

@fragment
fn vig_fragment(in: FullOut) -> @location(0) vec4<f32> {
  let css = U.viewport / U.dpr;
  let p = in.position.xy / U.dpr;
  let d = length(css);
  let a = U.vignetteAmt * clamp((distance(p, U.center) - d * 0.3) / (d * 0.36), 0.0, 1.0);
  return vec4<f32>(U.vigColor.rgb * a, a);
}`;

const STYLE = 0;
const RINGS = 46;
const SHELLS = 1;
const SEGMENTS = 130;
const TWIST = 7.0;
const SQUASH = 0.25;
const SPEED = 1.0;
const SIZE = 1.0;
const DASH = 1.0;
const BRIGHTNESS = 1.0;
const GLOW = 0.0;
const VIGNETTE = 0.5;
const DUST_COLOR = [0.9255, 0.9412, 0.9647, 1];
const GLOW_COLOR = [1.0, 1.0, 1.0, 1];
const VIG_COLOR = [0.0, 0.0, 0.0, 1];
const BG_COLOR = [0.0, 0.0, 0.0, 1];
const INSTANCES = 5980;
const LOOP = 12.0;
const MAX_DPR = 2.0;

function buildTable(n : number) {
  let a = 5150607 | 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const u = next(), v = next();
    next(); next(); next();
    out[i * 4] = u; out[i * 4 + 1] = v; out[i * 4 + 2] = next();
  }
  return out;
}

const G = (globalThis as any);
const SHADER_STAGE = G.GPUShaderStage;
const BUFFER_USAGE = G.GPUBufferUsage;
const TEXTURE_USAGE = G.GPUTextureUsage;

function start(canvas : HTMLCanvasElement, onError : (m: string) => void) {
  let raf = 0, stopped = false;
  let cleanup = () => {};
  const gpu = (navigator as any).gpu;
  if (!gpu) {
    onError("This browser doesn't support WebGPU. Try Chrome or Edge 113+, Safari 26+, or Firefox 141+ on Windows.");
    return () => {};
  }

  (async () => {
    const adapter = await gpu.requestAdapter();
    if (!adapter) { onError("No WebGPU adapter is available."); return; }
    const device = await adapter.requestDevice();
    if (stopped) { device.destroy && device.destroy(); return; }
    device.lost && device.lost.then(() => { stopped = true; if (raf) cancelAnimationFrame(raf); });

    const ctx = canvas.getContext("webgpu") as any;
    if (!ctx) { onError("This canvas can't provide a WebGPU context."); return; }
    const format = gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: "premultiplied" });

    const module = device.createShaderModule({ code: WGSL });
    const sceneLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: SHADER_STAGE.VERTEX | SHADER_STAGE.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: SHADER_STAGE.VERTEX, buffer: { type: "read-only-storage" } },
      ],
    });
    const tierLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: SHADER_STAGE.FRAGMENT, texture: { sampleType: "unfilterable-float" } }],
    });
    const MAX = { color: { srcFactor: "one", dstFactor: "one", operation: "max" }, alpha: { srcFactor: "one", dstFactor: "one", operation: "max" } };
    const ADD = { color: { srcFactor: "one", dstFactor: "one", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one", operation: "add" } };
    const OVER = { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } };

    const dashPipeline = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [sceneLayout] }),
      vertex: { module, entryPoint: "dash_vertex" },
      fragment: { module, entryPoint: "dash_fragment", targets: [{ format: "rgba8unorm", blend: MAX }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
    });
    const fullLayout = device.createPipelineLayout({ bindGroupLayouts: [sceneLayout, tierLayout] });
    const full = (entryPoint : string, blend : any) => device.createRenderPipelineAsync({
      layout: fullLayout,
      vertex: { module, entryPoint: "full_vertex" },
      fragment: { module, entryPoint, targets: [{ format, blend }] },
      primitive: { topology: "triangle-list" },
    });
    const compositePipeline = await full("composite_fragment", ADD);
    const glowPipeline = await full("glow_fragment", ADD);
    const vigPipeline = await full("vig_fragment", OVER);
    if (stopped) { device.destroy && device.destroy(); return; }

    const words = new Float32Array(36);
    const uwords = new Uint32Array(words.buffer);
    const ubo = device.createBuffer({ size: 144, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST });
    const table = buildTable(3600);
    const tbl = device.createBuffer({ size: table.byteLength, usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST });
    device.queue.writeBuffer(tbl, 0, table);
    const sceneGroup = device.createBindGroup({
      layout: sceneLayout,
      entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: { buffer: tbl } }],
    });

    let tierTex : any = null, tierGroup : any = null, tw = 0, th = 0;
    const ensureTier = (w : number, h : number) => {
      if (tierTex && tw === w && th === h) return;
      if (tierTex) tierTex.destroy();
      tierTex = device.createTexture({
        size: [w, h], format: "rgba8unorm",
        usage: TEXTURE_USAGE.RENDER_ATTACHMENT | TEXTURE_USAGE.TEXTURE_BINDING,
      });
      tierGroup = device.createBindGroup({ layout: tierLayout, entries: [{ binding: 0, resource: tierTex.createView() }] });
      tw = w; th = h;
    };

    const t0 = performance.now();
    const frame = () => {
      if (stopped) return;
      raf = requestAnimationFrame(frame);
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const rect = canvas.getBoundingClientRect();
      const dw = Math.max(1, Math.round(rect.width * dpr));
      const dh = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== dw || canvas.height !== dh) { canvas.width = dw; canvas.height = dh; }
      ensureTier(dw, dh);

      const w = dw / dpr, h = dh / dpr;
      let t = ((performance.now() - t0) / 1000 * SPEED) % LOOP;
      if (t < 0) t += LOOP;
      words[0] = dw; words[1] = dh;
      words[2] = w * 0.5; words[3] = h * 0.47;
      words[4] = Math.min(w * 0.62, h * 0.3) * SIZE;
      words[5] = Math.PI * 2 * t / LOOP;
      words[6] = SQUASH; words[7] = TWIST;
      uwords[8] = RINGS; uwords[9] = SHELLS; uwords[10] = SEGMENTS; uwords[11] = STYLE;
      words[12] = DASH; words[13] = BRIGHTNESS; words[14] = GLOW; words[15] = VIGNETTE;
      words[16] = dpr;
      words.set(DUST_COLOR, 20); words.set(GLOW_COLOR, 24);
      words.set(VIG_COLOR, 28); words.set(BG_COLOR, 32);
      device.queue.writeBuffer(ubo, 0, words);

      const enc = device.createCommandEncoder();
      const p1 = enc.beginRenderPass({
        colorAttachments: [{ view: tierTex.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      });
      p1.setPipeline(dashPipeline);
      p1.setBindGroup(0, sceneGroup);
      p1.draw(6, INSTANCES);
      p1.end();

      const p2 = enc.beginRenderPass({
        colorAttachments: [{
          view: ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store",
          clearValue: { r: BG_COLOR[0], g: BG_COLOR[1], b: BG_COLOR[2], a: 1 },
        }],
      });
      p2.setBindGroup(0, sceneGroup);
      p2.setBindGroup(1, tierGroup);
      p2.setPipeline(compositePipeline); p2.draw(3, 1);
      if (GLOW > 0) { p2.setPipeline(glowPipeline); p2.draw(3, 1); }
      if (VIGNETTE > 0) { p2.setPipeline(vigPipeline); p2.draw(3, 1); }
      p2.end();
      device.queue.submit([enc.finish()]);
    };

    cleanup = () => {
      if (tierTex) tierTex.destroy();
      ubo.destroy(); tbl.destroy();
      device.destroy && device.destroy();
    };
    frame();
  })();

  return () => { stopped = true; if (raf) cancelAnimationFrame(raf); cleanup(); };
}

export type DustViewProps = {
    className?: string;
    style?: CSSProperties;
};

export default function DustView({ className, style }: DustViewProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        return start(canvas, setError);
    }, []);

    if (error) {
        return (
            <div
                className={className}
                style={{
                    display: "grid",
                    placeItems: "center",
                    width: "100%",
                    height: "100%",
                    padding: 24,
                    background: "#000",
                    color: "#8f959c",
                    font: "15px -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
                    textAlign: "center",
                    ...style,
                }}
            >
                {error}
            </div>
        );
    }

    return (
        <canvas
            ref={canvasRef}
            className={className}
            style={{ display: "block", width: "100%", height: "100%", background: "#000", ...style }}
        />
    );
}
