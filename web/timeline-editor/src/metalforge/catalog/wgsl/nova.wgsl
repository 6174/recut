// Nova — unified WebGPU preview. Six raymarched plasma-star styles selected by
// u.style (0-based option index). Every style is a volumetric raymarch of a
// breathing, boiling plasma SPHERE: ~90 steps, a pulsing shell
// abs(length(p) - radius - boil), inverse-step (cos+1)/d emissive accumulation,
// a hot central core, an outward corona, and a tanh bloom tonemap. They differ
// only by colour, breathing rhythm and surface motion. Hand-ported to stay
// mathematically equivalent to the per-style nova-<style>.metal exports.
//
// Colour model: each weighted style paints three zones — the cosine-banded
// SURFACE (weight x2 gain), the hot CORE (x2 gain), and the HALO, a corona glow
// screen-blended over the tonemapped star and gated out of the bright core so it
// reads as a visible coloured atmosphere (black halo = no glow). Aurora is a
// spectrum: its colours flow through a 3-stop gradient of (surface, core, halo).
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic uniform
// packer lines up. The five colours (vec4 align 16) start at offset 48 after an
// 8-byte pad following saturation (saturation ends at byte 40, aligns up to 48).
struct Uniforms {
  size:         vec2<f32>,
  time:         f32,
  style:        f32,
  speed:        f32,
  scale:        f32,
  turbulence:   f32,
  brightness:   f32,
  contrast:     f32,
  saturation:   f32,
  surfaceColor: vec4<f32>,
  coreColor:    vec4<f32>,
  haloColor:    vec4<f32>,
  tint:         vec4<f32>,
  background:   vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

// ----------------------------- shared helpers -----------------------------
fn g2rot(a: f32) -> mat2x2<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat2x2<f32>(c, -s, s, c);
}
// Rotate a single plane of a vec3 (WGSL can't assign to multi-component swizzles).
fn rotXZ(p: vec3<f32>, a: f32) -> vec3<f32> {
  let r = g2rot(a) * vec2<f32>(p.x, p.z);
  return vec3<f32>(r.x, p.y, r.y);
}
fn rotYZ(p: vec3<f32>, a: f32) -> vec3<f32> {
  let r = g2rot(a) * vec2<f32>(p.y, p.z);
  return vec3<f32>(p.x, r.x, r.y);
}
fn rotXY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let r = g2rot(a) * vec2<f32>(p.x, p.y);
  return vec3<f32>(r.x, r.y, p.z);
}
// Cyclic 3-stop gradient (a -> b -> c -> a) for the Aurora spectrum.
fn nvGrad3(t: f32, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>) -> vec3<f32> {
  let seg = fract(t) * 3.0;
  if (seg < 1.0) { return mix(a, b, smoothstep(0.0, 1.0, seg)); }
  if (seg < 2.0) { return mix(b, c, smoothstep(0.0, 1.0, seg - 1.0)); }
  return mix(c, a, smoothstep(0.0, 1.0, seg - 2.0));
}
// Screen-blend the corona as a coloured halo glow over the tonemapped star,
// gated out of the bright core so it reads as a coloured atmosphere rather than
// washing the body. Black halo => no glow.
fn nvHalo(col0: vec3<f32>, haloCol: vec3<f32>, corona: f32) -> vec3<f32> {
  let l0 = dot(col0, vec3<f32>(0.2126, 0.7152, 0.0722));
  let glow = haloCol * ((1.0 - exp(-corona)) * (1.0 - clamp(l0, 0.0, 1.0)));
  return col0 + glow - col0 * glow;
}
// Cheap per-pixel hash (Dave Hoskins hash12) for the output dither.
fn nvHash(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Triangular-PDF ordered dither (±1 LSB), gated off pure black. The glow halo is
// a smooth radial gradient; on an 8-bit drawable it quantises into visible
// concentric bands, so we nudge the value by up to one code value of noise before
// the final clamp to break the bands up. Mirrors the MSL nv_dither.
fn nvDither(col: vec3<f32>, frag: vec2<f32>) -> vec3<f32> {
  let n = nvHash(frag) + nvHash(frag + 19.19) - 1.0;          // triangular PDF in [-1, 1]
  let gate = smoothstep(0.0, 2.0 / 255.0, max(col.r, max(col.g, col.b)));
  return col + vec3<f32>(n * (1.0 / 255.0) * gate);
}

// ====================== style 0 — Solar Core ======================
fn nvBoilSolar(ain: vec3<f32>, t: f32) -> vec3<f32> {
  var a = ain;
  for (var d = 2.0; d <= 7.0; d = d + 1.0) {   // 8->7 folds: drop the sub-pixel top octave (mobile)
    a = a - (sin(a * d + t * 1.4)).zxy / d;
  }
  return a;
}
fn nvSolar(cc: vec2<f32>, R: vec2<f32>, t: f32) -> vec3<f32> {
  let turb = u.turbulence;
  let surfCol = u.surfaceColor.rgb;
  let coreCol = u.coreColor.rgb;
  let haloCol = u.haloColor.rgb;
  let dir = normalize(vec3<f32>(cc, R.y * 1.35));
  // Hoist the per-step camera rotation: both rotations are loop-invariant and
  // linear, so fold them into the ray direction/origin once. `p = z*rdir + roff`
  // is exactly `rot(z*dir - (0,0,6.5))` — same pixels, no per-step rotation.
  let rdir = rotYZ(rotXZ(dir, 0.17 * t), 0.11 * t);
  // Camera pulled back 6.5 -> 13.0 (2x distance) = star renders at ~half size.
  let roff = rotYZ(rotXZ(vec3<f32>(0.0, 0.0, -13.0), 0.17 * t), 0.11 * t);
  var acc = vec3<f32>(0.0);
  var z = 0.0;
  var rPrev = 1.0e9;
  let radius = 2.4 + 0.45 * sin(t * 1.1) + 0.16 * sin(t * 2.7 + 1.0);
  for (var i = 0.0; i < 72.0; i = i + 1.0) {
    let p = z * rdir + roff;
    let r = length(p);
    // Far-field cull (same idea as the Ocean / Mountain Waves loop-bound fix):
    // once the ray is past closest approach and well beyond the star surface
    // (~3.7), the rest of the march is a geometric tail of <~1% glow — stop
    // instead of stepping out to r~400. The rPrev gate cuts only the OUTBOUND
    // tail, never the inbound approach. Raise 6.0 for an even safer halo.
    if (r > 6.0 && r > rPrev) { break; }
    rPrev = r;
    // Soft far-field fade (no hard cutoff): boil ramps smoothly to zero between
    // dr 2.5 and 4.0, so the turbulence has no circular edge where it stops.
    let dr = abs(r - radius);
    var q = vec3<f32>(0.0);
    if (dr < 4.0) { q = nvBoilSolar(p * 1.3, t) * (1.0 - smoothstep(2.5, 4.0, dr)); }
    let s = q.y;
    let boil = 0.55 * (0.5 * q.x + 0.4 * sin(s) + 0.3 * q.z) * turb;
    let shell = abs(r - radius - boil);
    let d = 0.08 * shell + 0.05 * abs(cos(s)) + 0.012;
    z = z + d;
    let core = 1.0 / (0.6 * r * r + 0.04);
    let hue = (cos(s + 0.5 * r - 0.5 * t + vec3<f32>(0.0, 0.9, 1.7)) + 1.0);
    acc = acc + (hue * surfCol * 2.0 + core * coreCol * 2.0) / d;
    // Saturation early-out (mirrors nova.metal): once every channel passes tanh's
    // knee the output is pinned to white, so the rest of the march is invisible.
    if (min(acc.x, min(acc.y, acc.z)) > 2.45e4) { break; }
  }
  var corona = 0.0;
  for (var j = 1.0; j <= 36.0; j = j + 1.0) {   // 24 -> 36 so the glow still reaches at 2x camera distance
    var p = (0.5 * j) * dir;
    p.z = p.z - 13.0;
    let rr = abs(length(p) - radius);
    corona = corona + 0.06 / (0.25 + rr * rr);
  }
  return nvHalo(tanh(acc / 7.0e3), haloCol, corona);
}

// ====================== style 1 — Golden Sun ======================
fn nvGran(ain: vec3<f32>, t: f32) -> vec3<f32> {
  var b = ain;
  for (var d = 1.0; d < 7.0; d = d + 1.0) {
    let rr = g2rot(0.20 * t / d) * vec2<f32>(b.x, b.y);
    b.x = rr.x;
    b.y = rr.y;
    b = b + cos(b.yzx * (d * 1.3) + t * 1.1 + 0.7 * d) / d;
  }
  return b;
}
fn nvBreath(t: f32) -> f32 {
  return 0.34 * sin(t * 0.55) + 0.12 * sin(t * 1.45 + 0.6);
}
fn nvGolden(cc: vec2<f32>, R: vec2<f32>, t: f32) -> vec3<f32> {
  let turb = u.turbulence;
  let surfCol = u.surfaceColor.rgb;
  let coreCol = u.coreColor.rgb;
  let haloCol = u.haloColor.rgb;
  let dir = normalize(vec3<f32>(cc, R.y * 1.4));
  // Hoist the per-step camera rotation (loop-invariant + linear) into the ray.
  let rdir = rotYZ(rotXZ(dir, 0.09 * t), 0.06 * t + 0.3);
  // Camera pulled back 6.5 -> 13.0 (2x distance) = star renders at ~half size.
  let roff = rotYZ(rotXZ(vec3<f32>(0.0, 0.0, -13.0), 0.09 * t), 0.06 * t + 0.3);
  var acc = vec3<f32>(0.0);
  var z = 0.0;
  var rPrev = 1.0e9;
  let radius = 2.35 + nvBreath(t);
  for (var i = 0.0; i < 72.0; i = i + 1.0) {
    let p = z * rdir + roff;
    let r = length(p);
    // Far-field cull: stop once past the star into the faint outbound tail.
    if (r > 6.0 && r > rPrev) { break; }
    rPrev = r;
    let dr = abs(r - radius);   // far-field detail-cull (mobile)
    var q = vec3<f32>(0.0);
    if (dr < 4.0) { q = nvGran(p * 1.25, t) * (1.0 - smoothstep(2.5, 4.0, dr)); }   // soft far-field fade
    let s = q.x;
    let boil = 0.34 * (0.5 * sin(s) + 0.4 * q.y + 0.3 * sin(q.z)) * turb;
    let shell = abs(r - radius - boil);
    let d = 0.085 * shell + 0.045 * abs(cos(s)) + 0.012;
    z = z + d;
    let core = 1.0 / (0.55 * r * r + 0.05);
    let hue = (cos(0.6 * s + 0.7 * r - 0.4 * t + vec3<f32>(0.0, 0.55, 1.05)) + 1.0);
    acc = acc + (hue * surfCol * 2.0 + core * coreCol * 2.0) / (d + 1e-4);
    if (min(acc.x, min(acc.y, acc.z)) > 2.6e4) { break; }   // tanh saturation early-out
  }
  var corona = 0.0;
  for (var j = 0.0; j < 36.0; j = j + 1.0) {   // 26 -> 36 so the glow still reaches at 2x camera distance
    var p = (0.5 * (j + 1.0)) * dir;
    p.z = p.z - 13.0;
    let rr = abs(length(p) - radius);
    corona = corona + 0.07 / (0.22 + rr * rr);
  }
  return nvHalo(tanh(acc / 7.4e3), haloCol, corona);
}

// ====================== style 2 — Emerald Star ======================
fn nvSwirl(ain: vec3<f32>, t: f32) -> vec3<f32> {
  var a = ain;
  let ang = atan2(a.y, a.x);
  for (var d = 2.0; d <= 7.0; d = d + 1.0) {   // 8->7 folds: drop the sub-pixel top octave (mobile)
    a = a - (sin(a * d + t * 1.15 + ang * 0.6)).yzx / d;
  }
  return a;
}
fn nvEmerald(cc: vec2<f32>, R: vec2<f32>, t: f32) -> vec3<f32> {
  let turb = u.turbulence;
  let surfCol = u.surfaceColor.rgb;
  let coreCol = u.coreColor.rgb;
  let haloCol = u.haloColor.rgb;
  let dir = normalize(vec3<f32>(cc, R.y * 1.45));
  var acc = vec3<f32>(0.0);
  var z = 0.0;
  var rPrev = 1.0e9;
  let radius = 2.3 + 0.38 * sin(t * 1.6) + 0.20 * sin(t * 0.7 + 0.5);
  for (var i = 0.0; i < 72.0; i = i + 1.0) {
    var p = z * dir;
    p.z = p.z - 13.0;   // camera pulled back 6.5 -> 13.0 (2x distance) = star renders at ~half size
    let sp = 0.55 * t + 0.22 * z;
    p = rotXY(p, sp);
    p = rotYZ(p, 0.13 * t);
    let r = length(p);
    // Far-field cull: stop once past the star into the faint outbound tail.
    // (Spin angle sp depends on z, so the rotation can't be hoisted here.)
    if (r > 6.0 && r > rPrev) { break; }
    rPrev = r;
    let dr = abs(r - radius);   // far-field detail-cull (mobile)
    var q = vec3<f32>(0.0);
    if (dr < 4.0) { q = nvSwirl(p * 1.25, t) * (1.0 - smoothstep(2.5, 4.0, dr)); }   // soft far-field fade
    let s = q.y;
    let boil = 0.50 * (0.45 * q.x + 0.45 * sin(s) + 0.30 * q.z) * turb;
    let shell = abs(r - radius - boil);
    let d = 0.08 * shell + 0.05 * abs(cos(s)) + 0.012;
    z = z + d;
    let core = 1.0 / (0.6 * r * r + 0.04);
    let hue = (cos(s + 0.45 * r - 0.4 * t + vec3<f32>(2.2, 0.0, 4.2)) + 1.0);
    acc = acc + (hue * surfCol * 2.0 + core * coreCol * 2.0) / d;
    if (min(acc.x, min(acc.y, acc.z)) > 9.1e3) { break; }   // tanh saturation early-out
  }
  var corona = 0.0;
  for (var j = 1.0; j <= 36.0; j = j + 1.0) {   // 24 -> 36 so the glow still reaches at 2x camera distance
    var p = (0.5 * j) * dir;
    p.z = p.z - 13.0;
    let rr = abs(length(p) - radius);
    corona = corona + 0.06 / (0.25 + rr * rr);
  }
  return nvHalo(tanh(acc / 2.6e3), haloCol, corona);
}

// ====================== style 3 — Violet Star ======================
fn nvBoilViolet(ain: vec3<f32>, t: f32) -> vec3<f32> {
  var a = ain;
  for (var d = 2.0; d <= 7.0; d = d + 1.0) {
    a = a - cos(a.yzx * d - t * 0.9) / d;
    a = a + (sin(a.zxy * (d * 0.6) + t * 1.1)).yzx / (d + 0.5);
  }
  return a;
}
fn nvWobble(n: vec3<f32>, t: f32) -> f32 {
  var w = 0.0;
  w = w + 0.42 * sin(2.0 * n.y + t * 1.7);
  w = w + 0.34 * cos(3.0 * n.x - t * 1.3 + 0.6);
  w = w + 0.26 * sin(4.0 * n.z + 2.0 * n.x + t * 2.1);
  w = w + 0.18 * cos(5.0 * n.y - 3.0 * n.z + t * 0.9);
  return w;
}
fn nvViolet(cc: vec2<f32>, R: vec2<f32>, t: f32) -> vec3<f32> {
  let turb = u.turbulence;
  let surfCol = u.surfaceColor.rgb;
  let coreCol = u.coreColor.rgb;
  let haloCol = u.haloColor.rgb;
  let dir = normalize(vec3<f32>(cc, R.y * 1.3));
  // Hoist the per-step camera rotation (loop-invariant + linear) into the ray.
  let rdir = rotYZ(rotXZ(dir, 0.13 * t), 0.09 * t + 0.4);
  // Camera pulled back 6.4 -> 12.8 (2x distance) = star renders at ~half size.
  let roff = rotYZ(rotXZ(vec3<f32>(0.0, 0.0, -12.8), 0.13 * t), 0.09 * t + 0.4);
  var acc = vec3<f32>(0.0);
  var z = 0.0;
  var rPrev = 1.0e9;
  let beat = sin(t * 1.45) + 0.5 * sin(t * 2.9 + 0.7);
  let radius = 2.3 + 0.40 * sin(t * 0.85) + 0.22 * beat;
  for (var i = 0.0; i < 72.0; i = i + 1.0) {
    let p = z * rdir + roff;
    let r = length(p);
    // Far-field cull: stop once past the star into the faint outbound tail.
    // 7.0 (vs Solar's 6.0) keeps margin for the wobble's extended silhouette.
    if (r > 7.0 && r > rPrev) { break; }
    rPrev = r;
    let nrm = p / (r + 1e-3);
    let dr = abs(r - radius);   // far-field detail-cull (mobile): skip boil+wobble far from shell
    var q = vec3<f32>(0.0);
    if (dr < 4.0) { q = nvBoilViolet(p * 1.15, t) * (1.0 - smoothstep(2.5, 4.0, dr)); }   // soft far-field fade
    let s = q.y;
    let boil = 0.5 * (0.45 * q.x + 0.4 * sin(s) + 0.3 * q.z) * turb;
    var wob = 0.0;
    if (dr < 4.0) { wob = nvWobble(nrm, t) * (1.0 - smoothstep(2.5, 4.0, dr)); }   // soft far-field fade
    let effR = radius + 0.8 * wob;
    let shell = abs(r - effR - boil);
    let d = 0.075 * shell + 0.05 * abs(cos(s)) + 0.012;
    z = z + d;
    let core = 1.0 / (0.6 * r * r + 0.05);
    let hue = (cos(s + 0.45 * r - 0.4 * t + vec3<f32>(0.9, 1.9, 0.4)) + 1.0);
    acc = acc + (hue * surfCol * 2.0 + core * coreCol * 2.0) / d;
    if (min(acc.x, min(acc.y, acc.z)) > 1.54e4) { break; }   // tanh saturation early-out
  }
  var corona = 0.0;
  for (var j = 1.0; j <= 36.0; j = j + 1.0) {   // 24 -> 36 so the glow still reaches at 2x camera distance
    var p = (0.5 * j) * dir;
    p.z = p.z - 12.8;
    let rr = abs(length(p) - radius);
    corona = corona + 0.06 / (0.25 + rr * rr);
  }
  return nvHalo(tanh(acc / 4.4e3), haloCol, corona);
}

// ====================== style 4 — Crimson Furnace ======================
fn nvBoilCrimson(ain: vec3<f32>, t: f32) -> vec3<f32> {
  var a = ain;
  for (var d = 2.0; d <= 7.0; d = d + 1.0) {   // 9->7 folds: drop the two sub-pixel top octaves (mobile)
    a = a - cos(a.yzx * d + t * 2.1 + d) / (d + 0.3);
  }
  return a;
}
fn nvFlares(n: vec3<f32>, t: f32, rim: f32) -> f32 {
  var flare = 0.0;
  for (var k = 1.0; k <= 6.0; k = k + 1.0) {
    let a = k * 1.7 + t * (0.6 + 0.13 * k);
    let b = k * 0.9 + sin(t * 0.7 + k) * 1.4;
    let axis = normalize(vec3<f32>(cos(a) * cos(b), sin(b), sin(a) * cos(b)) + vec3<f32>(1e-5));
    let al = max(dot(n, axis), 0.0);
    let spike = pow(al, 22.0);
    let flick = 0.55 + 0.45 * sin(t * (3.1 + 0.7 * k) + k * 2.3);
    flare = flare + spike * flick;
  }
  return flare * rim;
}
fn nvCrimson(cc: vec2<f32>, R: vec2<f32>, t: f32) -> vec3<f32> {
  let turb = u.turbulence;
  let surfCol = u.surfaceColor.rgb;
  let coreCol = u.coreColor.rgb;
  let haloCol = u.haloColor.rgb;
  let dir = normalize(vec3<f32>(cc, R.y * 1.30));
  let rdir = rotYZ(rotXZ(dir, 0.23 * t), 0.15 * t + 0.4);
  // Camera pulled back 6.2 -> 12.4 (2x distance) = star renders at ~half size.
  let roff = rotYZ(rotXZ(vec3<f32>(0.0, 0.0, -12.4), 0.23 * t), 0.15 * t + 0.4);
  var acc = vec3<f32>(0.0);
  var z = 0.0;
  var rPrev = 1.0e9;
  let radius = 2.2 + 0.50 * sin(t * 1.6) + 0.14 * sin(t * 4.3 + 0.7) + 0.07 * sin(t * 9.1);
  for (var i = 0.0; i < 72.0; i = i + 1.0) {
    let p = z * rdir + roff;
    let r = length(p) + 1e-4;
    if (r > 7.0 && r > rPrev) { break; }
    rPrev = r;
    let n = p / r;
    let dr = abs(r - radius);
    var q = vec3<f32>(0.0);
    if (dr < 4.0) { q = nvBoilCrimson(p * 1.5, t) * (1.0 - smoothstep(2.5, 4.0, dr)); }   // soft far-field fade
    let s = q.y;
    let boil = 0.62 * (0.5 * q.x + 0.45 * sin(s) + 0.35 * q.z) * turb;
    let rim = exp(-2.2 * dr);
    var flare = 0.0;
    if (dr < 4.0) { flare = nvFlares(n, t, rim); }
    let shell = abs(r - radius - boil - 0.55 * flare);
    let d = 0.075 * shell + 0.05 * abs(cos(s)) + 0.012;
    z = z + d;
    let dd = d + 1e-3;
    let core = 1.0 / (0.55 * r * r + 0.045);
    let hue = (cos(s + 0.5 * r - 0.6 * t + vec3<f32>(0.0, 0.55, 1.1)) + 1.0);
    let flareCol = mix(vec3<f32>(1.7, 1.4, 1.0), vec3<f32>(1.9, 0.35, 0.08),
                       clamp((r - radius) * 1.6 + 0.5, 0.0, 1.0));
    acc = acc + (hue * surfCol * 2.0 + core * coreCol * 2.0 + flareCol * flare * 1.3) / dd;
    if (min(acc.x, min(acc.y, acc.z)) > 7.7e3) { break; }   // tanh saturation early-out
  }
  var corona = 0.0;
  for (var j = 1.0; j <= 36.0; j = j + 1.0) {   // 26 -> 36 so the glow still reaches at 2x camera distance
    var p = (0.45 * j) * dir;
    p.z = p.z - 12.4;
    let rr = abs(length(p) - radius);
    corona = corona + 0.06 / (0.22 + rr * rr);
  }
  return nvHalo(max(tanh(acc / 2.2e3), vec3<f32>(0.0)), haloCol, corona);
}

// ====================== style 5 — Aurora Star ======================
fn nvBoilAurora(ain: vec3<f32>, t: f32) -> vec3<f32> {
  var a = ain;
  for (var d = 1.0; d < 7.0; d = d + 1.0) {   // 8->7 folds: drop the sub-pixel top octave (mobile)
    a = a - cos(a.yzx * d + t * 0.9 + d * 0.4) / (d + 0.5);
  }
  return a;
}
fn nvAurora(cc: vec2<f32>, R: vec2<f32>, t: f32) -> vec3<f32> {
  let turb = u.turbulence;
  let surfCol = u.surfaceColor.rgb;
  let coreCol = u.coreColor.rgb;
  let haloCol = u.haloColor.rgb;
  let dir = normalize(vec3<f32>(cc, R.y * 1.28));
  // Hoist the per-step camera rotation (loop-invariant + linear) into the ray.
  let rdir = rotYZ(rotXZ(dir, 0.13 * t), -0.09 * t + 0.5);
  // Camera pulled back 6.5 -> 13.0 (2x distance) = star renders at ~half size.
  let roff = rotYZ(rotXZ(vec3<f32>(0.0, 0.0, -13.0), 0.13 * t), -0.09 * t + 0.5);
  var col = vec3<f32>(0.0);
  var z = 0.0;
  var rPrev = 1.0e9;
  let radius = 2.3 + 0.40 * sin(t * 0.85) + 0.10 * sin(t * 3.3 + 0.7);
  let hueDrift = 0.08 * t;
  for (var i = 0.0; i < 72.0; i = i + 1.0) {
    let p = z * rdir + roff;
    let r = length(p);
    // Far-field cull: stop once past the star into the faint outbound tail.
    if (r > 6.0 && r > rPrev) { break; }
    rPrev = r;
    let dr = abs(r - radius);   // far-field detail-cull (mobile)
    var q = vec3<f32>(0.0);
    if (dr < 4.0) { q = nvBoilAurora(p * 1.25, t) * (1.0 - smoothstep(2.5, 4.0, dr)); }   // soft far-field fade
    let s = q.y;
    let boil = 0.50 * (0.5 * q.x + 0.4 * sin(s) + 0.3 * q.z) * turb;
    let shell = abs(r - radius - boil);
    let d = 0.085 * shell + 0.05 * abs(cos(s)) + 0.012;
    z = z + d;
    let core = 0.55 / (0.9 * r * r + 0.20);
    let ph = 0.16 * z + 0.22 * r + 0.18 * s + hueDrift;
    let iris = nvGrad3(ph, surfCol, coreCol, haloCol);
    let band = 0.5 * cos(s + 0.5 * r - 0.4 * t) + 0.7;
    col = col + (iris * band + core * coreCol * 1.6) / d;
    if (min(col.x, min(col.y, col.z)) > 9.1e3) { break; }   // tanh saturation early-out
  }
  var corona = vec3<f32>(0.0);
  for (var j = 1.0; j <= 36.0; j = j + 1.0) {   // 24 -> 36 so the glow still reaches at 2x camera distance
    var p = (0.5 * j) * dir;
    p.z = p.z - 13.0;
    let rr = abs(length(p) - radius);
    let g = 0.06 / (0.25 + rr * rr);
    corona = corona + nvGrad3(0.05 * j + hueDrift + 0.3, surfCol, coreCol, haloCol) * g;
  }
  col = col + corona * 900.0;
  return tanh(col / 2.6e3);
}

// ================================ entry ================================
fn novaAnim(uv01: vec2<f32>) -> vec4<f32> {
  let R = u.size;
  // Reconstruct the gallery coordinate: top-left fragment coord -> Y-flip ->
  // 2x zoom-out about centre (matches the source dispatch exactly at scale=1).
  let frag = uv01 * R;
  var U = vec2<f32>(frag.x, R.y - frag.y);
  U = R * 0.5 + (U - R * 0.5) * 2.0;
  let cc = (U * 2.0 - R) / max(u.scale, 0.001);
  let t = u.time * u.speed;

  let si = i32(u.style);
  var base: vec3<f32>;
  if (si == 1) { base = nvGolden(cc, R, t); }
  else if (si == 2) { base = nvEmerald(cc, R, t); }
  else if (si == 3) { base = nvViolet(cc, R, t); }
  else if (si == 4) { base = nvCrimson(cc, R, t); }
  else if (si == 5) { base = nvAurora(cc, R, t); }
  else { base = nvSolar(cc, R, t); }

  // NaN guard, then the shared grade: tint + brightness, saturation, contrast,
  // background fill of the dark void, then clamp to display range.
  base = select(base, vec3<f32>(0.0), base != base);
  var col = base * u.brightness * u.tint.rgb;
  let luma = dot(col, vec3<f32>(0.2126, 0.7152, 0.0722));
  col = mix(vec3<f32>(luma), col, u.saturation);
  col = (col - vec3<f32>(0.5)) * u.contrast + vec3<f32>(0.5);
  let lum = max(col.r, max(col.g, col.b));
  col = col + u.background.rgb * (1.0 - clamp(lum, 0.0, 1.0));
  col = nvDither(col, frag);
  col = clamp(col, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(col, 1.0);
}
