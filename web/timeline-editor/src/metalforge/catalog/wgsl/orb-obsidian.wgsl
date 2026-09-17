// Obsidian Orb — dark polished stone sealed under glass, in a wall-only void.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic uniform
// packer can walk one ordering. The eight floats sit back to back, `center`
// takes the next 8-byte slot (four bytes of padding before it), and WGSL then
// pads again to put `tint` on a 16-byte boundary — the packer mirrors both gaps.
//
// Every colour in the image is a uniform. The four studio colours and the
// stone's ambient are stored *normalised* — each original constant divided by
// its own largest channel, so the swatch is a hue and not a near-black — and the
// literal it was divided by is multiplied back at the point of use.
struct Uniforms {
  size:           vec2<f32>,
  time:           f32,
  speed:          f32,
  radius:         f32,
  stone:          f32,
  relief:         f32,
  grain:          f32,
  sheen:          f32,
  glow:           f32,
  exposure:       f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  center:         vec2<f32>,
  tint:           vec4<f32>,
  rimColor:       vec4<f32>,
  glassColor:     vec4<f32>,
  bounceColor:    vec4<f32>,
  wallColor:      vec4<f32>,
  wallTint:       vec4<f32>,
  lampAColor:     vec4<f32>,
  lampBColor:     vec4<f32>,
  specColor:      vec4<f32>,
  softboxColor:   vec4<f32>,
  lobeColor:      vec4<f32>,
  limbColor:      vec4<f32>,
  keyColor:       vec4<f32>,
  keyMidColor:    vec4<f32>,
  keyWideColor:   vec4<f32>,
  envColor:       vec4<f32>,
  envTint:        vec4<f32>,
  ambientColor:   vec4<f32>,
  stoneSpecColor: vec4<f32>,
  glowColor:      vec4<f32>,
  paletteStop0:    vec4<f32>,
  paletteStop1:    vec4<f32>,
  paletteStop2:    vec4<f32>,
  paletteStop3:    vec4<f32>,
  paletteStop4:    vec4<f32>,
  paletteStop5:    vec4<f32>,
  paletteStop6:    vec4<f32>,
  paletteStop7:    vec4<f32>,
  paletteStop8:    vec4<f32>,
  paletteStop9:    vec4<f32>,
  paletteStop10:   vec4<f32>,
  paletteStop11:   vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

// ── The Orbs edge bank (WGSL) ───────────────────────────────────────────────
// Two knobs every orb on the shelf carries: how soft its limb is, and how far
// it glows past it. See effects/_shared/edge.ts for the contract.
//
// THREE files must agree — edge.wgsl, edge.metal, edge.sksl. Change one, change
// all three, or the Code tab starts lying about what it ships.

// How much wider than the shipped feather the Edge softness slider is asking
// for. 0.005 is the width every orb was authored with, so this returns exactly
// 0 at the default and every edge expression collapses to the constant it
// replaced — the defaults are bit-identical to the render before the bank.
fn mfEdgeD(soft: f32) -> f32 {
  return soft - 0.005;
}

// The halo an orb throws past its own limb.
//
// ADDED, never subtracted: whatever the orb already paints out there — a
// studio wall, its own exp() bleed, the sheet's cones — survives untouched.
// That is what lets this be adopted by seventeen shaders whose backdrops have
// nothing in common.
//
// `glow == 0` returns `col` by an early exit rather than by adding zero. Both
// are exact, but the exit also skips the length() on the ~60% of the frame
// outside the ball, and 0 is the default.
fn mfEdgeGlow(col: vec3<f32>, uv: vec2<f32>, ctr: vec2<f32>, rad: f32,
              soft: f32, glow: f32, glowRGB: vec3<f32>) -> vec3<f32> {
  if (glow <= 0.0) { return col; }
  let r = length(uv - ctr);
  // Fenced to the outside of the limb by the same softness the limb uses, so
  // the halo starts where the ball stops however soft that boundary is. Without
  // it the exp() is 1 across the whole disc and washes the face flat.
  let outside = smoothstep(rad - max(soft, 0.0005), rad + max(soft, 0.0005), r);
  return col + glowRGB * (glow * exp(-max(r - rad, 0.0) * 11.0) * outside);
}


// ── The Orbs palette-ramp bank (WGSL) ───────────────────────────────────────
// The add/remove colour list, evaluated INSIDE the shader so every stop paints
// its own region of the ball instead of being averaged into a role colour.
// See effects/_shared/ramp.ts for the contract.
//
// THREE files must agree — ramp.wgsl, ramp.metal, ramp.sksl. Change one, change
// all three, or the Code tab starts lying about what it ships.

// One stop, picked without a dynamic array index.
//
// A `var` array indexed by a runtime value is the shape that spills to scratch
// memory on the GPUs this project cares about (PERFORMANCE.md); twelve selects
// stay in registers and are branchless on every backend. Written once here so
// no adopting shader has to.
fn mfRampPick(idx: f32,
              s0: vec3<f32>, s1: vec3<f32>, s2:  vec3<f32>, s3:  vec3<f32>,
              s4: vec3<f32>, s5: vec3<f32>, s6:  vec3<f32>, s7:  vec3<f32>,
              s8: vec3<f32>, s9: vec3<f32>, s10: vec3<f32>, s11: vec3<f32>) -> vec3<f32> {
  var r = s0;
  r = select(r, s1,  idx == 1.0);
  r = select(r, s2,  idx == 2.0);
  r = select(r, s3,  idx == 3.0);
  r = select(r, s4,  idx == 4.0);
  r = select(r, s5,  idx == 5.0);
  r = select(r, s6,  idx == 6.0);
  r = select(r, s7,  idx == 7.0);
  r = select(r, s8,  idx == 8.0);
  r = select(r, s9,  idx == 9.0);
  r = select(r, s10, idx == 10.0);
  r = select(r, s11, idx == 11.0);
  return r;
}

// The CYCLIC ramp: `t` wraps, and the last stop runs back into the first.
//
// This is the one a generated-colour orb wants. Prism's hue comes from a cosine
// of an unbounded scalar field, so its colour has always been periodic — a
// clamped ramp would flatten every band past t == 1 into one colour and throw
// the banding away. Wrapping keeps the field's structure exactly and only swaps
// what the structure is *coloured* with.
//
// NOT ONE BRANCH IN HERE, and that is load-bearing rather than tidy. An orb
// evaluates this next to a `fract(sin(x) * 43758.5453)` grain hash, which
// amplifies a last-bit change in its argument by ~44000x. Any `if` in this file
// or at a call site splits the fragment's basic block, the compiler stops
// folding `uv / rad` into its uses, and the hash turns that into speckle up to
// 33/255 — measured, on exactly the first cut of this bank. Straight-line code
// keeps the untouched render bit-identical. Same reasoning as the early-out
// guards every orb carries; see the note in orb-prism.wgsl.
fn mfRampCyc(tIn: f32, n: f32,
             s0: vec3<f32>, s1: vec3<f32>, s2:  vec3<f32>, s3:  vec3<f32>,
             s4: vec3<f32>, s5: vec3<f32>, s6:  vec3<f32>, s7:  vec3<f32>,
             s8: vec3<f32>, s9: vec3<f32>, s10: vec3<f32>, s11: vec3<f32>) -> vec3<f32> {
  let k  = clamp(floor(n + 0.5), 1.0, 12.0);
  let x  = fract(tIn) * k;
  let i0 = min(floor(x), k - 1.0);
  let i1 = select(i0 + 1.0, 0.0, i0 + 1.0 >= k);   // the wrap
  return mix(mfRampPick(i0, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
             mfRampPick(i1, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
             x - i0);
}

// The CLAMPED ramp: stop 0 at t == 0, the last stop at t == 1, held outside.
//
// This is the one an orb with an authored dark→light body ramp wants — the
// four-stop Deep/Mid/Surge/Crest shape, where the ends really are ends.
//
// Branchless for the same reason as `mfRampCyc`. The single-stop case falls out
// of the arithmetic rather than needing an early return: k == 1 makes the span
// zero, so x is 0, i0 is 0 and the mix weight is 0 — s0, exactly.
fn mfRampLin(tIn: f32, n: f32,
             s0: vec3<f32>, s1: vec3<f32>, s2:  vec3<f32>, s3:  vec3<f32>,
             s4: vec3<f32>, s5: vec3<f32>, s6:  vec3<f32>, s7:  vec3<f32>,
             s8: vec3<f32>, s9: vec3<f32>, s10: vec3<f32>, s11: vec3<f32>) -> vec3<f32> {
  let k  = clamp(floor(n + 0.5), 1.0, 12.0);
  let x  = clamp(tIn, 0.0, 1.0) * (k - 1.0);
  let i0 = clamp(floor(x), 0.0, max(k - 2.0, 0.0));
  return mix(mfRampPick(i0,     s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
             mfRampPick(i0 + 1.0, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
             x - i0);
}

// ── The ramp as ONE value ───────────────────────────────────────────────────
//
// Thirteen uniforms is a reasonable thing for a shader to hold and a terrible
// thing for a helper to take. Several orbs make their body colour deep inside
// one — Glass·Liquid's fluid, the studio orbs' environment mirrors — and in the
// MSL these files are transcribed against, a helper cannot read the stitchable
// entry point's arguments, so the palette has to be handed down. Bundled like
// this that is one parameter instead of thirteen, and the three languages stay
// line-for-line.
//
// The stops come back out by CONSTANT index only, so this is still not a
// dynamically indexed array and still cannot spill to scratch memory.
struct MfRamp {
  n:   f32,
  s0:  vec3<f32>, s1:  vec3<f32>, s2:  vec3<f32>, s3:  vec3<f32>,
  s4:  vec3<f32>, s5:  vec3<f32>, s6:  vec3<f32>, s7:  vec3<f32>,
  s8:  vec3<f32>, s9:  vec3<f32>, s10: vec3<f32>, s11: vec3<f32>,
};

fn mfRampOf(n: f32,
            s0: vec3<f32>, s1: vec3<f32>, s2:  vec3<f32>, s3:  vec3<f32>,
            s4: vec3<f32>, s5: vec3<f32>, s6:  vec3<f32>, s7:  vec3<f32>,
            s8: vec3<f32>, s9: vec3<f32>, s10: vec3<f32>, s11: vec3<f32>) -> MfRamp {
  return MfRamp(n, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11);
}

fn mfRampCycR(t: f32, r: MfRamp) -> vec3<f32> {
  return mfRampCyc(t, r.n, r.s0, r.s1, r.s2, r.s3, r.s4, r.s5,
                   r.s6, r.s7, r.s8, r.s9, r.s10, r.s11);
}

fn mfRampLinR(t: f32, r: MfRamp) -> vec3<f32> {
  return mfRampLin(t, r.n, r.s0, r.s1, r.s2, r.s3, r.s4, r.s5,
                   r.s6, r.s7, r.s8, r.s9, r.s10, r.s11);
}


// The original leans on GLSL's smoothstep with edge0 > edge1 (a falling ramp);
// WGSL leaves that indeterminate, so the two places that need it spell it out.
fn obSstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// GLSL's refract, written out. WGSL's builtin agrees exactly, but the MSL and
// SkSL halves of this effect carry the same helper, so all three read alike.
fn obRefract(i: vec3<f32>, n: vec3<f32>, eta: f32) -> vec3<f32> {
  let d = dot(n, i);
  let k = 1.0 - eta * eta * (1.0 - d * d);
  if (k < 0.0) { return vec3<f32>(0.0); }
  return eta * i - (eta * d + sqrt(k)) * n;
}

fn obHash(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

fn obNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = obHash(i);
  let b = obHash(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = obHash(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = obHash(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = obHash(i + vec3<f32>(0.0, 0.0, 1.0));
  let g = obHash(i + vec3<f32>(1.0, 0.0, 1.0));
  let j = obHash(i + vec3<f32>(0.0, 1.0, 1.0));
  let k = obHash(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

fn obFbm(pIn: vec3<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * obNoise(p);
    p = p * 2.03 + vec3<f32>(7.1, 3.7, 1.3);
    a = a * 0.5;
  }
  return v;
}

fn obRotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

fn obRotX(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

fn obAces(x: vec3<f32>) -> vec3<f32> {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14),
               vec3<f32>(0.0), vec3<f32>(1.0));
}

// Distance from p along d to the far side of the unit sphere.
fn obSphExit(p: vec3<f32>, d: vec3<f32>) -> f32 {
  let b = dot(p, d);
  return -b + sqrt(max(1.0 - dot(p, p) + b * b, 0.0));
}

// Three incommensurate sines: the stone kneads in place rather than drifting.
fn obKnead(t: f32, a: f32, b: f32, c: f32, ph: f32) -> vec3<f32> {
  return vec3<f32>(sin(t * a) + 0.55 * sin(t * a * 0.41 + ph),
                   cos(t * b) + 0.55 * cos(t * b * 0.37 + ph * 1.7),
                   sin(t * c + ph * 2.3));
}

fn obSchlick(ct: f32, f0: f32) -> f32 {
  return f0 + (1.0 - f0) * pow(max(1.0 - ct, 0.0), 5.0);
}

// The room the orb sits in: a graded wall with two soft box lights on it, and
// nothing else. wallA/wallB are the two ends of the vertical grade, lampA/lampB
// the two bounces; all four are normalised swatches scaled back by the literal
// that was their largest channel (0.0112, 0.0027, 0.0270, 0.0135).
fn obStudioBG(p: vec2<f32>, wallA: vec3<f32>, wallB: vec3<f32>,
              lampA: vec3<f32>, lampB: vec3<f32>) -> vec3<f32> {
  // The palette IS the room this orb mirrors.
  //
  // That is where a studio orb's colour actually is: the ball is a mirror,
  // so what animates is which part of the backdrop each deforming facet
  // reflects. `s` is the wall's own vertical gradient, already in [0,1], and
  // the `mix(k, k, s)` beside it is the brightness envelope the two ends
  // carried — the ramp replaces the COLOUR and leaves the exposure alone, so
  // the seed is that lerp with the envelope divided back out. SELECTED,
  // never branched (effects/_shared/ramp.ts).
  let ws = smoothstep(-0.55, 1.25, p.y);
  var wall = select(mix(wallA * 0.0112, wallB * 0.0027, ws),
                    mfRampLin(ws, u.paletteCount,
                              u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                              u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                              u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                              u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb) * mix(0.0112, 0.0027, ws),
                    u.paletteCount > 0.5);
  let s1 = (p - vec2<f32>(-0.80, 0.74)) * vec2<f32>(1.00, 1.65);
  wall = wall + lampA * 0.0270 * exp(-dot(s1, s1) * 1.30);
  let s2 = (p - vec2<f32>(0.94, 0.14)) * vec2<f32>(1.30, 2.05);
  wall = wall + lampB * 0.0135 * exp(-dot(s2, s2) * 1.85);
  return wall;
}

// The backdrop seen through the glass, sampled once per channel at three
// slightly different indices of refraction — that split is the fringe.
fn obBgThrough(uv: vec2<f32>, N: vec3<f32>, wallA: vec3<f32>, wallB: vec3<f32>,
               lampA: vec3<f32>, lampB: vec3<f32>) -> vec3<f32> {
  let d1 = obRefract(vec3<f32>(0.0, 0.0, -1.0), N, 1.0 / 1.500);
  let d2 = obRefract(vec3<f32>(0.0, 0.0, -1.0), N, 1.0 / 1.524);
  let d3 = obRefract(vec3<f32>(0.0, 0.0, -1.0), N, 1.0 / 1.552);
  return vec3<f32>(obStudioBG(uv + d1.xy * 1.15, wallA, wallB, lampA, lampB).r,
                   obStudioBG(uv + d2.xy * 1.15, wallA, wallB, lampA, lampB).g,
                   obStudioBG(uv + d3.xy * 1.15, wallA, wallB, lampA, lampB).b) * 2.6;
}

// Everything that sits ON the glass: a needle specular, a soft box reflection,
// a second lobe, and the two limb terms that make the edge read as thickness.
fn obGlassHi(N: vec3<f32>, su: vec2<f32>, z: f32, glassCol: vec3<f32>,
             specCol: vec3<f32>, softboxCol: vec3<f32>, lobeCol: vec3<f32>,
             limbCol: vec3<f32>) -> vec3<f32> {
  let V = vec3<f32>(0.0, 0.0, 1.0);
  let L1 = normalize(vec3<f32>(-0.62, 0.60, 0.50));
  let L2 = normalize(vec3<f32>(0.66, 0.16, 0.72));
  let H1 = normalize(L1 + V);
  let H2 = normalize(L2 + V);
  let k = max(dot(N, H1), 0.0);
  var c = specCol * (pow(k, 420.0) * 2.8 + pow(k, 46.0) * 0.11);
  let sb = (su - vec2<f32>(-0.44, 0.46)) * vec2<f32>(2.0, 4.4);
  c = c + softboxCol * exp(-dot(sb, sb) * 2.2) * 0.26;
  c = c + lobeCol * pow(max(dot(N, H2), 0.0), 120.0) * 0.34;
  let e = smoothstep(0.86, 1.0, length(su));
  c = c + glassCol * e * pow(1.0 - z, 1.6) * 0.26;
  c = c + limbCol * pow(smoothstep(0.972, 1.0, length(su)), 0.75) * 0.26;
  return c;
}

// What the stone sees: the wall smeared by the reflection vector, a key light
// in three widths, a violet/blue gradient across the horizon and a warm bounce.
fn obEnvMirror(uv: vec2<f32>, R: vec3<f32>, keyP: f32, keyI: f32,
               bounceCol: vec3<f32>, wallA: vec3<f32>, wallB: vec3<f32>,
               lampA: vec3<f32>, lampB: vec3<f32>, keyCol: vec3<f32>,
               keyMidCol: vec3<f32>, keyWideCol: vec3<f32>,
               envA: vec3<f32>, envB: vec3<f32>) -> vec3<f32> {
  let L1 = normalize(vec3<f32>(-0.60, 0.64, 0.48));
  var e = obStudioBG(uv * 0.55 + R.xy * 0.72, wallA, wallB, lampA, lampB) * 7.5;
  e = e + keyCol * pow(max(dot(R, L1), 0.0), keyP) * keyI;
  e = e + keyMidCol * pow(max(dot(R, L1), 0.0), 22.0) * 0.55;
  e = e + keyWideCol * pow(max(dot(R, L1), 0.0), 4.0) * 0.30;
  e = e + mix(envA, envB, 0.5 + 0.5 * R.x) * pow(1.0 - abs(R.y), 3.0) * 0.42;
  e = e + bounceCol * obSstep(0.2, -0.9, R.y) * 0.16;
  return e;
}

// The stone: a slowly tumbling sphere whose radius carries a coarse relief and
// a finer grain, both centred so the fbm neither inflates nor shrinks it.
fn obSdf(p: vec3<f32>, t: f32, stone: f32, relief: f32, grain: f32) -> f32 {
  let q = obRotX(obRotY(p, t * 0.11), 0.35 + 0.10 * sin(t * 0.09));
  return length(q) - stone
       - (obFbm(q * 2.4) - 0.5) * relief
       - (obFbm(q * 5.1) - 0.5) * grain;
}

fn obNrm(p: vec3<f32>, t: f32, stone: f32, relief: f32, grain: f32) -> vec3<f32> {
  let e = vec2<f32>(0.004, 0.0);
  return normalize(vec3<f32>(
    obSdf(p + e.xyy, t, stone, relief, grain) - obSdf(p - e.xyy, t, stone, relief, grain),
    obSdf(p + e.yxy, t, stone, relief, grain) - obSdf(p - e.yxy, t, stone, relief, grain),
    obSdf(p + e.yyx, t, stone, relief, grain) - obSdf(p - e.yyx, t, stone, relief, grain)));
}

fn orbObsidianAnim(uv01: vec2<f32>) -> vec4<f32> {
  // The runner hands uv01 with y down from the top, like stitchable MSL's
  // `position`; the orb was authored bottom-left, so flip back.
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let t  = u.time * u.speed;
  let tn = u.tint.rgb;

  let wallA = u.wallColor.rgb;
  let wallB = u.wallTint.rgb;
  let lampA = u.lampAColor.rgb;
  let lampB = u.lampBColor.rgb;

  let su = (uv - u.center) / max(u.radius, 0.05);
  let r  = length(su);

  var col = obStudioBG(uv, wallA, wallB, lampA, lampB);
  col = col + tn * exp(-max(r - 1.0, 0.0) * 7.0) * 0.05 * u.glow;

  if (r < 1.004 + mfEdgeD(u.edgeSoftness)) {
    let m = obSstep(1.0 + mfEdgeD(u.edgeSoftness), 1.0 - u.edgeSoftness, r);
    let z = sqrt(max(1.0 - r * r, 0.0));
    let N = vec3<f32>(su, z);
    let F = obSchlick(z, 0.045);
    let D = obRefract(vec3<f32>(0.0, 0.0, -1.0), N, 1.0 / 1.52);
    let bg = obBgThrough(uv, N, wallA, wallB, lampA, lampB);

    // March from just inside the front face to wherever the glass ends.
    let P0 = N * 0.997;
    let exitT = obSphExit(P0, D);
    var tm: f32 = 0.012;
    var hit: f32 = 0.0;
    var hp = P0;
    for (var i: i32 = 0; i < 44; i = i + 1) {
      hp = P0 + D * tm;
      let d = obSdf(hp, t, u.stone, u.relief, u.grain);
      if (d < 0.0030) { hit = 1.0; break; }
      tm = tm + max(d * 0.55, 0.006);
      if (tm > exitT) { break; }
    }

    var inner = bg;
    if (hit > 0.5) {
      let Nm = obNrm(hp, t, u.stone, u.relief, u.grain);
      let V = -D;
      let R = reflect(D, Nm);
      let fr = pow(1.0 - max(dot(Nm, V), 0.0), 3.2);
      let e = obEnvMirror(uv, R, 1400.0, u.sheen, u.bounceColor.rgb,
                          wallA, wallB, lampA, lampB,
                          u.keyColor.rgb, u.keyMidColor.rgb, u.keyWideColor.rgb,
                          u.envColor.rgb, u.envTint.rgb);
      // Ambient is a normalised swatch times the 0.020 it was divided by.
      inner = u.ambientColor.rgb * 0.020 + e * (0.06 + 0.60 * fr);
      inner = inner + u.rimColor.rgb * fr * 0.30;
      inner = inner + u.stoneSpecColor.rgb * pow(max(dot(Nm, normalize(normalize(vec3<f32>(-0.60, 0.64, 0.48)) + V)), 0.0), 260.0) * 2.6;
      inner = inner * (0.45 + 0.55 * smoothstep(-0.85, 0.40, Nm.y));
    } else {
      inner = inner + tn * obFbm(hp * 2.0 + obKnead(t, 0.13, 0.11, 0.09, 1.9) * 0.32) * 0.05;
    }
    inner = inner * exp(-pow(1.0 - z, 2.0) * 0.60);

    var c = inner * (1.0 - F) * (0.35 + 0.65 * u.glow);
    c = c + obGlassHi(N, su, z, u.glassColor.rgb, u.specColor.rgb,
                      u.softboxColor.rgb, u.lobeColor.rgb, u.limbColor.rgb);
    col = mix(col, c, m);
  }

  col = pow(obAces(col * max(u.exposure, 0.0)), vec3<f32>(1.0 / 2.2));
  // The Orbs edge bank — the Edge group's Glow. Adding zero is exactly
  // the render this file was diffed against, and zero is the default.
  let edged = mfEdgeGlow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), uv, u.center, max(u.radius, 0.05),
                         u.edgeSoftness, u.edgeGlow, u.glowColor.rgb);
  return vec4<f32>(clamp(edged, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
