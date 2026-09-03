"use client";

import { useEffect, useRef, useState } from "react";

const WGSL = `
struct Uniforms {
  size:         vec2<f32>,
  time:         f32,
  style:        f32,
  speed:        f32,
  brightness:   f32,
  tint:         vec4<f32>,
  background:   vec4<f32>,
  dotSize:      f32,
  gridDensity:  f32,
  patternScale: f32,
  vignette:     f32,
  horizon:      f32,
  amplitude:    f32,
  depthFade:    f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn dtRound(x: f32) -> f32 {
  return sign(x) * floor(abs(x) + 0.5);
}

fn dtRound2(v: vec2<f32>) -> vec2<f32> {
  return sign(v) * floor(abs(v) + 0.5);
}

fn dotsWavyH(x: f32, z: f32, t: f32) -> f32 {
  let ps = u.patternScale;
  var base = (sin(x * 3.6 * ps + t * 0.85) * 0.45
            + sin(z * 2.2 * ps + t * 0.65) * 0.40
            + sin((x * 1.9 + z * 2.0) * ps + t * 1.10) * 0.30
            + sin((x * 2.8 - z * 1.3) * ps + t * 0.45) * 0.22) * 0.16;
  let damp = 1.0 - smoothstep(3.5, 9.0, z) * 0.85;
  return base * damp * u.amplitude;
}

fn dotsMountainsH(x: f32, z: f32, t: f32) -> f32 {
  let ps = u.patternScale;
  var h = sin(x * 1.0 * ps + t * 0.20) * 0.50
        + sin(z * 0.8 * ps + t * 0.15) * 0.50
        + sin((x * 2.3 + z * 1.7) * ps + t * 0.30) * 0.30
        + sin((x * 4.7 - z * 3.1) * ps + t * 0.40) * 0.18
        + sin((x * 9.0 + z * 7.0) * ps + t * 0.55) * 0.10;
  h = 1.0 - abs(h * 0.5);
  h = pow(max(h, 0.0), 2.5) - 0.4;
  h = h * 0.16;
  let damp = 1.0 - smoothstep(4.0, 10.0, z) * 0.85;
  return h * damp * u.amplitude;
}

fn dotsOceanH(x: f32, z: f32, t: f32) -> f32 {
  let ps = u.patternScale;
  var base = sin(x * 1.2 * ps + t * 0.55) * 0.55
           + sin(z * 0.9 * ps + t * 0.45) * 0.50
           + sin((x * 0.5 + z * 0.7) * ps + t * 0.70) * 0.40
           + sin((x * 1.5 - z * 0.6) * ps + t * 0.35) * 0.20;
  base = base * 0.20;
  let damp = 1.0 - smoothstep(3.5, 9.0, z) * 0.85;
  return base * damp * u.amplitude;
}

fn dotsStandingH(x: f32, z: f32, t: f32) -> f32 {
  let ps = u.patternScale;
  let a = sin(x * 4.5 * ps) * sin(z * 4.5 * ps);
  let b = sin(x * 7.0 * ps + 1.0) * sin(z * 7.0 * ps + 1.0);
  let env = sin(t * 1.4);
  var h = (a * 0.7 + b * 0.3) * env;
  h = h * 0.13;
  let damp = 1.0 - smoothstep(3.5, 9.0, z) * 0.85;
  return h * damp * u.amplitude;
}

fn heightFor(styleI: i32, x: f32, z: f32, t: f32) -> f32 {
  if (styleI == 0) { return dotsWavyH(x, z, t); }
  if (styleI == 1) { return dotsMountainsH(x, z, t); }
  if (styleI == 2) { return dotsOceanH(x, z, t); }
  return dotsStandingH(x, z, t);
}

fn renderDots3D(styleI: i32, position: vec2<f32>) -> vec3<f32> {
  let size = u.size;
  let uv   = (position - 0.5 * size) / size.y;
  let t    = u.time * u.speed;
  let horizon = u.horizon;

  let yFromHorizon = uv.y - horizon;
  if (yFromHorizon < 0.002) {
    return vec3<f32>(0.0);
  }

  let gridSize     = 0.034 / max(u.gridDensity, 0.01);
  let cellZmax     = 9.1;
  let jMaxAbsolute = cellZmax / gridSize;

  let yampBase = select(
    select(0.13, 0.33, styleI == 2),
    select(0.22, 0.12, styleI == 1),
    styleI == 0 || styleI == 1);
  let yampMax   = yampBase * u.amplitude;
  let Zmin      = max(0.05, (1.0 - yampMax) / yFromHorizon);
  let dampEst   = 1.0 - smoothstep(3.5, 9.0, Zmin) * 0.85;
  let yampBound = max(yampBase * dampEst * u.amplitude, 0.03);
  let Zlo = max(0.05, (1.0 - yampBound) / yFromHorizon);
  let Zhi = (1.0 + yampBound) / yFromHorizon;
  let jMin = max(1, i32(floor(Zlo / gridSize)));
  let jMax = min(i32(jMaxAbsolute), i32(ceil(Zhi / gridSize)));
  let isWavy = styleI == 0;

  var accum: vec3<f32> = vec3<f32>(0.0);
  let halfSizeX = 0.5 * size.x;
  let halfSizeY = 0.5 * size.y;

  let depthK = select(0.32, 0.35, styleI == 0 || styleI == 2);

  let crestRef = select(0.13, 0.16,
                  styleI == 1 || styleI == 0);
  let crestRefFinal = select(
    select(crestRef, 0.28, styleI == 2),
    0.22, styleI == 0);

  for (var j: i32 = jMin; j <= jMax; j = j + 1) {
    let jf    = f32(j);
    let cellZ = jf * gridSize;

    let rawR             = 4.4 / (1.0 + cellZ * 1.10);
    let pxR              = max(rawR, 0.85) * u.dotSize;
    let horizCullThresh  = pxR * 4.0 + 2.0;
    let baseHaloScale    = max(pxR * 1.7, 1.2);
    let subPxFade        = smoothstep(0.4, 1.0, rawR);
    let depth            = 1.0 / (1.0 + cellZ * depthK * u.depthFade);
    let invCellZ         = 1.0 / cellZ;
    let pitchScreenX     = gridSize * invCellZ * size.y;
    let haloScale        = select(baseHaloScale, max(baseHaloScale, pitchScreenX * 0.5), styleI == 0);
    let iCenter          = dtRound(uv.x * jf);
    let iCenterScreenX   = iCenter * pitchScreenX + halfSizeX;
    let iCenterCellX     = iCenter * gridSize;

    for (var di: i32 = -1; di <= 1; di = di + 1) {
      let dotScreenX = iCenterScreenX + f32(di) * pitchScreenX;
      if (abs(position.x - dotScreenX) > horizCullThresh) { continue; }

      let cellX = iCenterCellX + f32(di) * gridSize;
      let Y     = heightFor(styleI, cellX, cellZ, t);
      let dotYFromH = (1.0 - Y) * invCellZ;
      if (dotYFromH < 0.01) { continue; }
      let dotScreenY = (horizon + dotYFromH) * size.y + halfSizeY;
      if (isWavy) {
        if (abs(position.y - dotScreenY) > horizCullThresh) { continue; }
      }

      let horizonFade = smoothstep(0.0, 0.05, dotYFromH);
      let d           = length(position - vec2<f32>(dotScreenX, dotScreenY));
      let mask        = smoothstep(pxR + 1.0, pxR - 1.0, d);
      let halo        = exp(-d / haloScale) * 0.25;
      let crest       = clamp(Y / (crestRefFinal * max(u.amplitude, 0.01)) * 0.5 + 0.5, 0.0, 1.0);

      var highlight: f32;
      if (styleI == 0)      { highlight = 0.55 + 0.85 * crest; }
      else if (styleI == 1) { highlight = 0.35 + 0.55 * crest + 0.6 * pow(crest, 3.0); }
      else if (styleI == 2) { highlight = 0.45 + 1.0  * crest; }
      else                  { highlight = 0.40 + 1.0  * crest; }

      let intensity = (mask + halo) * depth * highlight * horizonFade * subPxFade;
      accum = max(accum, vec3<f32>(intensity));
    }
  }

  let boost = select(
    select(1.2, 1.15, styleI == 1),
    1.25, styleI == 0 || styleI == 2);
  accum = min(accum * boost, vec3<f32>(1.0));

  let vUV  = (position - 0.5 * size) / size;
  let vigK = select(0.5, 0.6, styleI == 0 || styleI == 2);
  let vig  = clamp(1.0 - dot(vUV, vUV) * vigK * u.vignette, 0.0, 1.0);
  accum = accum * vig;

  if (styleI == 2) {
    accum = accum * vec3<f32>(0.92, 0.97, 1.0);
  }
  return accum;
}

fn renderDotsFlow(position: vec2<f32>) -> f32 {
  let size = u.size;
  let uv   = (position - 0.5 * size) / size.y;
  let t    = u.time * u.speed;
  let ps   = u.patternScale;

  let grid       = 0.020 / max(u.gridDensity, 0.01);
  let cell       = dtRound2(uv / grid) * grid;
  let distToDot  = length(uv - cell);
  let pxR        = (1.4 / size.y) * u.dotSize;
  let mask       = smoothstep(pxR * 1.4, pxR * 0.6, distToDot);

  let n = sin(cell.x * 3.0 * ps + t * 0.4) * cos(cell.y * 3.0 * ps - t * 0.35)
        + 0.5 * sin(cell.x * 7.0 * ps - t * 0.6) * sin(cell.y * 7.0 * ps + t * 0.55);

  let fronts = sin(n * 6.0 + length(cell) * 8.0 * ps - t * 1.8);
  let bright = pow(max(fronts, 0.0), 1.8);

  let vUV = (position - 0.5 * size) / size;
  let vig = clamp(1.0 - dot(vUV, vUV) * 0.85 * u.vignette, 0.0, 1.0);
  return mask * (0.10 + 1.0 * bright) * vig;
}

fn renderDotsPlasma(position: vec2<f32>) -> f32 {
  let size = u.size;
  let uv   = (position - 0.5 * size) / size.y;
  let t    = u.time * u.speed;
  let ps   = u.patternScale;

  let grid       = 0.018 / max(u.gridDensity, 0.01);
  let cell       = dtRound2(uv / grid) * grid;
  let distToDot  = length(uv - cell);
  let pxR        = (1.6 / size.y) * u.dotSize;
  let mask       = smoothstep(pxR * 1.4, pxR * 0.6, distToDot);

  var v = sin(cell.x * 8.0 * ps + t * 1.3)
        + sin(cell.y * 8.0 * ps + t * 1.1)
        + sin((cell.x + cell.y) * 6.0 * ps + t * 1.5)
        + sin(length(cell) * 10.0 * ps - t * 1.8);
  v = v * 0.25;
  var bright = clamp(0.5 + 0.5 * v, 0.0, 1.0);
  bright = pow(bright, 2.5);

  let vUV = (position - 0.5 * size) / size;
  let vig = clamp(1.0 - dot(vUV, vUV) * 0.9 * u.vignette, 0.0, 1.0);
  return mask * bright * vig;
}

fn renderDotsSnake(position: vec2<f32>) -> f32 {
  let size = u.size;
  let uv   = (position - 0.5 * size) / size.y;
  let t    = u.time * u.speed;
  let ps   = u.patternScale;

  let grid       = 0.018 / max(u.gridDensity, 0.01);
  let cell       = dtRound2(uv / grid) * grid;
  let distToDot  = length(uv - cell);
  let pxR        = (1.5 / size.y) * u.dotSize;
  let mask       = smoothstep(pxR * 1.4, pxR * 0.6, distToDot);

  let angle = sin(cell.x * 4.0 * ps + t * 0.6) * 1.2
            + cos(cell.y * 4.0 * ps - t * 0.5) * 1.2
            + sin((cell.x + cell.y) * 3.0 * ps + t * 0.9);
  let flow = vec2<f32>(cos(angle), sin(angle));

  let phase  = dot(cell, flow) * 12.0 * ps - t * 4.0;
  var bright = 0.5 + 0.5 * sin(phase);
  bright = pow(bright, 4.0);

  let vUV = (position - 0.5 * size) / size;
  let vig = clamp(1.0 - dot(vUV, vUV) * 0.7 * u.vignette, 0.0, 1.0);
  return mask * (0.10 + 1.1 * bright) * vig;
}

fn dotsField(uv01: vec2<f32>) -> vec4<f32> {
  let position = uv01 * u.size;
  let styleI   = i32(u.style);

  let fg = u.tint.rgb * u.brightness;
  let bg = u.background.rgb;

  if (styleI <= 3) {
    let accum = renderDots3D(styleI, position);
    let col   = mix(bg, fg, accum);
    return vec4<f32>(col, 1.0);
  }

  var intensity: f32 = 0.0;
  if (styleI == 4)      { intensity = renderDotsFlow(position); }
  else if (styleI == 5) { intensity = renderDotsPlasma(position); }
  else                  { intensity = renderDotsSnake(position); }
  let col = mix(bg, fg, vec3<f32>(intensity));
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
  return dotsField(in.uv);
}
`;

const UNIFORMS = new Float32Array([
    0.0, 0.0,
    0.0,
    0.0,
    1.0,
    1.0,
    0.0, 0.0,
    1.0, 1.0, 1.0, 1.0,
    0.0, 0.0, 0.0, 1.0,
    1.0,
    1.0,
    1.0,
    1.0,
    -0.45,
    1.0,
    1.0,
    0.0,
]);

const SIZE_WORD = 0;
const TIME_WORD = 2;
const ANIMATED = true;
const CLEAR_ALPHA = 1;
export default function DotsView() {
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
