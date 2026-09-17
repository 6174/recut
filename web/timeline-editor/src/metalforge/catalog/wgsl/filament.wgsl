// Filament — multi-pass WGSL for the live WebGPU preview.
//
// Pass-for-pass port of filament.metal (the exported MSL). This file is NOT run
// through the generic single-pass preview runner: kind:"sim" forks in
// lib/preview/runner.ts to effects/_sim/engine.ts, which builds one pipeline per
// entry point below and ping-pongs offscreen textures exactly like the Metal
// renderer. Keep every function here mathematically identical to its
// filament.metal counterpart.
//
// Only the entry points this effect's SimSpec switches on are declared: the
// solver runs with the dye field off (`usesDye: false`), so there is no dye
// splat and no dye advection; there is no wind pass and no agent kernel. The
// engine would never encode them, and layout:"auto" would still have to compile
// them.
//
// Binding contract (see the block above PASSES in effects/_sim/engine.ts):
//   @binding(0) sampler (linear, clamp-to-edge)
//   @binding(1) tex0 — first input texture
//   @binding(2) tex1 — second input texture (only some passes)
//   @binding(3) U    — per-pass uniforms (one SimU layout for all passes)

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

// Full-screen triangle. WebGPU shares Metal's top-left framebuffer origin and
// top-left texture origin, so the same uv.y flip keeps write/read coordinates
// self-consistent across passes (see the filament.metal vertex comment).
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

// One uniform layout shared by every full-screen pass; each reads the fields it
// needs. Mirrors the per-pass `constant` buffers of filament.metal:
//   splat:      point, color(rgb), s0=radius, s1=aspectRatio
//   curl:       texel
//   vorticity:  texel, s0=curlStrength, s1=dt
//   divergence: texel
//   clear:      s0=value        (pressure decay AND the trail fade)
//   pressure:   texel
//   gradient:   texel
//   advection:  texel, s0=dt, s1=dissipation
//   prefilter:  color=curve(xyz), s0=threshold
//   blur:       texel
//   bloomFinal: texel, s0=intensity
//   display:    s0=exposure, s1=vignette, s4=bloomEnabled, s6=aspect
struct SimU {
  point: vec2<f32>,
  texel: vec2<f32>,
  color: vec4<f32>,
  s0: f32,
  s1: f32,
  s2: f32,
  s3: f32,
  s4: f32,
  s5: f32,
  s6: f32,
  s7: f32,
};

@group(0) @binding(0) var smp: sampler;
@group(0) @binding(1) var tex0: texture_2d<f32>;
@group(0) @binding(2) var tex1: texture_2d<f32>;
@group(0) @binding(3) var<uniform> U: SimU;

// Hashes without trig, so a fast-math build cannot distort them (Dave Hoskins).

fn hash11(p0: f32) -> f32 {
  var p = fract(p0 * 0.1031);
  p = p * (p + 33.33);
  p = p * (p + p);
  return fract(p);
}

fn hash21(p: f32) -> vec2<f32> {
  var p3 = fract(vec3<f32>(p) * vec3<f32>(0.1031, 0.1030, 0.0973));
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// MARK: Splat — tex0 = velocity

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
  let L = textureSample(tex0, smp, uv - vec2<f32>(U.texel.x, 0.0)).y;
  let R = textureSample(tex0, smp, uv + vec2<f32>(U.texel.x, 0.0)).y;
  let T = textureSample(tex0, smp, uv + vec2<f32>(0.0, U.texel.y)).x;
  let B = textureSample(tex0, smp, uv - vec2<f32>(0.0, U.texel.y)).x;
  let vorticity = R - L - T + B;
  return vec4<f32>(0.5 * vorticity, 0.0, 0.0, 1.0);
}

// MARK: Vorticity confinement — tex0 = velocity, tex1 = curl

@fragment
fn vorticity_fragment(in: VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let L = textureSample(tex1, smp, uv - vec2<f32>(U.texel.x, 0.0)).x;
  let R = textureSample(tex1, smp, uv + vec2<f32>(U.texel.x, 0.0)).x;
  let T = textureSample(tex1, smp, uv + vec2<f32>(0.0, U.texel.y)).x;
  let B = textureSample(tex1, smp, uv - vec2<f32>(0.0, U.texel.y)).x;
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
  let vL = uv - vec2<f32>(U.texel.x, 0.0);
  let vR = uv + vec2<f32>(U.texel.x, 0.0);
  let vT = uv + vec2<f32>(0.0, U.texel.y);
  let vB = uv - vec2<f32>(0.0, U.texel.y);

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

// MARK: Clear — tex0 = pressure (decay) or trail (feedback fade); s0 = value

@fragment
fn clear_fragment(in: VSOut) -> @location(0) vec4<f32> {
  return U.s0 * textureSample(tex0, smp, in.uv);
}

// MARK: Pressure (single Jacobi iteration) — tex0 = pressure, tex1 = divergence

@fragment
fn pressure_fragment(in: VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let L = textureSample(tex0, smp, uv - vec2<f32>(U.texel.x, 0.0)).x;
  let R = textureSample(tex0, smp, uv + vec2<f32>(U.texel.x, 0.0)).x;
  let T = textureSample(tex0, smp, uv + vec2<f32>(0.0, U.texel.y)).x;
  let B = textureSample(tex0, smp, uv - vec2<f32>(0.0, U.texel.y)).x;
  let divergence = textureSample(tex1, smp, uv).x;
  let pressure = (L + R + B + T - divergence) * 0.25;
  return vec4<f32>(pressure, 0.0, 0.0, 1.0);
}

// MARK: Gradient subtraction — tex0 = pressure, tex1 = velocity

@fragment
fn gradient_fragment(in: VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let L = textureSample(tex0, smp, uv - vec2<f32>(U.texel.x, 0.0)).x;
  let R = textureSample(tex0, smp, uv + vec2<f32>(U.texel.x, 0.0)).x;
  let T = textureSample(tex0, smp, uv + vec2<f32>(0.0, U.texel.y)).x;
  let B = textureSample(tex0, smp, uv - vec2<f32>(0.0, U.texel.y)).x;
  var velocity = textureSample(tex1, smp, uv).xy;
  velocity = velocity - vec2<f32>(R - L, T - B);
  return vec4<f32>(velocity, 0.0, 1.0);
}

// MARK: Advection (semi-Lagrangian) — tex0 = velocity, tex1 = source

@fragment
fn advection_fragment(in: VSOut) -> @location(0) vec4<f32> {
  let coord = in.uv - U.s0 * textureSample(tex0, smp, in.uv).xy * U.texel;
  let result = textureSample(tex1, smp, coord);
  let decay = 1.0 + U.s1 * U.s0;
  return result / decay;
}

// MARK: Bloom prefilter — tex0 = trail; color = curve, s0 = threshold

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
  sum = sum + textureSample(tex0, smp, in.uv - vec2<f32>(U.texel.x, 0.0));
  sum = sum + textureSample(tex0, smp, in.uv + vec2<f32>(U.texel.x, 0.0));
  sum = sum + textureSample(tex0, smp, in.uv + vec2<f32>(0.0, U.texel.y));
  sum = sum + textureSample(tex0, smp, in.uv - vec2<f32>(0.0, U.texel.y));
  sum = sum * 0.25;
  return sum;
}

// MARK: Bloom final — tex0 = last chain level; s0 = intensity

@fragment
fn bloom_final_fragment(in: VSOut) -> @location(0) vec4<f32> {
  var sum = vec4<f32>(0.0);
  sum = sum + textureSample(tex0, smp, in.uv - vec2<f32>(U.texel.x, 0.0));
  sum = sum + textureSample(tex0, smp, in.uv + vec2<f32>(U.texel.x, 0.0));
  sum = sum + textureSample(tex0, smp, in.uv + vec2<f32>(0.0, U.texel.y));
  sum = sum + textureSample(tex0, smp, in.uv - vec2<f32>(0.0, U.texel.y));
  sum = sum * 0.25;
  return sum * U.s0;
}

// MARK: Particle update (compute) — the tracers the filaments are made of
//
// Particles are dynamic bodies, not pure tracers. With drag high enough that
// `blend` saturates at 1 they match the fluid exactly, which is what Filament
// runs; a low drag and some gravity would make them lag the flow and arc.
//
// textureSample is illegal in a compute shader — textureSampleLevel is the
// explicit-LOD form that replaces it.

struct Particle {
  pos: vec2<f32>,   // uv
  vel: vec2<f32>,   // own velocity, in the same units as the fluid
  life: f32,        // 1 → 0, then respawns
  seed: f32,
};

struct ParticleU {
  texel: vec2<f32>,
  dt: f32,
  speed: f32,
  fade: f32,
  time: f32,
  drag: f32,        // how hard the fluid drags a particle toward its own velocity
  gravity: f32,     // +y is down
  spawnMode: f32,   // 0 = anywhere, 1 = along the floor
  launch: f32,      // initial upward kick when spawning along the floor
  count: u32,
};

@group(0) @binding(0) var<storage, read_write> parts: array<Particle>;
@group(0) @binding(1) var<uniform> PU: ParticleU;
@group(0) @binding(2) var smpC: sampler;
@group(0) @binding(3) var velTex: texture_2d<f32>;

@compute @workgroup_size(64)
fn particle_update(@builtin(global_invocation_id) gid3: vec3<u32>) {
  let gid = gid3.x;
  // The dispatch rounds up to whole workgroups, so the tail must bail.
  if (gid >= PU.count) { return; }

  var p = parts[gid];
  let texel = PU.texel;
  let fluid = textureSampleLevel(velTex, smpC, p.pos, 0.0).xy;

  let blend = clamp(PU.drag * PU.dt, 0.0, 1.0);
  p.vel = mix(p.vel, fluid, blend);
  p.vel.y = p.vel.y + PU.gravity * PU.dt;
  p.vel = clamp(p.vel, vec2<f32>(-4000.0), vec2<f32>(4000.0));

  p.pos = p.pos + p.vel * PU.dt * texel * PU.speed;
  p.life = p.life - PU.dt * PU.fade;

  let escaped = p.pos.x < -0.02 || p.pos.x > 1.02 || p.pos.y < -0.02 || p.pos.y > 1.02;
  if (p.life <= 0.0 || escaped) {
    let h = hash21(p.seed + PU.time * 13.137);
    if (PU.spawnMode > 0.5) {
      p.pos = vec2<f32>(h.x, 0.94 + h.y * 0.05);
      let side = hash11(p.seed + PU.time * 7.77) - 0.5;
      // Wide spread in launch speed, so a few sparks carry all the way up
      // while most die out low.
      p.vel = vec2<f32>(side * PU.launch * 0.7, -PU.launch * (0.35 + h.y * 1.80));
    } else {
      p.pos = h;
      p.vel = vec2<f32>(0.0);
    }
    p.life = 1.0;
  }
  parts[gid] = p;
}

// MARK: Point sprites — additive deposits into the trail feedback buffer
//
// WebGPU has no sized point primitive, so Metal's [[point_size]] becomes a
// 4-vertex triangle-strip quad instance expanded by RU.halfNDC, and
// `local ∈ [-1,1]²` stands in for [[point_coord]]:
// length(local) == length(point_coord - 0.5) * 2.

struct PointRenderU {
  cool: vec4<f32>,
  hot: vec4<f32>,
  spark: vec4<f32>,
  pointSize: f32,
  brightness: f32,
  speedScale: f32,
  fadeShape: f32,   // 0 = fade in then out, 1 = brightest at birth
  halfNDC: vec2<f32>,
  pad: vec2<f32>,
};

// Read-only here: `read_write` storage is illegal outside a compute stage.
@group(0) @binding(0) var<storage, read> partsRO: array<Particle>;
@group(0) @binding(1) var<uniform> RU: PointRenderU;

struct PointOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) color: vec3<f32>,
};

/// `t` is normalised speed.
fn particleShade(t: f32, life: f32) -> vec3<f32> {
  let c = mix(RU.cool.rgb, RU.hot.rgb, t) + RU.spark.rgb * (t * t * t);

  let l = clamp(life, 0.0, 1.0);
  let alpha = mix(sin(l * 3.14159265), pow(l, 0.7), RU.fadeShape);

  // Gate hard on speed. Particles sitting in slack water stay nearly dark,
  // which is what leaves black space between the filaments.
  let gate = 0.05 + 0.95 * t;

  return c * alpha * gate * RU.brightness;
}

@vertex
fn particle_vertex(@builtin(vertex_index) vi: u32,
                   @builtin(instance_index) ii: u32) -> PointOut {
  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0),
  );
  let corner = corners[vi];
  let p = partsRO[ii];
  let center = vec2<f32>(p.pos.x * 2.0 - 1.0, (1.0 - p.pos.y) * 2.0 - 1.0);

  var o: PointOut;
  o.pos = vec4<f32>(center + corner * RU.halfNDC, 0.0, 1.0);
  o.local = corner;

  // Colour by the particle's own speed. For a pure tracer that equals the
  // fluid speed, which is what makes the fast cores read as hot filaments.
  let t = clamp(length(p.vel) / max(RU.speedScale, 0.0001), 0.0, 1.0);
  o.color = particleShade(t, p.life);
  return o;
}

@fragment
fn particle_fragment(in: PointOut) -> @location(0) vec4<f32> {
  let d = length(in.local);
  let falloff = exp(-d * d * 3.2);
  return vec4<f32>(in.color * falloff, 1.0);
}

// MARK: Display — tex0 = trail, tex1 = bloom
//   s0 = exposure, s1 = vignette, s4 = bloomEnabled, s6 = aspect

@fragment
fn display_filament_fragment(in: VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  var c = textureSample(tex0, smp, uv).rgb;

  // Filmic roll-off keeps the dense vortex cores from clipping to flat white.
  c = vec3<f32>(1.0) - exp(-c * U.s0);

  if (U.s4 > 0.5) {
    c = c + textureSample(tex1, smp, uv).rgb;
  }

  var d = uv - vec2<f32>(0.5);
  d.x = d.x * U.s6;
  c = c * (1.0 - U.s1 * smoothstep(0.25, 0.85, length(d)));

  return vec4<f32>(c, 1.0);
}
