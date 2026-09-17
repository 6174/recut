// Nebula Orb — warm billowing volume around an off-centre ember of a sun.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering. The seven floats sit back to back,
// `core` takes the next 8-byte slot, and WGSL then pads to put `deepColor` on a
// 16-byte boundary — the packer mirrors both gaps. The eleven colours then run
// back to back on 16, palette stops first and the six later additions after.
struct Uniforms {
  size:       vec2<f32>,
  time:       f32,
  speed:      f32,
  radius:     f32,
  density:    f32,
  coreSize:   f32,
  rim:        f32,
  glow:       f32,
  exposure:   f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  core:       vec2<f32>,
  deepColor:  vec4<f32>,
  midColor:   vec4<f32>,
  flameColor: vec4<f32>,
  hotColor:   vec4<f32>,
  coreColor:  vec4<f32>,
  haloColor:      vec4<f32>,
  haloTintColor:  vec4<f32>,
  emberGlowColor: vec4<f32>,
  ambientColor:   vec4<f32>,
  rimColor:       vec4<f32>,
  rimTintColor:   vec4<f32>,
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
// WGSL leaves that indeterminate, so both places spell the formula out.
fn nbSstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn nbHash(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

fn nbNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = nbHash(i);
  let b = nbHash(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = nbHash(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = nbHash(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = nbHash(i + vec3<f32>(0.0, 0.0, 1.0));
  let g = nbHash(i + vec3<f32>(1.0, 0.0, 1.0));
  let j = nbHash(i + vec3<f32>(0.0, 1.0, 1.0));
  let k = nbHash(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

fn nbFbm(pIn: vec3<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * nbNoise(p);
    p = p * 2.03 + vec3<f32>(7.1, 3.7, 1.3);
    a = a * 0.5;
  }
  return v;
}

// Four stops, deep through white-hot, crossfaded on fixed thresholds.
fn nbPal(x: f32, c0: vec3<f32>, c1: vec3<f32>, c2: vec3<f32>, c3: vec3<f32>) -> vec3<f32> {
  var c = mix(c0, c1, smoothstep(0.05, 0.38, x));
  c = mix(c, c2, smoothstep(0.40, 0.68, x));
  c = mix(c, c3, smoothstep(0.70, 0.94, x));
  return c;
}

fn orbNebulaAnim(uv01: vec2<f32>) -> vec4<f32> {
  // The runner hands uv01 with y down from the top, like stitchable MSL's
  // `position`; the orb was authored bottom-left, so flip back.
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let t   = u.time * u.speed;
  let rad = max(u.radius, 0.05);
  let r   = length(uv);

  // Outer halo: a vertical ramp between two tints, falling off outside the limb.
  var col = mix(u.haloColor.rgb, u.haloTintColor.rgb, vec3<f32>(0.5 + 0.5 * uv.y))
          * exp(-max(r - rad, 0.0) * 9.0) * 0.26 * u.glow;

  if (r < rad + 0.01 + mfEdgeD(u.edgeSoftness)) {
    let m  = nbSstep(rad + mfEdgeD(u.edgeSoftness), rad - u.edgeSoftness, r);
    let su = uv / rad;
    let z  = sqrt(max(1.0 - dot(su, su), 0.0));

    // Incommensurate sines: the volume kneads in place, never drifts.
    let k1 = vec3<f32>(sin(t * 0.16) + 0.55 * sin(t * 0.071 + 2.4),
                       cos(t * 0.13) + 0.55 * cos(t * 0.058 + 0.9),
                       sin(t * 0.10 + 3.7)) * 0.6;

    // The palette, bundled into one value, hoisted out of the march — it is a
    // read of thirteen uniforms and does not vary along the ray.
    // effects/_shared/ramp.ts.
    let pal = mfRampOf(u.paletteCount,
                       u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                       u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                       u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                       u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb);

    var acc = vec3<f32>(0.0);
    var T: f32 = 1.0;
    let N: i32 = 18;
    let dl = 2.0 * z / f32(N);
    for (var i: i32 = 0; i < N; i = i + 1) {
      let fz = z - (f32(i) + 0.5) * dl;
      let p  = vec3<f32>(su * (1.0 - 0.20 * (z - fz)), fz);
      let rr = length(p);
      let b  = nbFbm(p * 1.7 + k1);
      let w  = nbFbm(p * 1.15 + vec3<f32>(b * 1.8) + k1.zxy * 0.7);
      let dens = pow(smoothstep(0.30, 0.86, w), 1.6) * nbSstep(1.0, 0.5, rr) * u.density;
      let aa = 1.0 - exp(-dens * 5.5 * dl);
      let lit = 0.45 + 0.55 * max(dot(normalize(vec3<f32>(0.35, 0.25, 0.5) - p), vec3<f32>(0.0, 0.0, 1.0)), 0.0);
      // The palette IS this ramp — the four stops' own [0,1] parameter, so the
      // user's colours land where deep/mid/flame/hot did, however many there
      // are. SELECTED, never branched, and inside the march that matters twice
      // over: a branch here would split the loop body away from the two fbm
      // fields above it, whose hashes are `fract(sin(...))`.
      let px = clamp(w * 1.25 - rr * 0.30 + 0.08, 0.0, 1.0);
      let c = select(nbPal(px, u.deepColor.rgb, u.midColor.rgb,
                           u.flameColor.rgb, u.hotColor.rgb),
                     mfRampLinR(px, pal), u.paletteCount > 0.5) * lit;
      acc = acc + T * c * aa * 2.0;
      T   = T * (1.0 - aa * 0.86);
    }

    let off   = u.core;
    let gCore = exp(-dot(su - off, su - off) * max(u.coreSize, 0.01));
    acc = acc + u.coreColor.rgb * pow(gCore, 2.5) * 1.7 * u.glow * T;
    acc = acc + u.emberGlowColor.rgb * gCore * 0.40;   // wide bloom around the ember
    acc = acc + T * u.ambientColor.rgb;                // dark body tint the volume floats in

    let fres = pow(1.0 - z, 2.4);
    acc = acc + mix(u.rimColor.rgb, u.rimTintColor.rgb, vec3<f32>(0.5 + 0.5 * su.y)) * fres * 0.95 * u.rim;
    acc = acc * (0.2 + 0.8 * u.glow);
    col = mix(col, acc, m);
  }

  col = vec3<f32>(1.0) - exp(-col * 1.6 * max(u.exposure, 0.0));
  // The Orbs edge bank — the Edge group's Glow. Adding zero is exactly
  // the render this file was diffed against, and zero is the default.
  let edged = mfEdgeGlow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), uv, vec2<f32>(0.0), rad,
                         u.edgeSoftness, u.edgeGlow, u.glowColor.rgb);
  return vec4<f32>(clamp(edged, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
