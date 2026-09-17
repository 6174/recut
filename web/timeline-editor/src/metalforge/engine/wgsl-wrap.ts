// WGSL wrappers matching MetalForge's preview runner.

export function wrapFullscreenWgsl(source: string, entry: string): string {
  return `${source}

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
  return ${entry}(in.uv);
}
`;
}

export function wrapMeshWgsl(source: string): string {
  return source;
}

// Instanced particle quad wrapper: mfParticle(instance) -> {center, halfNDC,
// brightness, depth}. Drawn as a triangle-strip with additive blending.
export function wrapParticleWgsl(source: string): string {
  return `${source}

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) bright: f32,
  @location(2) depth: f32,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0),
  );
  let c = corners[vi];
  let p = mfParticle(ii);
  var out: VOut;
  out.pos = vec4<f32>(p.center + c * p.halfNDC, 0.0, 1.0);
  out.local = c;
  out.bright = p.brightness;
  out.depth = p.depth;
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let r = length(in.local);
  if (r > 1.0) { discard; }
  let a = (1.0 - r) * in.bright;
  let d = in.depth;
  var col = mix(u.background.rgb, u.glow.rgb, clamp(d * 2.0, 0.0, 1.0));
  col = mix(col, u.particle.rgb, clamp((d - 0.5) * 2.0, 0.0, 1.0));
  return vec4<f32>(col * a, a);
}
`;
}
