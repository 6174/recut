import type { EffectSchema, EffectParam } from "./types";

export interface UniformLayout {
  byteSize: number;
  sizeOffset: number;
  timeOffset: number;
  paramSlots: Array<{
    push: (f32: Float32Array, values: Record<string, unknown>) => void;
  }>;
}

const align = (u: number, a: number) => Math.ceil(u / a) * a;

function floatScalar(param: EffectParam, v: unknown): number {
  switch (param.type) {
    case "float":
      return typeof v === "number" && Number.isFinite(v) ? v : (param.default as number);
    case "select": {
      if (typeof v !== "string") return 0;
      const idx = (param.options ?? []).findIndex((o) => o.value === v);
      return Math.max(0, idx);
    }
    case "toggle":
      return +!!v;
    default:
      return 0;
  }
}

export function buildLayout(effect: EffectSchema): UniformLayout {
  const keys = effect.mslArgOrder ?? effect.params.map((p) => p.key);
  const byKey = new Map(effect.params.map((p) => [p.key, p]));
  let u = 0;
  const sizeOffset = align(u, 8) / 4;
  u = align(u, 8) + 8;
  const timeOffset = u / 4;
  u += 4;
  const paramSlots: UniformLayout["paramSlots"] = [];
  for (const key of keys) {
    const param = byKey.get(key);
    if (!param) continue;
    if (param.type === "float" || param.type === "select" || param.type === "toggle") {
      u = align(u, 4);
      const slot = u / 4;
      u += 4;
      paramSlots.push({
        push: (f32, values) => {
          f32[slot] = floatScalar(param, values[param.key]);
        },
      });
    } else if (param.type === "float2") {
      u = align(u, 8);
      const slot = u / 4;
      u += 8;
      const def = param.default as number[];
      paramSlots.push({
        push: (f32, values) => {
          const v = values[param.key];
          const a = Array.isArray(v) && v.length === 2 ? v : def;
          f32[slot] = a[0];
          f32[slot + 1] = a[1];
        },
      });
    } else if (param.type === "color") {
      u = align(u, 16);
      const slot = u / 4;
      u += 16;
      const def = param.default as string;
      paramSlots.push({
        push: (f32, values) => {
          const hex = (values[param.key] as string) ?? def;
          const t = (hex || "#ffffff").replace("#", "");
          f32[slot] = parseInt(t.slice(0, 2), 16) / 255;
          f32[slot + 1] = parseInt(t.slice(2, 4), 16) / 255;
          f32[slot + 2] = parseInt(t.slice(4, 6), 16) / 255;
          f32[slot + 3] = 1;
        },
      });
    }
  }
  u = align(u, 16);
  return { byteSize: u, sizeOffset, timeOffset, paramSlots };
}

export function encodeUniforms(
  layout: UniformLayout,
  values: Record<string, unknown>,
  width: number,
  height: number,
  time: number,
): Float32Array {
  const f32 = new Float32Array(Math.max(layout.byteSize, 16) / 4);
  f32[layout.sizeOffset] = width;
  f32[layout.sizeOffset + 1] = height;
  f32[layout.timeOffset] = time;
  for (const slot of layout.paramSlots) slot.push(f32, values);
  return f32;
}

export function defaultValues(effect: EffectSchema): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const p of effect.params) {
    values[p.key] = p.type === "colors" && Array.isArray(p.default) ? [...p.default] : p.default;
  }
  for (const p of effect.params) {
    if (p.type !== "select") continue;
    const opt = (p.options ?? []).find((o) => o.value === p.default);
    if (opt?.presets) Object.assign(values, opt.presets);
  }
  return values;
}

const PALETTE_MAX = 12;

export function paletteStops(effect: EffectSchema, values: Record<string, unknown>): string[] {
  const ramp = effect.paletteRamp;
  const key = ramp?.key ?? "palette";
  const raw = values[key];
  const stops = Array.isArray(raw) ? (raw as string[]) : [];
  return stops.filter((s) => typeof s === "string" && s.startsWith("#"));
}

export function resolvePalette(
  effect: EffectSchema,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const stops = paletteStops(effect, values);
  out.palette = stops;
  out.paletteCount = stops.length;
  for (let i = 0; i < PALETTE_MAX; i++) out[`paletteStop${i}`] = stops[Math.min(i, stops.length - 1)] ?? "#ffffff";
  return out;
}
