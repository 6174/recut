import type { EffectSchema } from "../types";
import { wrapMeshWgsl } from "./wgsl-wrap";

export const MAX_SIDE = 4;
const ET = MAX_SIDE * MAX_SIDE;
const EN = 4 * ET + 4 * ET + 4;
const EU = 72 * 72 * 6;
const REFERENCE_WIDTH_PT = 393;

const GRID_OPTIONS = [2, 3, 4];

interface FilterDef {
  id: string;
  label: string;
  index: number;
  shader: boolean;
  keys: string[];
  presets: Record<string, number>;
}

export const MESH_FILTERS: FilterDef[] = [
  { id: "none", label: "None", index: 0, shader: false, keys: [], presets: {} },
  { id: "film", label: "Film", index: 13, shader: true, keys: ["fAmount", "fScale", "fAngle", "fSoft", "fGrain", "fFade"], presets: { fAmount: 0.65, fScale: 1.15, fAngle: 20, fSoft: 0.5, fGrain: 0.5, fFade: 0.85 } },
  { id: "grain", label: "Grain", index: 7, shader: true, keys: ["fGrain"], presets: { fGrain: 16 } },
  { id: "blocks", label: "Blocks", index: 12, shader: true, keys: ["fAmount", "fScale", "fInset", "fRound", "fBevel", "fBlur"], presets: { fAmount: 0.6, fScale: 5, fInset: 0, fRound: 0.25, fBevel: 0.3, fBlur: 0 } },
  { id: "fluted", label: "Fluted", index: 11, shader: true, keys: ["fAmount", "fScale", "fAngle"], presets: { fAmount: 0.85, fScale: 5, fAngle: 0 } },
  { id: "glass", label: "Glass", index: 8, shader: true, keys: ["fAmount", "fScale"], presets: { fAmount: 0.5, fScale: 5 } },
  { id: "frosted", label: "Frosted", index: 10, shader: true, keys: ["fAmount", "fBlur"], presets: { fAmount: 0.6, fBlur: 6 } },
  { id: "crystal", label: "Crystal", index: 9, shader: true, keys: ["fAmount", "fScale"], presets: { fAmount: 0.5, fScale: 8 } },
  { id: "ribbed", label: "Ribbed", index: 11, shader: true, keys: ["fAmount", "fScale", "fAngle"], presets: { fAmount: 0.85, fScale: 5, fAngle: 90 } },
  { id: "blur", label: "Blur", index: 1, shader: false, keys: ["fBlur"], presets: { fBlur: 10 } },
  { id: "progressive", label: "Fade blur", index: 2, shader: false, keys: ["fBlur", "fFade"], presets: { fBlur: 16, fFade: 0.5 } },
  { id: "vignette", label: "Vignette", index: 3, shader: false, keys: ["fAmount", "fSoft"], presets: { fAmount: 0.55, fSoft: 0.5 } },
  { id: "brightness", label: "Brightness", index: 4, shader: false, keys: ["fBrightness"], presets: { fBrightness: 0.12 } },
  { id: "contrast", label: "Contrast", index: 5, shader: false, keys: ["fContrast"], presets: { fContrast: 1.35 } },
  { id: "saturation", label: "Saturation", index: 6, shader: false, keys: ["fSaturation"], presets: { fSaturation: 1.6 } },
];

export const FILTER_INDEX: Record<string, number> = Object.fromEntries(
  MESH_FILTERS.map((f) => [f.id, f.index]),
);

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const fract = (v: number) => v - Math.floor(v);

function num(values: Record<string, unknown>, key: string, fallback: number): number {
  const v = values[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function str(values: Record<string, unknown>, key: string, fallback: string): string {
  const v = values[key];
  return typeof v === "string" ? v : fallback;
}
function bool(values: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = values[key];
  return typeof v === "boolean" ? v : fallback;
}

export function hexToRgb(hex: string): [number, number, number] {
  const t = (hex || "#000000").replace("#", "");
  const at = (i: number) => {
    const n = parseInt(t.slice(i, i + 2), 16);
    return (Number.isFinite(n) ? n : 0) / 255;
  };
  return [at(0), at(2), at(4)];
}

const pointKey = (row: number, col: number) => `p${row}${col}`;
const colorKey = (row: number, col: number) => `c${row}${col}`;
const basePosition = (row: number, col: number, rows: number, cols: number): [number, number] => [
  cols > 1 ? col / (cols - 1) : 0.5,
  rows > 1 ? row / (rows - 1) : 0.5,
];

export function resolveGridSize(values: Record<string, unknown>): number {
  const t = parseInt(str(values, "grid", "4"), 10);
  return GRID_OPTIONS.includes(t) ? t : 4;
}

function animStyle(values: Record<string, unknown>): "wave" | "orbit" | "drift" {
  const t = values.anim;
  return t === "wave" || t === "orbit" ? t : "drift";
}

function driftOffset(
  i: number,
  seed: number,
  speed: number,
  style: string,
): [number, number] {
  const s = 2.39996323 * i;
  const o = seed * speed;
  if (style === "wave") {
    return [
      0.3 * Math.cos(0.9 * o - 6.2831853 * 0.5 + 1.7 * s),
      0.85 * Math.sin(1.2 * o - 6.2831853 * 0.5) + 0.15 * Math.sin(2.3 * o - 9.42478 * 0.5),
    ];
  }
  if (style === "orbit") return [Math.sin(o + s), Math.cos(o + s)];
  return [
    0.6 * Math.sin(0.9 * o + s) + 0.4 * Math.sin(1.37 * o + 1.7 * s),
    0.6 * Math.cos(1.13 * o + 1.3 * s) + 0.4 * Math.cos(0.71 * o + 2.1 * s),
  ];
}

function edgeMask(row: number, col: number, rows: number, cols: number, fixEdges: boolean): [number, number] {
  return fixEdges ? [+(col !== 0 && col !== cols - 1), +(row !== 0 && row !== rows - 1)] : [1, 1];
}

function driftLimit(
  base: Array<[number, number]>,
  row: number,
  col: number,
  rows: number,
  cols: number,
): [number, number] {
  const at = (r: number, c: number) => base[r * cols + c];
  const [x, y] = at(row, col);
  let lx = 1;
  let ly = 1;
  if (col > 0) lx = Math.min(lx, (x - at(row, col - 1)[0] - 0.05) / 2);
  if (col < cols - 1) lx = Math.min(lx, (at(row, col + 1)[0] - x - 0.05) / 2);
  if (row > 0) ly = Math.min(ly, (y - at(row - 1, col)[1] - 0.05) / 2);
  if (row < rows - 1) ly = Math.min(ly, (at(row + 1, col)[1] - y - 0.05) / 2);
  return [Math.max(0, lx), Math.max(0, ly)];
}

export interface MeshGrid {
  rows: number;
  cols: number;
  points: Array<[number, number]>;
  colors: string[];
}

export function resolveGrid(values: Record<string, unknown>, seed: number): MeshGrid {
  const side = resolveGridSize(values);
  const animate = bool(values, "animate", true);
  const speed = num(values, "speed", 1);
  const drift = animate ? num(values, "drift", 0.1) : 0;
  const fixEdges = bool(values, "fixEdges", true);
  const style = animStyle(values);

  const base: Array<[number, number]> = [];
  const colors: string[] = [];
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      const raw = values[pointKey(r, c)];
      const fb = basePosition(r, c, side, side);
      const pos =
        Array.isArray(raw) && raw.length === 2 && typeof raw[0] === "number"
          ? [raw[0], raw[1]]
          : fb;
      base.push([clamp01(pos[0]), clamp01(pos[1])]);
      colors.push(str(values, colorKey(r, c), "#000000"));
    }
  }
  // monotonic fix-up so each row/col keeps x/y order
  for (let r = 0; r < side; r++) {
    for (let c = 1; c < side; c++) {
      const minX = base[r * side + c - 1][0] + 0.05;
      const p = base[r * side + c];
      if (p[0] < minX) p[0] = minX;
    }
  }
  for (let c = 0; c < side; c++) {
    for (let r = 1; r < side; r++) {
      const minY = base[(r - 1) * side + c][1] + 0.05;
      const p = base[r * side + c];
      if (p[1] < minY) p[1] = minY;
    }
  }

  const points: Array<[number, number]> = [];
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      const i = r * side + c;
      const [mx, my] = edgeMask(r, c, side, side, fixEdges);
      const [lx, ly] = driftLimit(base, r, c, side, side);
      const [px, py] = base[i];
      let x = px;
      let y = py;
      if (drift > 0 && (mx !== 0 || my !== 0)) {
        const [dx, dy] = driftOffset(i, seed, speed, style);
        x = clamp01(px + dx * drift * lx * mx);
        y = clamp01(py + dy * drift * ly * my);
      }
      points.push([x, y]);
    }
  }
  return { rows: side, cols: side, points, colors };
}

function activeFilter(values: Record<string, unknown>): FilterDef {
  const id = str(values, "filter", "none");
  return MESH_FILTERS.find((f) => f.id === id) ?? MESH_FILTERS[0];
}

interface FilterParams {
  blur: number; fade: number; amount: number; soft: number;
  brightness: number; contrast: number; saturation: number; grain: number;
  scale: number; angle: number; round: number; bevel: number; inset: number;
}

function filterParams(values: Record<string, unknown>): FilterParams {
  return {
    blur: num(values, "fBlur", 8),
    fade: num(values, "fFade", 0.45),
    amount: num(values, "fAmount", 0.5),
    soft: num(values, "fSoft", 0.5),
    brightness: num(values, "fBrightness", 0),
    contrast: num(values, "fContrast", 1),
    saturation: num(values, "fSaturation", 1),
    grain: num(values, "fGrain", 16),
    scale: num(values, "fScale", 5),
    angle: num(values, "fAngle", 0),
    round: num(values, "fRound", 0.45),
    bevel: num(values, "fBevel", 0.3),
    inset: num(values, "fInset", 0.08),
  };
}

function hueDegrees(values: Record<string, unknown>, t: number): number {
  return bool(values, "animate", true) ? num(values, "hue", 0) * t : 0;
}

function packMesh(scratch: Float32Array, grid: MeshGrid, bg: [number, number, number], hueRad: number, smooth: number) {
  scratch.fill(0);
  for (let i = 0; i < grid.points.length && i < ET; i++) {
    scratch[4 * i] = grid.points[i][0];
    scratch[4 * i + 1] = grid.points[i][1];
    const [r, g, b] = hexToRgb(grid.colors[i]);
    const o = 4 * ET + 4 * i;
    scratch[o] = r;
    scratch[o + 1] = g;
    scratch[o + 2] = b;
    scratch[o + 3] = 1;
  }
  const meta = 8 * ET;
  scratch[meta] = grid.cols;
  scratch[meta + 1] = grid.rows;
  scratch[meta + 2] = hueRad;
  scratch[meta + 3] = smooth;
}

function packPost(
  post: Float32Array,
  values: Record<string, unknown>,
  width: number,
  height: number,
  bg: [number, number, number],
) {
  const f = activeFilter(values);
  const t = filterParams(values);
  let p: number[] = [];
  switch (f.id) {
    case "blur": p = [t.blur]; break;
    case "progressive": p = [t.blur, t.fade]; break;
    case "vignette": p = [t.amount, t.soft]; break;
    case "brightness": p = [t.brightness]; break;
    case "contrast": p = [t.contrast]; break;
    case "saturation": p = [t.saturation]; break;
    case "grain": p = [t.grain]; break;
    case "glass":
    case "crystal": p = [t.amount, t.scale]; break;
    case "blocks": p = [t.amount, t.scale, t.round, t.bevel, t.blur, t.inset]; break;
    case "fluted":
    case "ribbed": p = [t.amount, t.scale, t.angle]; break;
    case "frosted": p = [t.amount, t.blur]; break;
    case "film": p = [t.amount, t.scale, t.angle, t.soft, t.grain, t.fade]; break;
    default: p = [];
  }
  const d = (i: number) => p[i] ?? 0;
  post[0] = FILTER_INDEX[f.id];
  post[1] = d(0);
  post[2] = d(1);
  post[3] = width / REFERENCE_WIDTH_PT;
  post[4] = width;
  post[5] = height;
  post[6] = 1 / width;
  post[7] = 1 / height;
  post[8] = bg[0];
  post[9] = bg[1];
  post[10] = bg[2];
  post[11] = 1;
  post[12] = d(2);
  post[13] = d(3);
  post[14] = d(4);
  post[15] = d(5);
}

export function wrapMeshWgslStub(source: string): string {
  return source;
}

export interface MeshRenderer {
  frame: (values: Record<string, unknown>, timeSec: number, width: number, height: number, target: GPUTextureView) => void;
  dispose: () => void;
}

export async function createMeshRenderer(
  device: GPUDevice,
  canvasFormat: string,
  wgslSource: string,
): Promise<MeshRenderer> {
  const code = wrapMeshWgsl(wgslSource);
  const module = device.createShaderModule({ code, label: "mf-mesh" });
  const meshPipeline = device.createRenderPipeline({
    label: "mf-mesh-pipe",
    layout: "auto",
    vertex: { module, entryPoint: "vs_main" },
    fragment: { module, entryPoint: "fs_main", targets: [{ format: "rgba8unorm" }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
  });
  const postPipeline = device.createRenderPipeline({
    label: "mf-mesh-post-pipe",
    layout: "auto",
    vertex: { module, entryPoint: "vs_post" },
    fragment: { module, entryPoint: "fs_post", targets: [{ format: canvasFormat }] },
    primitive: { topology: "triangle-list" },
  });

  const uniformBuffer = device.createBuffer({
    label: "mf-mesh-uniforms",
    size: 4 * EN,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const postBuffer = device.createBuffer({
    label: "mf-mesh-post",
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });

  const meshBind = device.createBindGroup({
    layout: meshPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  let target: GPUTexture | null = null;
  let targetW = 0;
  let targetH = 0;
  let postBind: GPUBindGroup | null = null;

  const scratch = new Float32Array(EN);
  const postScratch = new Float32Array(16);

  function ensureTarget(w: number, h: number) {
    if (target && targetW === w && targetH === h) return;
    target?.destroy();
    target = device.createTexture({
      label: "mf-mesh-target",
      size: [w, h],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    targetW = w;
    targetH = h;
    postBind = device.createBindGroup({
      layout: postPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: postBuffer } },
        { binding: 1, resource: target.createView() },
        { binding: 2, resource: sampler },
      ],
    });
  }

  return {
    frame(values, timeSec, width, height, targetView) {
      if (width < 1 || height < 1) return;
      ensureTarget(width, height);
      if (!target || !postBind) return;
      const t = Math.max(0, timeSec);
      const grid = resolveGrid(values, t);
      const smooth = +(values.smooth !== false);
      const bg = hexToRgb(str(values, "background", "#000000"));
      packMesh(scratch, grid, bg, (hueDegrees(values, t) * Math.PI) / 180, smooth);
      device.queue.writeBuffer(uniformBuffer, 0, scratch);
      packPost(postScratch, values, width, height, bg);
      device.queue.writeBuffer(postBuffer, 0, postScratch);

      const encoder = device.createCommandEncoder({ label: "mf-mesh-frame" });
      const meshPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: target.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: bg[0], g: bg[1], b: bg[2], a: 1 },
        }],
      });
      meshPass.setPipeline(meshPipeline);
      meshPass.setBindGroup(0, meshBind);
      meshPass.draw(EU, 1, 0, 0);
      meshPass.end();
      const postPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: targetView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: bg[0], g: bg[1], b: bg[2], a: 1 },
        }],
      });
      postPass.setPipeline(postPipeline);
      postPass.setBindGroup(0, postBind);
      postPass.draw(3, 1, 0, 0);
      postPass.end();
      device.queue.submit([encoder.finish()]);
    },
    dispose() {
      uniformBuffer.destroy();
      postBuffer.destroy();
      target?.destroy();
      target = null;
      postBind = null;
    },
  };
}
