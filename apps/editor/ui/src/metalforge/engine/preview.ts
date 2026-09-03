import { buildLayout, encodeUniforms, resolvePalette, type UniformLayout } from "./layout";
import { wrapFullscreenWgsl } from "./wgsl-wrap";
import { createMeshRenderer, type MeshRenderer } from "./mesh";
import { createParticlePipeline, type ParticlePipeline } from "./particle";
import type { EffectSchema } from "../types";
import { loadEffectSource } from "./catalog-load";

export interface PreviewHandle {
  setValues: (values: Record<string, unknown>) => void;
  setPlaying: (playing: boolean) => void;
  resetTime: () => void;
  dispose: () => void;
}

let sharedDevicePromise: Promise<{ device: GPUDevice; format: string }> | null = null;

export async function getSharedDevice(): Promise<{ device: GPUDevice; format: string }> {
  if (!sharedDevicePromise) {
    sharedDevicePromise = (async () => {
      if (!navigator.gpu) throw new Error("WebGPU 不可用（需要 Chrome/Edge 113+ 或 Safari 18+）");
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("无法获取 GPUAdapter");
      const device = await adapter.requestDevice();
      device.addEventListener("uncapturederror", (e) => {
        console.error("[metalforge] GPU uncaptured error:", (e as GPUUncapturedErrorEvent).error.message);
      });
      return { device, format: navigator.gpu.getPreferredCanvasFormat() };
    })();
  }
  return sharedDevicePromise;
}

interface CompiledFullscreen {
  kind: "fullscreen";
  pipeline: GPURenderPipeline;
  bindGroup: GPUBindGroup;
  uniformBuffer: GPUBuffer;
  layout: UniformLayout;
}

interface CompiledMesh {
  kind: "mesh";
  renderer: MeshRenderer;
}

interface CompiledParticle {
  kind: "particle";
  pipeline: ParticlePipeline;
}

type Compiled = CompiledFullscreen | CompiledMesh | CompiledParticle;

async function compile(
  device: GPUDevice,
  format: string,
  effect: EffectSchema,
): Promise<Compiled> {
  if (effect.kind === "meshgradient") {
    const source = await loadEffectSource(effect.id);
    const renderer = await createMeshRenderer(device, format, source);
    return { kind: "mesh", renderer };
  }
  if (effect.kind === "particle") {
    const source = await loadEffectSource(effect.id);
    const pipeline = createParticlePipeline(device, format, source, effect);
    return { kind: "particle", pipeline };
  }
  if (effect.kind !== "metal") {
    throw new Error(`kind "${effect.kind}" 的交互预览需要专用模拟器（暂未接入）`);
  }
  // fullscreen fragment effect
  const source = await loadEffectSource(effect.id);
  const code = wrapFullscreenWgsl(source, effect.wgslEntry);
  const shaderModule = device.createShaderModule({ code, label: `mf-${effect.id}` });
  const info = await shaderModule.getCompilationInfo();
  const errs = info.messages.filter((m) => m.type === "error");
  if (errs.length) {
    throw new Error(errs.map((m) => `L${m.lineNum}: ${m.message}`).join("\n"));
  }
  const layout = buildLayout(effect);
  const uniformBuffer = device.createBuffer({
    size: Math.max(layout.byteSize, 16),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shaderModule, entryPoint: "vs_main" },
    fragment: { module: shaderModule, entryPoint: "fs_main", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });
  return { kind: "fullscreen", pipeline, bindGroup, uniformBuffer, layout };
}

function drawCompiled(
  device: GPUDevice,
  compiled: Compiled,
  ctx: GPUCanvasContext | null,
  view: GPUTextureView,
  values: Record<string, unknown>,
  time: number,
  width: number,
  height: number,
) {
  if (compiled.kind === "mesh") {
    compiled.renderer.frame(values, time, width, height, view);
    return;
  }
  if (compiled.kind === "particle") {
    compiled.pipeline.draw(view, values, time, width, height);
    return;
  }
  const f32 = encodeUniforms(compiled.layout, values, width, height, time);
  device.queue.writeBuffer(compiled.uniformBuffer, 0, f32);
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view,
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
    }],
  });
  pass.setPipeline(compiled.pipeline);
  pass.setBindGroup(0, compiled.bindGroup);
  pass.draw(3, 1, 0, 0);
  pass.end();
  device.queue.submit([encoder.finish()]);
}

export async function mountPreview(
  canvas: HTMLCanvasElement,
  effect: EffectSchema,
  initialValues: Record<string, unknown>,
): Promise<PreviewHandle> {
  const { device, format } = await getSharedDevice();
  const ctx = canvas.getContext("webgpu");
  if (!ctx) throw new Error("无法获取 WebGPU context");
  ctx.configure({ device, format, alphaMode: "opaque" });

  const compiled = await compile(device, format, effect);

  let values = { ...initialValues, ...resolvePaletteFor(effect, initialValues) };
  let playing = true;
  let time = 0;
  let last = performance.now();
  let raf = 0;
  let disposed = false;

  function resolvePaletteFor(e: EffectSchema, v: Record<string, unknown>) {
    return resolvePalette(e, v);
  }

  function resize(): [number, number] {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return [w, h];
  }

  function frame(now: number) {
    if (disposed) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (playing) time += dt;
    const [w, h] = resize();
    drawCompiled(device, compiled, ctx, ctx.getCurrentTexture().createView(), values, time, w, h);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    setValues(next) {
      values = { ...next, ...resolvePaletteFor(effect, next) };
    },
    setPlaying(p) {
      playing = p;
    },
    resetTime() {
      time = 0;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      if (compiled.kind === "mesh") compiled.renderer.dispose();
      if (compiled.kind === "particle") compiled.pipeline.dispose();
      if (compiled.kind === "fullscreen") compiled.uniformBuffer.destroy();
    },
  };
}

export { drawCompiled };
export type { Compiled };
