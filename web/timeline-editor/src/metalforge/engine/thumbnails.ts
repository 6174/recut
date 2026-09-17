import type { EffectSchema } from "../types";
import { defaultValues } from "./layout";
import { resolvePalette } from "./layout";
import { loadEffectSource } from "./catalog-load";
import { getSharedDevice } from "./preview";
import { drawCompiled, type Compiled } from "./preview";

const THUMB_W = 480;
const THUMB_H = 360;
const THUMB_TIME = 2.5;

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function align256(n: number): number {
  return Math.ceil(n / 256) * 256;
}

async function renderToDataUrl(
  device: GPUDevice,
  compiled: Compiled,
  values: Record<string, unknown>,
  width: number,
  height: number,
  time: number,
): Promise<string> {
  const texture = device.createTexture({
    size: [width, height],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  drawCompiled(device, compiled, null, texture.createView(), values, time, width, height);

  const bytesPerRow = align256(width * 4);
  const readback = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer: readback, bytesPerRow, rowsPerImage: height },
    [width, height],
  );
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const raw = new Uint8Array(readback.getMappedRange());

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const srcStart = y * bytesPerRow;
    const dstStart = y * width * 4;
    for (let x = 0; x < width * 4; x++) {
      image.data[dstStart + x] = raw[srcStart + x];
    }
  }
  ctx.putImageData(image, 0, 0);
  const url = canvas.toDataURL("image/png");

  readback.unmap();
  readback.destroy();
  texture.destroy();
  return url;
}

export async function renderThumbnail(effect: EffectSchema): Promise<string> {
  const cached = cache.get(effect.id);
  if (cached) return cached;
  const running = inflight.get(effect.id);
  if (running) return running;

  const job = (async () => {
    const { device } = await getSharedDevice();
    const values = {
      ...defaultValues(effect),
      ...resolvePalette(effect, defaultValues(effect)),
    };
    let compiled: Compiled | null = null;
    try {
      if (effect.kind === "meshgradient") {
        const { createMeshRenderer } = await import("./mesh");
        const source = await loadEffectSource(effect.id);
        const renderer = await createMeshRenderer(device, "rgba8unorm", source);
        compiled = { kind: "mesh", renderer };
      } else if (effect.kind === "particle") {
        const { createParticlePipeline } = await import("./particle");
        const source = await loadEffectSource(effect.id);
        compiled = { kind: "particle", pipeline: createParticlePipeline(device, "rgba8unorm", source, effect) };
      } else if (effect.kind === "metal") {
        const source = await loadEffectSource(effect.id);
        const { wrapFullscreenWgsl } = await import("./wgsl-wrap");
        const { buildLayout } = await import("./layout");
        const module = device.createShaderModule({
          code: wrapFullscreenWgsl(source, effect.wgslEntry),
          label: `mf-thumb-${effect.id}`,
        });
        const layout = buildLayout(effect);
        const uniformBuffer = device.createBuffer({
          size: Math.max(layout.byteSize, 16),
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const pipeline = device.createRenderPipeline({
          layout: "auto",
          vertex: { module, entryPoint: "vs_main" },
          fragment: { module, entryPoint: "fs_main", targets: [{ format: "rgba8unorm" }] },
          primitive: { topology: "triangle-list" },
        });
        compiled = {
          kind: "fullscreen",
          pipeline,
          uniformBuffer,
          layout,
          bindGroup: device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
          }),
        };
      } else {
        throw new Error(`kind "${effect.kind}" 暂无静态缩略图渲染器`);
      }
      const url = await renderToDataUrl(device, compiled, values, THUMB_W, THUMB_H, THUMB_TIME);
      cache.set(effect.id, url);
      return url;
    } finally {
      if (compiled) {
        if (compiled.kind === "mesh") compiled.renderer.dispose();
        else if (compiled.kind === "particle") compiled.pipeline.dispose();
        else compiled.uniformBuffer.destroy();
      }
      inflight.delete(effect.id);
    }
  })();
  inflight.set(effect.id, job);
  return job;
}

export function peekThumbnail(id: string): string | undefined {
  return cache.get(id);
}

// Filter option swatches for meshgradient effects: one mini render per filter.
export async function renderFilterSwatches(
  effect: EffectSchema,
  values: Record<string, unknown>,
): Promise<Record<string, string>> {
  const { device } = await getSharedDevice();
  const { createMeshRenderer } = await import("./mesh");
  const { MESH_FILTERS } = await import("./mesh");
  const source = await loadEffectSource(effect.id);
  const renderer = await createMeshRenderer(device, "rgba8unorm", source);
  const out: Record<string, string> = {};
  try {
    for (const f of MESH_FILTERS) {
      const v = { ...values, filter: f.id, ...f.presets };
      // small offscreen render per filter
      const url = await renderWithRenderer(device, renderer, v, 96, 72, 0);
      out[f.id] = url;
    }
  } finally {
    renderer.dispose();
  }
  return out;
}

async function renderWithRenderer(
  device: GPUDevice,
  renderer: { frame: (v: Record<string, unknown>, t: number, w: number, h: number, view: GPUTextureView) => void },
  values: Record<string, unknown>,
  width: number,
  height: number,
  time: number,
): Promise<string> {
  const texture = device.createTexture({
    size: [width, height],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  renderer.frame(values, time, width, height, texture.createView());
  const bytesPerRow = align256(width * 4);
  const readback = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer: readback, bytesPerRow, rowsPerImage: height },
    [width, height],
  );
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const raw = new Uint8Array(readback.getMappedRange());
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const srcStart = y * bytesPerRow;
    const dstStart = y * width * 4;
    for (let x = 0; x < width * 4; x++) image.data[dstStart + x] = raw[srcStart + x];
  }
  ctx.putImageData(image, 0, 0);
  const url = canvas.toDataURL("image/png");
  readback.unmap();
  readback.destroy();
  texture.destroy();
  return url;
}
