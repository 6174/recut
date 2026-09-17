"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:      vec2<f32>,
  time:      f32,
  style:     f32,
  speed:     f32,
  waveFreq:  f32,
  amplitude: f32,
  tint:      vec4<f32>,
  depth:     vec4<f32>,
  highlight: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn goSph(ro: vec3<f32>, rd: vec3<f32>, rad: f32) -> vec2<f32> {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - rad * rad;
  let h = b * b - c;
  if (h < 0.0) { return vec2<f32>(-1.0); }
  let hs = sqrt(h);
  return vec2<f32>(-b - hs, -b + hs);
}

fn goWaveDisp(p: vec3<f32>, t: f32, fr: f32, amp: f32, style: i32) -> f32 {
  var disp = 0.0;
  if (style == 1) {
    let q = normalize(p) * 3.0;
    var uu = q.x * 0.90 + q.y * 0.45 + q.z * 0.25;
    uu = uu + 0.35 * sin(q.y * 1.5 + t * 0.50);
    uu = uu + 0.18 * sin(q.z * 2.1 - t * 0.55);
    var vv = q.z * 0.70 + q.x * 0.55 + q.y * 0.45;
    vv = vv + 0.30 * sin(q.x * 1.6 - t * 0.55);
    vv = vv + 0.16 * sin(q.y * 2.0 + t * 0.60);
    disp = 0.040 * sin(uu * 5.5 * fr) + 0.032 * sin(vv * 5.0 * fr);
  } else if (style == 2) {
    let q = normalize(p) * 4.0;
    var uu = q.x * 0.85 + q.y * 0.50 + q.z * 0.20;
    uu = uu + 0.25 * sin(q.y * 1.1 + t * 0.28);
    uu = uu + 0.15 * sin(q.z * 1.9 - t * 0.30);
    var vv = q.z * 0.70 + q.x * 0.55 + q.y * 0.45;
    vv = vv + 0.22 * sin(q.x * 1.3 - t * 0.30);
    vv = vv + 0.13 * sin(q.y * 2.0 + t * 0.32);
    disp = 0.026 * sin(uu * 9.0 * fr) + 0.022 * sin(vv * 8.5 * fr);
  } else if (style == 3) {
    let q = normalize(p) * 3.5;
    var uu = q.x * 0.85 + q.y * 0.50 + q.z * 0.20;
    uu = uu + 0.30 * sin(q.y * 1.2 + t * 0.20);
    uu = uu + 0.18 * sin(q.z * 2.1 - t * 0.25);
    uu = uu + 0.10 * sin(q.y * 3.5 + q.z * 2.8 + t * 0.18);
    var vv = q.z * 0.70 + q.x * 0.55 + q.y * 0.45;
    vv = vv + 0.28 * sin(q.x * 1.3 - t * 0.22);
    vv = vv + 0.16 * sin(q.y * 2.4 + t * 0.30);
    vv = vv + 0.09 * sin(q.x * 3.2 + q.z * 2.5 - t * 0.20);
    disp = 0.038 * sin(uu * 7.5 * fr) + 0.030 * sin(vv * 7.0 * fr);
  } else if (style == 4) {
    let q = normalize(p) * 3.0;
    var uu = q.x * 0.85 + q.y * 0.50 + q.z * 0.20;
    uu = uu + 0.28 * sin(q.y * 1.0 + t * 0.18);
    uu = uu + 0.14 * sin(q.z * 1.6 - t * 0.22);
    var vv = q.z * 0.70 + q.x * 0.55 + q.y * 0.45;
    vv = vv + 0.25 * sin(q.x * 1.1 - t * 0.20);
    vv = vv + 0.12 * sin(q.y * 1.7 + t * 0.24);
    disp = 0.022 * sin(uu * 6.5 * fr) + 0.018 * sin(vv * 6.0 * fr);
  } else if (style == 5) {
    let q = normalize(p) * 3.5;
    var uu = q.x * 0.85 + q.y * 0.50 + q.z * 0.20;
    uu = uu + 0.32 * sin(q.y * 1.6 + t * 0.50);
    uu = uu + 0.20 * sin(q.z * 2.3 - t * 0.60);
    var vv = q.z * 0.70 + q.x * 0.55 + q.y * 0.45;
    vv = vv + 0.28 * sin(q.x * 1.7 + t * 0.55);
    vv = vv + 0.18 * sin(q.y * 2.4 - t * 0.70);
    disp = 0.042 * sin(uu * 6.5 * fr)
         + 0.034 * sin(vv * 6.0 * fr)
         + 0.018 * sin((uu + vv) * 8.5 * fr + t * 0.4);
  } else if (style == 6) {
    let q = normalize(p) * 3.3;
    var uu = q.x * 0.85 + q.y * 0.50 + q.z * 0.20;
    uu = uu + 0.32 * sin(q.y * 1.2 + t * 0.30);
    uu = uu + 0.18 * sin(q.z * 1.8 - t * 0.28);
    var vv = -q.x * 0.55 + q.z * 0.65 + q.y * 0.40;
    vv = vv + 0.28 * sin(q.x * 1.3 + t * 0.35);
    vv = vv + 0.16 * sin(q.y * 2.0 - t * 0.25);
    disp = 0.040 * sin(uu * 6.5 * fr) + 0.034 * sin(vv * 6.0 * fr);
  } else if (style == 7) {
    let q = normalize(p) * 4.0;
    var uu = q.x * 0.85 + q.y * 0.50 + q.z * 0.20;
    uu = uu + 0.22 * sin(q.y * 1.4 + t * 0.22);
    uu = uu + 0.13 * sin(q.z * 2.3 - t * 0.18);
    var vv = q.z * 0.70 + q.x * 0.55 + q.y * 0.45;
    vv = vv + 0.20 * sin(q.x * 1.5 - t * 0.22);
    vv = vv + 0.12 * sin(q.y * 2.5 + t * 0.20);
    disp = 0.030 * sin(uu * 10.0 * fr) + 0.025 * sin(vv * 9.5 * fr);
  } else if (style == 8) {
    let q = normalize(p) * 4.0;
    var uu = q.x * 0.85 + q.y * 0.50 + q.z * 0.20;
    uu = uu + 0.25 * sin(q.y * 1.4 + t * 0.55);
    uu = uu + 0.14 * sin(q.z * 2.0 - t * 0.45);
    var vv = q.z * 0.70 + q.x * 0.55 + q.y * 0.45;
    vv = vv + 0.22 * sin(q.x * 1.5 - t * 0.50);
    vv = vv + 0.13 * sin(q.y * 2.2 + t * 0.45);
    disp = 0.030 * sin(uu * 9.5 * fr + t * 0.45) + 0.025 * sin(vv * 9.0 * fr - t * 0.40);
  } else {
    let q = normalize(p) * 3.5;
    var uu = q.x * 0.85 + q.y * 0.50 + q.z * 0.20;
    uu = uu + 0.32 * sin(q.y * 1.0 + t * 0.30);
    uu = uu + 0.22 * sin(q.z * 1.3 - t * 0.35);
    uu = uu + 0.14 * sin(q.y * 1.9 + q.z * 1.6 + t * 0.25);
    var vv = q.z * 0.70 + q.x * 0.55 + q.y * 0.45;
    vv = vv + 0.30 * sin(q.x * 1.2 - t * 0.32);
    vv = vv + 0.20 * sin(q.y * 1.5 + t * 0.45);
    vv = vv + 0.14 * sin(q.z * 1.9 + q.x * 1.6 + t * 0.28);
    disp = 0.042 * sin(uu * 7.0 * fr) + 0.034 * sin(vv * 6.5 * fr);
  }
  return disp * amp;
}

fn goMap(p: vec3<f32>, t: f32, fr: f32, amp: f32, style: i32) -> f32 {
  return length(p) - 1.0 - goWaveDisp(p, t, fr, amp, style);
}

fn goNormal(p: vec3<f32>, t: f32, e: f32, fr: f32, amp: f32, style: i32) -> vec3<f32> {
  let k = vec2<f32>(1.0, -1.0);
  return normalize(
    k.xyy * goMap(p + k.xyy * e, t, fr, amp, style) +
    k.yyx * goMap(p + k.yyx * e, t, fr, amp, style) +
    k.yxy * goMap(p + k.yxy * e, t, fr, amp, style) +
    k.xxx * goMap(p + k.xxx * e, t, fr, amp, style)
  );
}

fn goAmpSum(style: i32) -> f32 {
  if (style == 1) { return 0.072; }
  if (style == 2) { return 0.048; }
  if (style == 3) { return 0.068; }
  if (style == 4) { return 0.040; }
  if (style == 5) { return 0.094; }
  if (style == 6) { return 0.074; }
  if (style == 7) { return 0.055; }
  if (style == 8) { return 0.055; }
  return 0.076;
}

fn goLip(style: i32) -> f32 {
  if (style == 1) { return 2.5; }
  if (style == 2) { return 3.0; }
  if (style == 3) { return 2.8; }
  if (style == 4) { return 2.2; }
  if (style == 5) { return 3.0; }
  if (style == 6) { return 2.5; }
  if (style == 7) { return 3.5; }
  if (style == 8) { return 3.5; }
  return 2.0;
}

fn goLight1(style: i32) -> vec3<f32> {
  if (style == 1) { return normalize(vec3<f32>(0.55, 0.80, 0.55)); }
  if (style == 2) { return normalize(vec3<f32>(-0.45, 0.85, 0.55)); }
  if (style == 6) { return normalize(vec3<f32>(-0.50, 0.85, 0.55)); }
  if (style == 7) { return normalize(vec3<f32>(-0.50, 0.85, 0.55)); }
  if (style == 8) { return normalize(vec3<f32>(-0.50, 0.85, 0.55)); }
  return normalize(vec3<f32>(-0.55, 0.85, 0.55));
}

fn goLight2(style: i32) -> vec3<f32> {
  if (style == 1) { return normalize(vec3<f32>(-0.40, 0.30, 0.80)); }
  if (style == 2) { return normalize(vec3<f32>(0.50, 0.30, 0.75)); }
  if (style == 6) { return normalize(vec3<f32>(0.50, 0.30, 0.75)); }
  if (style == 7) { return normalize(vec3<f32>(0.45, 0.30, 0.80)); }
  if (style == 8) { return normalize(vec3<f32>(0.45, 0.30, 0.80)); }
  return normalize(vec3<f32>(0.40, 0.30, 0.80));
}

fn glassOrbAnim(uv01: vec2<f32>) -> vec4<f32> {
  let size = u.size;
  let pos = uv01 * size;
  var uv = (pos - 0.5 * size) / min(size.x, size.y);
  uv = uv * 2.0;

  let style = i32(u.style);
  let fr = u.waveFreq;
  let amp = u.amplitude;
  let t = u.time * u.speed;

  let ro = vec3<f32>(0.0, 0.0, 3.0);
  let rd = normalize(vec3<f32>(uv, -1.8));

  let ampSum = goAmpSum(style);
  let boundRad = 1.0 + ampSum * amp + 0.04;
  let lip = goLip(style) * max(1.0, fr) * max(1.0, amp);

  let hh = goSph(ro, rd, boundRad);
  if (hh.x < 0.0) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }

  var tHit = max(hh.x - 0.02, 0.0);
  let tMax = hh.y + 0.02;
  var hit = false;
  var pHit = vec3<f32>(0.0);
  for (var i = 0; i < 96; i = i + 1) {
    let p = ro + rd * tHit;
    let d = goMap(p, t, fr, amp, style) / lip;
    if (d < 0.0004) { hit = true; pHit = p; break; }
    tHit = tHit + d * 0.85;
    if (tHit > tMax) { break; }
  }
  if (!hit) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }

  let chord = hh.y - hh.x;
  let graze = clamp(1.0 - chord / (2.5 * boundRad), 0.0, 1.0);
  let nEps = mix(0.0015, 0.0070, graze);
  let n = goNormal(pHit, t, nEps, fr, amp, style);
  let v = -rd;
  let ndv = clamp(dot(n, v), 0.0, 1.0);

  let L1 = goLight1(style);
  let L2 = goLight2(style);
  let baseTint = u.tint.rgb * 2.0;
  let absorption = 4.5 * (1.0 - u.depth.rgb);

  let rIn = refract(rd, n, 1.0 / 1.45);
  var tBack = 0.01;
  var pBack = pHit + rIn * tBack;
  for (var i = 0; i < 32; i = i + 1) {
    pBack = pHit + rIn * tBack;
    let d = goMap(pBack, t, fr, amp, style);
    if (d > -0.0008) { break; }
    tBack = tBack + (-d) / lip * 0.85;
    if (tBack > 3.5) { break; }
  }
  let transmit = exp(-absorption * tBack);

  let nBack = goNormal(pBack, t, nEps, fr, amp, style);
  let bDiff = (dot(nBack, L1) * 0.5 + 0.5) * 0.65
            + (dot(nBack, L2) * 0.5 + 0.5) * 0.40;
  var interior = baseTint * (0.20 + bDiff) * transmit;

  let fres = pow(1.0 - ndv, 3.5);
  interior = interior + baseTint * fres * 0.55;

  let exp1 = mix(380.0, 90.0, graze);
  let exp2 = mix(240.0, 60.0, graze);
  let H1 = normalize(L1 + v);
  let H2 = normalize(L2 + v);
  let spec1 = pow(clamp(dot(n, H1), 0.0, 1.0), exp1);
  let spec2 = pow(clamp(dot(n, H2), 0.0, 1.0), exp2);
  let gloss = pow(clamp(dot(n, H1), 0.0, 1.0), 40.0) * 0.10;

  let hl = u.highlight.rgb;
  var col = interior;
  col = col + hl * spec1 * 6.5;
  col = col + hl * spec2 * 3.0;
  col = col + hl * gloss;

  col = col / (1.0 + col * 0.65);
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
  return glassOrbAnim(in.uv);
}
`;

const UNIFORMS = new Float32Array([
    0.0, 0.0,
    0.0,
    0.0,
    1.0,
    1.0,
    1.0,
    0.0,
    0.1764706, 0.03137255, 0.7019608, 1.0,
    0.50980395, 0.24313726, 0.92156863, 1.0,
    1.0, 1.0, 1.0, 1.0,
]);

const SIZE_WORD = 0;
const TIME_WORD = 2;
const ANIMATED = true;
const CLEAR_ALPHA = 1;
export default function GlassOrbView() {
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
