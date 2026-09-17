// MetalForge — Particle Field (unified WebGPU preview).
//
// Drives the live editor preview for all four styles:
//   0 waveSurface  — tilted disc rolling as a crossed sine swell (baseline)
//   1 sandCloud    — soft churning spherical sand cloud
//   2 pollenField  — loose drifting haze of motes
//   3 ripples      — concentric rings pulsing outward
//
// Browsers can't run Metal and WebGPU has no sized point primitives, so this
// preview is hand-ported from the per-style standalone `.metal` files and
// drawn as additive-blended instanced quads (6 verts × N instances). The
// runner appends the vs_main / fs_main wrapper around `mfParticle`. The math
// here mirrors the MSL exactly (noiseScale is fixed at 1.0 for every sacred
// style; the per-style time multiplier is baked in below). `u.style` is the
// 0-based select index (0..3), NOT the original sacred slot numbers.

struct U {
  size:       vec2<f32>,
  time:       f32,
  rotation:   f32,
  spin:       f32,
  radius:     f32,
  strength:   f32,
  decay:      f32,
  turbulence: f32,
  pointSize:  f32,
  style:      f32,
  background: vec4<f32>,
  glow:       vec4<f32>,
  particle:   vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: U;

// Pointer/touch trail, newest at index 0, as vec4(ndcX, ndcY, age, _).
// The runner fills active slots from index 0 and parks unused slots at age 99,
// so the repulsion loop below can `break` on the first dead slot — making it
// free when idle and O(active touches) while dragging, exactly like the MSL
// loop bounded by `touchCount`.
@group(0) @binding(1) var<uniform> mfTouches: array<vec4<f32>, 64>;

// ─── Hashing + 3D value noise (ports of the MSL helpers) ──────────────────
fn hash11(n0: u32) -> f32 {
  var n = n0;
  n = (n ^ 61u) ^ (n >> 16u);
  n = n * 9u;
  n = n ^ (n >> 4u);
  n = n * 0x27d4eb2du;
  n = n ^ (n >> 15u);
  return f32(n & 0x00ffffffu) / f32(0x01000000u);
}

fn h3(p0: vec3<f32>) -> f32 {
  var p = fract(p0 * vec3<f32>(0.1031, 0.1030, 0.0973));
  p = p + vec3<f32>(dot(p, p.yxz + vec3<f32>(33.33)));
  return fract((p.x + p.y) * p.z);
}

fn vnoise3(x: vec3<f32>) -> f32 {
  let i = floor(x);
  let f = fract(x);
  let uu = f * f * (vec3<f32>(3.0) - 2.0 * f);
  let n000 = h3(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = h3(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = h3(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = h3(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = h3(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = h3(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = h3(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = h3(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, uu.x);
  let nx10 = mix(n010, n110, uu.x);
  let nx01 = mix(n001, n101, uu.x);
  let nx11 = mix(n011, n111, uu.x);
  let nxy0 = mix(nx00, nx10, uu.y);
  let nxy1 = mix(nx01, nx11, uu.y);
  return mix(nxy0, nxy1, uu.z);
}

fn fbm3(p0: vec3<f32>) -> f32 {
  var p = p0;
  var a = 0.5;
  var v = 0.0;
  for (var i = 0; i < 4; i = i + 1) {
    v = v + a * vnoise3(p);
    p = p * 2.02;
    a = a * 0.5;
  }
  return v;
}

// ─── Per-style shape (body space, scaled later by u.radius) ───────────────
fn shapeForStyle(style: i32, r1: f32, r2: f32, r3: f32, t: f32, dir: vec3<f32>) -> vec3<f32> {
  if (style == 1) {
    // Sand Cloud
    let rr = pow(r3, 0.45);
    let disp = fbm3(dir * 2.5 + vec3<f32>(0.0, 0.0, t * 0.35) + vec3<f32>(7.13));
    return dir * (rr * (0.70 + 0.55 * disp));
  } else if (style == 2) {
    // Pollen Field
    let rr = pow(r3, 0.20);
    let disp = fbm3(dir + vec3<f32>(t * 0.10));
    return dir * (rr * (0.30 + 1.40 * disp)) * 1.40;
  } else if (style == 3) {
    // Ripples
    let ang = r1 * 6.2831853;
    let radSeed = pow(r3, 0.5);
    let band = fract(radSeed * 5.0 - t * 0.7);
    let ringStrength = exp(-pow((band - 0.5) * 2.5, 2.0));
    let rad = radSeed * (1.0 + 0.10 * ringStrength);
    let yy = (r2 - 0.5) * 0.06 + ringStrength * 0.08;
    let jx = (fbm3(vec3<f32>(rad * 3.0, ang, t * 0.2)) - 0.5) * 0.04;
    return vec3<f32>(rad * cos(ang) + jx, yy, rad * sin(ang));
  }
  // Wave Surface (style 0, baseline)
  let radd = sqrt(r3);
  let ang = r1 * 6.2831853;
  let x = radd * cos(ang);
  let uu = radd * sin(ang);
  let h = sin(x * 4.5 + t * 1.6) * 0.14
        + cos(uu * 3.8 + t * 1.3) * 0.10
        + (r2 - 0.5) * 0.04;
  let tilt = 0.7;
  let ct = cos(tilt);
  let st = sin(tilt);
  return vec3<f32>(x, h * ct - uu * st, h * st + uu * ct);
}

// What the vertex wrapper needs per particle.
struct Particle {
  center:     vec2<f32>,  // NDC center of the point sprite
  halfNDC:    vec2<f32>,  // half-extent of the quad in NDC (round in px space)
  brightness: f32,
  depth:      f32,
};

fn mfParticle(i: u32) -> Particle {
  let r1 = hash11(i * 3u + 11u);
  let r2 = hash11(i * 3u + 23u);
  let r3 = hash11(i * 3u + 37u);

  let theta = r1 * 6.2831853;
  let cosPhi = 2.0 * r2 - 1.0;
  let sinPhi = sqrt(max(0.0, 1.0 - cosPhi * cosPhi));
  let dir = vec3<f32>(sinPhi * cos(theta), sinPhi * sin(theta), cosPhi);

  let style = i32(u.style + 0.5);
  var ts = 1.1;                       // Wave Surface (style 0, baseline)
  if (style == 1) { ts = 1.0; }       // Sand Cloud
  else if (style == 2) { ts = 0.6; }  // Pollen Field
  else if (style == 3) { ts = 0.9; }  // Ripples
  let t = u.time * ts;

  let pn = shapeForStyle(style, r1, r2, r3, t, dir);
  var p = pn * u.radius;

  // Internal wave displacement.
  let wavep = pn * 4.0 + vec3<f32>(t * 0.5, t * 0.4, t * 0.3);
  let wave = vec3<f32>(fbm3(wavep + vec3<f32>(1.7)),
                       fbm3(wavep + vec3<f32>(9.2)),
                       fbm3(wavep + vec3<f32>(17.4))) - vec3<f32>(0.5);
  p = p + wave * (u.radius * 0.18 * u.turbulence);

  let rad = max(u.radius, 0.0001);
  let depth = clamp((p.z / rad) * 0.5 + 0.5, 0.0, 1.0);

  var density = fbm3(p * (3.0 / rad) + vec3<f32>(-t * 0.45, t * 0.25, t * 0.55));
  density = smoothstep(0.15, 0.70, density);

  let distFromCenter = length(p) / rad;
  let falloff = exp(-u.decay * 0.6 * distFromCenter);

  // Rotate around the Y axis. `spin` adds continuous rotation over time on top
  // of the static `rotation` angle.
  let ang = u.rotation + u.spin * t;
  let c = cos(ang);
  let s = sin(ang);
  let rx = p.x * c + p.z * s;
  let rz = -p.x * s + p.z * c;

  let aspect = u.size.x / max(u.size.y, 1.0);

  // Point size in pixels mirrors the Swift renderer:
  //   pointScale = max(1.0, 1.5 * drawableHeight / 1200)
  //   pointSize  = pointScale * (0.65 + 0.55 * depth)
  // A quad of full width `pointSize` px → halfNDC = pointSize / size.
  let pointScale = max(1.0, 1.5 * (u.size.y / 1200.0));
  let pointSize = pointScale * u.pointSize * (0.65 + 0.55 * depth);

  // Project to NDC, then apply pointer repulsion in screen space — a direct
  // port of the MSL touch loop. Particles near a recent pointer sample get
  // pushed away along a noisy, organic falloff that fades with the trail's age
  // (ageW) and with distance (falloffT). Dead slots (age >= 90) end the loop.
  var center = vec2<f32>(rx / aspect, p.y);
  for (var i = 0; i < 64; i = i + 1) {
    let tp = mfTouches[i];
    if (tp.z >= 90.0) { break; }
    let d = center - tp.xy;
    let dist = length(d);
    let sigma = 0.08;
    let ageW = exp(-tp.z * 1.6);
    let falloffT = exp(-(dist * dist) / (sigma * sigma));
    let noiseSamp = vec3<f32>(center.x * 7.0, center.y * 7.0, u.time * 0.4 + f32(i));
    let shapeNoise = fbm3(noiseSamp);
    let push = 0.02 * ageW * falloffT * (0.25 + 1.5 * shapeNoise);
    var dir2 = vec2<f32>(1.0, 0.0);
    if (dist > 1e-5) { dir2 = d / dist; }
    center = center + dir2 * push;
  }

  var out: Particle;
  out.center = center;
  out.halfNDC = vec2<f32>(pointSize / max(u.size.x, 1.0), pointSize / max(u.size.y, 1.0));
  out.brightness = falloff * (0.35 + 0.85 * density) * u.strength * 0.7 * (0.40 + 0.60 * depth);
  out.depth = depth;
  return out;
}
