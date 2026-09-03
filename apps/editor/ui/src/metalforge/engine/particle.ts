import type { EffectSchema } from "../types";
import { wrapParticleWgsl } from "./wgsl-wrap";

// Uniform layout of particle-field's `U` struct (WGSL alignment):
// size@0 vec2, time@8, rotation@12, spin@16, radius@20, strength@24,
// decay@28, turbulence@32, pointSize@36, style@40, pad@44,
// background@48, glow@64, particle@80 -> 96 bytes total.
const FLOATS = 24;

export function colorToRgba(hex: string): [number, number, number, number] {
  const t = (hex || "#000000").replace("#", "").slice(0, 6);
  const at = (i: number) => {
    const n = parseInt(t.slice(i, i + 2), 16);
    return (Number.isFinite(n) ? n : 0) / 255;
  };
  return [at(0), at(2), at(4), 1];
}

export interface ParticlePipeline {
  draw: (view: GPUTextureView, values: Record<string, unknown>, time: number, width: number, height: number) => void;
  dispose: () => void;
}

export function createParticlePipeline(
  device: GPUDevice,
  targetFormat: string,
  wgslSource: string,
  effect: EffectSchema,
): ParticlePipeline {
  const code = wrapParticleWgsl(wgslSource);
  const module = device.createShaderModule({ code, label: `mf-${effect.id}` });
  const pipeline = device.createRenderPipeline({
    label: `mf-${effect.id}-pipe`,
    layout: "auto",
    vertex: { module, entryPoint: "vs_main" },
    fragment: {
      module,
      entryPoint: "fs_main",
      targets: [{
        format: targetFormat,
        blend: {
          color: { srcFactor: "one", dstFactor: "one", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
        },
      }],
    },
    primitive: { topology: "triangle-strip", cullMode: "none" },
  });

  const uniformBuffer = device.createBuffer({
    size: FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const touchesBuffer = device.createBuffer({
    size: 64 * 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const parked = new Float32Array(64 * 4);
  for (let i = 0; i < 64; i++) parked[4 * i + 2] = 99;
  device.queue.writeBuffer(touchesBuffer, 0, parked);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: touchesBuffer } },
    ],
  });

  const byKey = new Map(effect.params.map((p) => [p.key, p]));
  const argOrder = effect.mslArgOrder ?? effect.params.map((p) => p.key);

  function pack(values: Record<string, unknown>, time: number, width: number, height: number): Float32Array {
    const f = new Float32Array(FLOATS);
    f[0] = width;
    f[1] = height;
    f[2] = time;
    let slot = 3;
    const colorArgs: Array<{ key: string; def: string }> = [];
    for (const key of argOrder) {
      const p = byKey.get(key);
      if (!p) continue;
      if (p.type === "float") {
        const v = values[key];
        f[slot] = typeof v === "number" && Number.isFinite(v) ? v : (p.default as number);
        slot += 1;
      } else if (p.type === "select") {
        const v = values[key];
        const idx =
          typeof v === "string" ? Math.max(0, (p.options ?? []).findIndex((o) => o.value === v)) : 0;
        f[slot] = idx;
        slot += 1;
      } else if (p.type === "color") {
        colorArgs.push({ key, def: p.default as string });
      }
    }
    colorArgs.forEach((c, i) => {
      const [r, g, b, a] = colorToRgba((values[c.key] as string) ?? c.def);
      const o = 12 + i * 4;
      f[o] = r;
      f[o + 1] = g;
      f[o + 2] = b;
      f[o + 3] = a;
    });
    return f;
  }

  return {
    draw(view, values, time, width, height) {
      device.queue.writeBuffer(uniformBuffer, 0, pack(values, time, width, height));
      const bgParam = effect.params.find((p) => p.type === "color" && p.key.includes("background"));
      const [br, bg_, bb] = colorToRgba((bgParam ? (values[bgParam.key] as string) : undefined) ?? (bgParam?.default as string) ?? "#000000");
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: br, g: bg_, b: bb, a: 1 },
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(4, 150000, 0, 0);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    dispose() {
      uniformBuffer.destroy();
      touchesBuffer.destroy();
    },
  };
}
