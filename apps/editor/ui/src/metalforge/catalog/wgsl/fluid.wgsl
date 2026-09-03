// Fluid — multi-pass WGSL for the live WebGPU preview.
//
// Pass-for-pass port of fluid.metal (the exported MSL). This file is NOT run
// through the generic single-pass preview runner: kind:"fluid" forks in
// lib/preview/runner.ts to effects/fluid/preview.ts, which builds one render
// pipeline per fragment entry point below and ping-pongs offscreen textures
// exactly like the Metal renderer. Keep every function here mathematically
// identical to its fluid.metal counterpart.
//
// Shared binding contract (see PASSES in preview.ts):
//   @binding(0) sampler (linear, clamp-to-edge)
//   @binding(1) tex0 — first input texture
//   @binding(2) tex1 — second input texture (only some passes)
//   @binding(3) U    — per-pass uniforms (one FluidU layout for all passes)

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

// Full-screen triangle. WebGPU shares Metal's top-left framebuffer origin and
// top-left texture origin, so the same uv.y flip keeps write/read coordinates
// self-consistent across passes (see the fluid.metal vertex comment).
@vertex
fn fullscreen_vertex(@builtin(vertex_index) vid: u32) -> VSOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  var out: VSOut;
  let p = pos[vid];
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.uv = vec2<f32>(p.x * 0.5 + 0.5, 1.0 - (p.y * 0.5 + 0.5));
  return out;
}

// One uniform layout shared by every pass; each pass reads the fields it
// needs. Mirrors the per-pass `constant` buffers of fluid.metal:
//   splat:      point, color(rgb), s0=radius, s1=aspectRatio
//   curl:       texelSize
//   vorticity:  texelSize, s0=curlStrength, s1=dt
//   divergence: texelSize
//   clear:      s0=value
//   pressure:   texelSize
//   gradient:   texelSize
//   advection:  texelSize, s0=dt, s1=dissipation
//   prefilter:  color=curve(xyz), s0=threshold
//   blur:       texelSize
//   bloomFinal: texelSize, s0=intensity
//   display:    texelSize, s0=shading, s1=bloomEnabled
struct FluidU {
  point: vec2<f32>,
  texelSize: vec2<f32>,
  color: vec4<f32>,
  s0: f32,
  s1: f32,
  s2: f32,
  s3: f32,
};

@group(0) @binding(0) var smp: sampler;
@group(0) @binding(1) var tex0: texture_2d<f32>;
@group(0) @binding(2) var tex1: texture_2d<f32>;
@group(0) @binding(3) var<uniform> U: FluidU;

// MARK: Splat — tex0 = target field (velocity or dye)

@fragment
fn splat_fragment(in: VSOut) -> @location(0) vec4<f32> {
  var p = in.uv - U.point;
  p.x = p.x * U.s1;
  let splat = exp(-dot(p, p) / U.s0) * U.color.rgb;
  let base = textureSample(tex0, smp, in.uv).xyz;
  return vec4<f32>(base + splat, 1.0);
}

// MARK: Curl — tex0 = velocity

@fragment
fn curl_fragment(in: VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let L = textureSample(tex0, smp, uv - vec2<f32>(U.texelSize.x, 0.0)).y;
  let R = textureSample(tex0, smp, uv + vec2<f32>(U.texelSize.x, 0.0)).y;
  let T = textureSample(tex0, smp, uv + vec2<f32>(0.0, U.texelSize.y)).x;
  let B = textureSample(tex0, smp, uv - vec2<f32>(0.0, U.texelSize.y)).x;
  let vorticity = R - L - T + B;
  return vec4<f32>(0.5 * vorticity, 0.0, 0.0, 1.0);
}

// MARK: Vorticity confinement — tex0 = velocity, tex1 = curl

@fragment
fn vorticity_fragment(in: VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let L = textureSample(tex1, smp, uv - vec2<f32>(U.texelSize.x, 0.0)).x;
  let R = textureSample(tex1, smp, uv + vec2<f32>(U.texelSize.x, 0.0)).x;
  let T = textureSample(tex1, smp, uv + vec2<f32>(0.0, U.texelSize.y)).x;
  let B = textureSample(tex1, smp, uv - vec2<f32>(0.0, U.texelSize.y)).x;
  let C = textureSample(tex1, smp, uv).x;

  var force = 0.5 * vec2<f32>(abs(T) - abs(B), abs(R) - abs(L));
  force = force / (length(force) + 0.0001);
  force = force * (U.s0 * C);
  force.y = force.y * -1.0;

  var velocity = textureSample(tex0, smp, uv).xy;
  velocity = velocity + force * U.s1;
  velocity = clamp(velocity, vec2<f32>(-1000.0), vec2<f32>(1000.0));
  return vec4<f32>(velocity, 0.0, 1.0);
}

// MARK: Divergence — tex0 = velocity

@fragment
fn divergence_fragment(in: VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let vL = uv - vec2<f32>(U.texelSize.x, 0.0);
  let vR = uv + vec2<f32>(U.texelSize.x, 0.0);
  let vT = uv + vec2<f32>(0.0, U.texelSize.y);
  let vB = uv - vec2<f32>(0.0, U.texelSize.y);

  var L = textureSample(tex0, smp, vL).x;
  var R = textureSample(tex0, smp, vR).x;
  var T = textureSample(tex0, smp, vT).y;
  var B = textureSample(tex0, smp, vB).y;
  let C = textureSample(tex0, smp, uv).xy;

  // Reflective free-slip boundaries.
  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }

  let div = 0.5 * (R - L + T - B);
  return vec4<f32>(div, 0.0, 0.0, 1.0);
}

// MARK: Clear (pressure decay) — tex0 = pressure

@fragment
fn clear_fragment(in: VSOut) -> @location(0) vec4<f32> {
  return U.s0 * textureSample(tex0, smp, in.uv);
}

// MARK: Pressure (single Jacobi iteration) — tex0 = pressure, tex1 = divergence

@fragment
fn pressure_fragment(in: VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let L = textureSample(tex0, smp, uv - vec2<f32>(U.texelSize.x, 0.0)).x;
  let R = textureSample(tex0, smp, uv + vec2<f32>(U.texelSize.x, 0.0)).x;
  let T = textureSample(tex0, smp, uv + vec2<f32>(0.0, U.texelSize.y)).x;
  let B = textureSample(tex0, smp, uv - vec2<f32>(0.0, U.texelSize.y)).x;
  let divergence = textureSample(tex1, smp, uv).x;
  let pressure = (L + R + B + T - divergence) * 0.25;
  return vec4<f32>(pressure, 0.0, 0.0, 1.0);
}

// MARK: Gradient subtraction — tex0 = pressure, tex1 = velocity

@fragment
fn gradient_fragment(in: VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let L = textureSample(tex0, smp, uv - vec2<f32>(U.texelSize.x, 0.0)).x;
  let R = textureSample(tex0, smp, uv + vec2<f32>(U.texelSize.x, 0.0)).x;
  let T = textureSample(tex0, smp, uv + vec2<f32>(0.0, U.texelSize.y)).x;
  let B = textureSample(tex0, smp, uv - vec2<f32>(0.0, U.texelSize.y)).x;
  var velocity = textureSample(tex1, smp, uv).xy;
  velocity = velocity - vec2<f32>(R - L, T - B);
  return vec4<f32>(velocity, 0.0, 1.0);
}

// MARK: Advection (semi-Lagrangian) — tex0 = velocity, tex1 = source

@fragment
fn advection_fragment(in: VSOut) -> @location(0) vec4<f32> {
  let coord = in.uv - U.s0 * textureSample(tex0, smp, in.uv).xy * U.texelSize;
  let result = textureSample(tex1, smp, coord);
  let decay = 1.0 + U.s1 * U.s0;
  return result / decay;
}

// MARK: Bloom prefilter — tex0 = dye; color = curve, s0 = threshold

@fragment
fn bloom_prefilter_fragment(in: VSOut) -> @location(0) vec4<f32> {
  var c = textureSample(tex0, smp, in.uv).rgb;
  let br = max(c.r, max(c.g, c.b));
  var rq = clamp(br - U.color.x, 0.0, U.color.y);
  rq = U.color.z * rq * rq;
  c = c * (max(rq, br - U.s0) / max(br, 0.0001));
  return vec4<f32>(c, 1.0);
}

// MARK: Bloom blur (down/upsample tap) — tex0 = source level

@fragment
fn bloom_blur_fragment(in: VSOut) -> @location(0) vec4<f32> {
  var sum = vec4<f32>(0.0);
  sum = sum + textureSample(tex0, smp, in.uv - vec2<f32>(U.texelSize.x, 0.0));
  sum = sum + textureSample(tex0, smp, in.uv + vec2<f32>(U.texelSize.x, 0.0));
  sum = sum + textureSample(tex0, smp, in.uv + vec2<f32>(0.0, U.texelSize.y));
  sum = sum + textureSample(tex0, smp, in.uv - vec2<f32>(0.0, U.texelSize.y));
  sum = sum * 0.25;
  return sum;
}

// MARK: Bloom final — tex0 = last chain level; s0 = intensity

@fragment
fn bloom_final_fragment(in: VSOut) -> @location(0) vec4<f32> {
  var sum = vec4<f32>(0.0);
  sum = sum + textureSample(tex0, smp, in.uv - vec2<f32>(U.texelSize.x, 0.0));
  sum = sum + textureSample(tex0, smp, in.uv + vec2<f32>(U.texelSize.x, 0.0));
  sum = sum + textureSample(tex0, smp, in.uv + vec2<f32>(0.0, U.texelSize.y));
  sum = sum + textureSample(tex0, smp, in.uv - vec2<f32>(0.0, U.texelSize.y));
  sum = sum * 0.25;
  return sum * U.s0;
}

// MARK: Display — tex0 = dye, tex1 = bloom; s0 = shading, s1 = bloomEnabled

@fragment
fn display_fragment(in: VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  var c = textureSample(tex0, smp, uv).rgb;

  // Neighbour taps are sampled unconditionally (textureSample must stay in
  // uniform control flow is satisfied either way — the branch below is
  // uniform — but hoisting keeps the structure simple and matches cost).
  if (U.s0 > 0.5) {
    let lc = textureSample(tex0, smp, uv - vec2<f32>(U.texelSize.x, 0.0)).rgb;
    let rc = textureSample(tex0, smp, uv + vec2<f32>(U.texelSize.x, 0.0)).rgb;
    let tc = textureSample(tex0, smp, uv + vec2<f32>(0.0, U.texelSize.y)).rgb;
    let bc = textureSample(tex0, smp, uv - vec2<f32>(0.0, U.texelSize.y)).rgb;

    let dx = length(rc) - length(lc);
    let dy = length(tc) - length(bc);

    let n = normalize(vec3<f32>(dx, dy, length(U.texelSize)));
    let l = vec3<f32>(0.0, 0.0, 1.0);
    let diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
    c = c * diffuse;
  }

  if (U.s1 > 0.5) {
    let bloom = textureSample(tex1, smp, uv).rgb;
    c = c + bloom;
  }

  return vec4<f32>(c, 1.0);
}
