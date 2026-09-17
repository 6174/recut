// Mycelium — multi-pass WGSL for the live WebGPU preview.
//
// Pass-for-pass port of mycelium.metal (the exported MSL). This file is NOT run
// through the generic single-pass preview runner: kind:"sim" forks in
// lib/preview/runner.ts to effects/_sim/engine.ts, which builds one pipeline per
// entry point below and ping-pongs offscreen textures exactly like the Metal
// renderer. Keep every function here mathematically identical to its
// mycelium.metal counterpart.
//
// Only the entries this effect's SimSpec switches on are declared — there is no
// dye field, no wind, no tracer kernel, so no splat_dye, wind_fragment or
// particle_vertex. The binding contract is documented above PASSES in
// effects/_sim/engine.ts.

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

// Full-screen triangle. WebGPU shares Metal's top-left framebuffer origin and
// top-left texture origin, so the same uv.y flip keeps write/read coordinates
// self-consistent across passes.
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
// needs. Mirrors the per-pass `constant` buffers of mycelium.metal:
//   splat        point, color.rgb, s0 = radius, s1 = aspectRatio
//   curl         texel
//   vorticity    texel, s0 = curlStrength, s1 = dt          (tex1 = curl)
//   divergence   texel
//   clear        s0 = value
//   pressure     texel                                (tex1 = divergence)
//   gradient     texel                                 (tex1 = velocity)
//   advection    texel, s0 = dt, s1 = dissipation        (tex1 = source)
//   trail_decay  texel (the TRAIL texel), s0 = keep, s1 = diffuse
//   prefilter    color = curve.xyz, s0 = threshold
//   blur/final   texel, s0 = intensity (final only)
//   display      s0 = exposure, s4 = bloomEnabled, s6 = aspect, s7 = reveal
struct SimU {
  point: vec2<f32>,
  texel: vec2<f32>,
  color: vec4<f32>,
  s0: f32, s1: f32, s2: f32, s3: f32,
  s4: f32, s5: f32, s6: f32, s7: f32,
  colorB: vec4<f32>,
  colorC: vec4<f32>,
  colorD: vec4<f32>,
};

@group(0) @binding(0) var smp: sampler;
@group(0) @binding(1) var tex0: texture_2d<f32>;
@group(0) @binding(2) var tex1: texture_2d<f32>;
@group(0) @binding(3) var<uniform> U: SimU;

// MARK: Solver — tex0 = the field being written from

@fragment
fn splat_fragment(in: VSOut) -> @location(0) vec4<f32> {
  var p = in.uv - U.point;
  p.x = p.x * U.s1;
  let splat = exp(-dot(p, p) / U.s0) * U.color.rgb;
  let base = textureSample(tex0, smp, in.uv).xyz;
  return vec4<f32>(base + splat, 1.0);
}

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

@fragment
fn clear_fragment(in: VSOut) -> @location(0) vec4<f32> {
  return U.s0 * textureSample(tex0, smp, in.uv);
}

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

@fragment
fn advection_fragment(in: VSOut) -> @location(0) vec4<f32> {
  let coord = in.uv - U.s0 * textureSample(tex0, smp, in.uv).xy * U.texel;
  let result = textureSample(tex1, smp, coord);
  let decay = 1.0 + U.s1 * U.s0;
  return result / decay;
}

// MARK: Trail — blur and decay in one pass
//
// Diffusion is what lets a trail attract agents that never touched it, and decay
// is what stops the whole plane saturating. Note the texel here is the TRAIL
// texel, not the sim texel — the fields are 96-based and the trail is 700-based,
// and blurring over seven trail texels turns the network into fog.

@fragment
fn trail_decay_fragment(in: VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let c = textureSample(tex0, smp, uv);
  let blurred = 0.25 * (textureSample(tex0, smp, uv - vec2<f32>(U.texel.x, 0.0))
                      + textureSample(tex0, smp, uv + vec2<f32>(U.texel.x, 0.0))
                      + textureSample(tex0, smp, uv + vec2<f32>(0.0, U.texel.y))
                      + textureSample(tex0, smp, uv - vec2<f32>(0.0, U.texel.y)));
  return mix(c, blurred, clamp(U.s1, 0.0, 1.0)) * U.s0;
}

// MARK: Bloom

@fragment
fn bloom_prefilter_fragment(in: VSOut) -> @location(0) vec4<f32> {
  var c = textureSample(tex0, smp, in.uv).rgb;
  let br = max(c.r, max(c.g, c.b));
  var rq = clamp(br - U.color.x, 0.0, U.color.y);
  rq = U.color.z * rq * rq;
  c = c * (max(rq, br - U.s0) / max(br, 0.0001));
  return vec4<f32>(c, 1.0);
}

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

// MARK: Display — tex0 = trail, tex1 = bloom
//
// s0 = exposure, s4 = bloomEnabled, s6 = aspect, s7 = reveal.
//
// Spore-print palette: cold substrate, warm hyphae, incandescent nodes. The
// density is the trail's brightest channel and the tint is what is left of it
// once that brightness is divided out — for the white deposit the source uses
// those are `.r` and (1,1,1), which is the source shader exactly; for a tinted
// deposit the ramp keeps its shape and takes the network's own colour.

@fragment
fn display_mycelium_fragment(in: VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let field = textureSample(tex0, smp, uv).rgb;
  let mass = max(field.r, max(field.g, field.b));
  let d = mass * U.s0;
  let tint = field / max(mass, 0.0001);

  var c = U.color.rgb;
  c = mix(c, U.colorB.rgb * tint, smoothstep(0.02, 0.30, d));
  c = mix(c, U.colorC.rgb * tint, smoothstep(0.26, 0.70, d));
  c = mix(c, U.colorD.rgb * tint, smoothstep(0.68, 1.10, d));

  if (U.s4 > 0.5) {
    c = c + textureSample(tex1, smp, uv).rgb;
  }

  // The network really did grow outward from the middle, so the reveal replays
  // that: a front sweeps out from the centre with a brighter band riding its
  // edge, and the band only lights where there is hypha to light. Applied after
  // bloom so the glow is masked too.
  if (U.s7 < 1.0) {
    var rd = uv - 0.5;
    rd.x = rd.x * U.s6;
    let radius = length(rd) / 0.60;
    let front = U.s7 * 1.45;

    // The source writes this as a reversed smoothstep; written forward it is the
    // same curve (s(t) + s(1-t) == 1) and stays inside WGSL's low < high rule.
    c = c * (1.0 - smoothstep(front - 0.30, front, radius));

    // exp(-q*q) rather than exp(-pow(q, 2.0)): `q` goes negative inside the
    // front, and pow() is undefined for a negative base in both languages.
    let q = (radius - front) * 9.0;
    let band = exp(-q * q);
    c = c + vec3<f32>(1.00, 0.64, 0.32) * tint * band * smoothstep(0.015, 0.30, d) * 1.1;
  }

  return vec4<f32>(c, 1.0);
}

// MARK: Agents
//
// 240k stigmergic agents. Each smells the trail ahead-left, ahead and
// ahead-right, turns toward the strongest and deposits more trail; nothing draws
// the network, it is what the agents agree on. `vel.x` carries the heading and
// `vel.y` is unused — the same 24-byte Particle the tracer kernels use, so the
// buffer layout is one thing across the whole engine.

struct Particle {
  pos: vec2<f32>,
  vel: vec2<f32>,
  life: f32,
  seed: f32,
};

// Hashing without trig, so fast-math can't distort it (Dave Hoskins).
fn hash11(p0: f32) -> f32 {
  var p = fract(p0 * 0.1031);
  p = p * (p + 33.33);
  p = p * (p + p);
  return fract(p);
}

struct AgentU {
  dt: f32, time: f32, stepX: f32, stepY: f32,
  sensorX: f32, sensorY: f32, sensorAngle: f32, turn: f32,
  flow: f32, count: u32,
};

@group(0) @binding(0) var<storage, read_write> agents: array<Particle>;
@group(0) @binding(1) var<uniform> AU: AgentU;
@group(0) @binding(2) var smpA: sampler;
@group(0) @binding(3) var trailTex: texture_2d<f32>;
@group(0) @binding(4) var velTex: texture_2d<f32>;

fn senseTrail(pos: vec2<f32>, angle: f32, sensor: vec2<f32>) -> f32 {
  let at = pos + vec2<f32>(cos(angle), sin(angle)) * sensor;
  return dot(textureSampleLevel(trailTex, smpA, fract(at), 0.0).rgb, vec3<f32>(0.333));
}

@compute @workgroup_size(64)
fn agent_update(@builtin(global_invocation_id) gid3: vec3<u32>) {
  let gid = gid3.x;
  if (gid >= AU.count) { return; }

  var a = agents[gid];
  var angle = a.vel.x;
  let sensor = vec2<f32>(AU.sensorX, AU.sensorY);

  let ahead = senseTrail(a.pos, angle, sensor);
  let left = senseTrail(a.pos, angle - AU.sensorAngle, sensor);
  let right = senseTrail(a.pos, angle + AU.sensorAngle, sensor);

  let turn = AU.turn * AU.dt;
  if (ahead > left && ahead > right) {
    // keep going
  } else if (ahead < left && ahead < right) {
    angle = angle + select(turn, -turn, hash11(a.seed + AU.time * 37.1) < 0.5);
  } else if (right > left) {
    angle = angle + turn;
  } else if (left > right) {
    angle = angle - turn;
  }

  // The fluid does not carry the agents — it only leans on them, so a drag bends
  // the network instead of blowing it apart.
  let flow = textureSampleLevel(velTex, smpA, a.pos, 0.0).xy;
  if (length(flow) > 1.0) {
    angle = angle + (atan2(flow.y, flow.x) - angle) * clamp(AU.flow * AU.dt, 0.0, 1.0);
  }

  a.pos = fract(a.pos + vec2<f32>(cos(angle), sin(angle)) * vec2<f32>(AU.stepX, AU.stepY));
  a.vel.x = angle;
  agents[gid] = a;
}

// MARK: Deposit
//
// WebGPU has no sized point primitive, so Metal's `[[point_size]]` sprite is a
// 4-vertex triangle-strip quad instance expanded by RU.halfNDC, and
// `local ∈ [-1,1]²` stands in for `[[point_coord]]`
// (length(local) == length(point_coord - 0.5) * 2).

struct PointRenderU {
  cool: vec4<f32>,
  hot: vec4<f32>,
  spark: vec4<f32>,
  pointSize: f32, brightness: f32, speedScale: f32, fadeShape: f32,
  halfNDC: vec2<f32>,
  pad: vec2<f32>,
};

@group(0) @binding(0) var<storage, read> partsRO: array<Particle>;
@group(0) @binding(1) var<uniform> RU: PointRenderU;

struct PointOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) color: vec3<f32>,
};

// Agents deposit a flat amount, unlike a tracer's speed-graded particle.
@vertex
fn deposit_vertex(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PointOut {
  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0,  1.0),
  );
  let c = corners[vi];
  let a = partsRO[ii];
  let center = vec2<f32>(a.pos.x * 2.0 - 1.0, (1.0 - a.pos.y) * 2.0 - 1.0);

  var o: PointOut;
  o.pos = vec4<f32>(center + c * RU.halfNDC, 0.0, 1.0);
  o.local = c;
  o.color = RU.hot.rgb * RU.brightness;
  return o;
}

@fragment
fn particle_fragment(in: PointOut) -> @location(0) vec4<f32> {
  let d = length(in.local);
  let falloff = exp(-d * d * 3.2);
  return vec4<f32>(in.color * falloff, 1.0);
}
