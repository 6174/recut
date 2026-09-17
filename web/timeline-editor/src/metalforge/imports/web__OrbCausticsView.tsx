"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:       vec2<f32>,
  time:       f32,
  speed:      f32,
  radius:     f32,
  density:    f32,
  thickness:  f32,
  refraction: f32,
  warp:       f32,
  rim:        f32,
  glow:       f32,
  exposure:   f32,
  spectrum:   f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  haloColor:  vec4<f32>,
  tintColor:  vec4<f32>,
  bodyColor:  vec4<f32>,
  ambientColor:  vec4<f32>,
  rimColor:      vec4<f32>,
  rimTintColor:  vec4<f32>,
  specColor:     vec4<f32>,
  filmColor:     vec4<f32>,
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

fn caSstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn caHash(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

fn caNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = caHash(i);
  let b = caHash(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = caHash(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = caHash(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = caHash(i + vec3<f32>(0.0, 0.0, 1.0));
  let g = caHash(i + vec3<f32>(1.0, 0.0, 1.0));
  let j = caHash(i + vec3<f32>(0.0, 1.0, 1.0));
  let k = caHash(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

fn caFbm(pIn: vec3<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * caNoise(p);
    p = p * 2.03 + vec3<f32>(7.1, 3.7, 1.3);
    a = a * 0.5;
  }
  return v;
}

fn orbCausticsAnim(uv01: vec2<f32>) -> vec4<f32> {
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let t   = u.time * u.speed;
  let rad = max(u.radius, 0.05);
  let r   = length(uv);

  var col = u.haloColor.rgb * exp(-max(r - rad, 0.0) * 11.0) * 0.30 * u.glow;

  if (r < rad + 0.01 + mfEdgeD(u.edgeSoftness)) {
    let m   = caSstep(rad + mfEdgeD(u.edgeSoftness), rad - u.edgeSoftness, r);
    let su  = uv / rad;
    let z   = sqrt(max(1.0 - dot(su, su), 0.0));
    let nrm = vec3<f32>(su, z);

    let o1 = vec3<f32>(sin(t * 0.17) + 0.6 * sin(t * 0.073 + 1.2),
                       cos(t * 0.15) + 0.6 * cos(t * 0.067 + 2.8),
                       sin(t * 0.11 + 4.1)) * 0.6;
    let o2 = vec3<f32>(cos(t * 0.13 + 0.7),
                       sin(t * 0.10 + 2.2),
                       cos(t * 0.08 + 5.0)) * 0.45;

    let sw = max(u.thickness, 0.005);

    let baseF = vec3<f32>(1.0, 1.32, 1.70);
    let freq  = vec3<f32>(1.0) + (baseF - vec3<f32>(1.0)) * u.spectrum;

    let pal = mfRampOf(u.paletteCount,
                       u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                       u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                       u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                       u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb);

    var acc = vec3<f32>(0.0);
    var T: f32 = 1.0;
    let N: i32 = 16;
    let dl = 2.0 * z / f32(N);
    for (var i: i32 = 0; i < N; i = i + 1) {
      let fz   = z - (f32(i) + 0.5) * dl;
      let lens = su * (1.0 - u.refraction * (z - fz));
      let p    = vec3<f32>(lens, fz);
      let rr   = length(p);
      let g    = caFbm(p * 1.9 + o1);
      let f    = caFbm(p * 1.3 + vec3<f32>(g * (u.warp + 0.3 * sin(t * 0.19))) + o2);
      let sheet = pow(caSstep(sw, 0.0, abs(f - 0.48)), 2.0)
                + 0.7 * pow(caSstep(sw * 0.7, 0.0, abs(g - 0.55)), 2.0);
      let dens = sheet * caSstep(1.0, 0.6, rr) * u.density;
      let aa   = 1.0 - exp(-dens * 5.5 * dl);
      let th   = f * 2.4 + g * 1.4 + fz * 0.8 + sin(t * 0.12) * 0.3;
      var c    = select(vec3<f32>(0.5) - 0.5 * cos(6.2831 * th * freq),
                        mfRampCycR(th, pal), u.paletteCount > 0.5) * u.filmColor.rgb
               * (0.5 + 0.5 * caSstep(0.9, 0.3, rr));
      c = c + u.tintColor.rgb;
      acc = acc + T * c * aa * 1.7;
      T   = T * (1.0 - aa * 0.8);
    }

    let bw   = 0.5 + 0.5 * su.x - 0.4 * su.y;
    let dark = u.ambientColor.rgb;
    let base = dark + (u.bodyColor.rgb - dark) * bw;
    acc = acc + T * base;

    let fres = pow(1.0 - z, 2.2);
    acc = acc + mix(u.rimColor.rgb, u.rimTintColor.rgb, 0.5 + 0.5 * su.x) * fres * 1.1 * u.rim;

    let L = normalize(vec3<f32>(-0.5, 0.6, 0.62));
    acc = acc + u.specColor.rgb * pow(max(dot(nrm, L), 0.0), 40.0) * 0.9;
    acc = acc * (0.2 + 0.8 * u.glow);
    col = mix(col, acc, m);
  }

  col = vec3<f32>(1.0) - exp(-col * 1.7 * max(u.exposure, 0.0));
  let edged = mfEdgeGlow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), uv, vec2<f32>(0.0), rad,
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
  let c = orbCausticsAnim(in.uv);

  let fc = vec2<f32>(in.uv.x, 1.0 - in.uv.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);
  let rad = max(u.radius, 0.05);

  let d = length(uv - vec2<f32>(0.0, 0.0));
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
    0.74,
    1.3,
    0.1,
    0.28,
    2.1,
    1.0,
    1.0,
    1.0,
    1.0,
    0.005,
    0.0,
    0.0,
    0.050980393, 0.039215688, 0.2, 1.0,
    0.05882353, 0.03137255, 0.18039216, 1.0,
    0.07058824, 0.023529412, 0.2, 1.0,
    0.007843138, 0.011764706, 0.050980393, 1.0,
    0.12156863, 0.41960785, 1.0, 1.0,
    0.78039217, 0.25882354, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    1.0, 1.0, 1.0, 1.0,
    0.12156863, 0.41960785, 1.0, 1.0,
    0.0, 0.0, 0.0, 1.0,
    0.14509805, 0.24705882, 0.38431373, 1.0,
    0.49803922, 0.7411765, 0.94509804, 1.0,
    0.85490197, 1.0, 0.8235294, 1.0,
    1.0, 0.76862746, 0.20784314, 1.0,
    0.85490197, 0.27450982, 0.039215688, 1.0,
    0.5019608, 0.0, 0.5764706, 1.0,
    0.14509805, 0.21960784, 1.0, 1.0,
    0.14509805, 0.21960784, 1.0, 1.0,
    0.14509805, 0.21960784, 1.0, 1.0,
    0.14509805, 0.21960784, 1.0, 1.0,
    0.14509805, 0.21960784, 1.0, 1.0,
]);

const SIZE_WORD = 0;
const TIME_WORD = 2;
const ANIMATED = true;
const CLEAR_ALPHA = 0;
export default function OrbCausticsView() {
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
