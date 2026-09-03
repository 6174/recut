// Struck Film — capillary wave packets landing on a thin film, rainbow fronts colliding.
//
// Every colour in the shader is a parameter: the halo, the two ends of the body
// ramp, the two ends of the fresnel rim ramp, the white spike on the glint, and
// the tint on the interference itself. The rainbow is a parameter too — see
// `spectrum` on sfInterf.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering. The nine floats sit back to back and
// land exactly on a 16-byte boundary, so `haloColor` follows with no pad — the
// packer computes the same. The seven colours then run back to back on 16.
// There is no float2 on this effect.
struct Uniforms {
  size:      vec2<f32>,
  time:      f32,
  speed:     f32,
  radius:    f32,
  detail:    f32,
  ripple:    f32,
  impact:    f32,
  rim:       f32,
  glow:      f32,
  exposure:  f32,
  spectrum:  f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  haloColor: vec4<f32>,
  deepColor: vec4<f32>,
  bodyColor: vec4<f32>,
  rimColor:  vec4<f32>,
  rimTint:   vec4<f32>,
  specColor: vec4<f32>,
  filmColor: vec4<f32>,
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
// WGSL leaves that indeterminate, so the disc mask spells the formula out.
fn sfSstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn sfHash(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

fn sfNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = sfHash(i);
  let b = sfHash(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = sfHash(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = sfHash(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = sfHash(i + vec3<f32>(0.0, 0.0, 1.0));
  let g = sfHash(i + vec3<f32>(1.0, 0.0, 1.0));
  let j = sfHash(i + vec3<f32>(0.0, 1.0, 1.0));
  let k = sfHash(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

fn sfFbm(pIn: vec3<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * sfNoise(p);
    p = p * 2.03 + vec3<f32>(7.1, 3.7, 1.3);
    a = a * 0.5;
  }
  return v;
}

// Thin-film interference: one optical thickness in, three cosines out, with the
// path lengthened at grazing angles so the limb runs a different order.
//
// The triple (1.0, 1.31, 1.68) is a set of per-channel wavelengths — it is what
// makes the fronts read as a rainbow, so it is a knob, not a constant. `spec`
// interpolates the three frequencies toward one shared frequency of 1.0: at 1
// the vector is exactly the original triple (1 + (A - 1) * 1 == A, bit for bit),
// at 0 all three channels band together and the interference goes monochrome
// with the pattern intact, and above 1 the channels separate further.
fn sfInterf(th: f32, ca: f32, spec: f32) -> vec3<f32> {
  let d = th * (1.0 + (1.0 - ca) * 0.9);
  let baseF = vec3<f32>(1.0, 1.31, 1.68);
  let freq  = vec3<f32>(1.0) + (baseF - vec3<f32>(1.0)) * spec;
  return vec3<f32>(0.5) - 0.5 * cos(6.2831 * d * freq);
}

// Where the next packet lands: a hashed azimuth and a hashed latitude band,
// lifted back onto the unit sphere.
fn sfDropPt(seed: f32) -> vec3<f32> {
  let a = fract(sin(seed * 12.9898) * 43758.5453) * 6.2831;
  let b = fract(sin(seed * 39.3468) * 24634.6345) * 1.7 - 0.85;
  let s = sqrt(max(1.0 - b * b, 0.0));
  return vec3<f32>(s * cos(a), b, s * sin(a));
}

fn orbStruckFilmAnim(uv01: vec2<f32>) -> vec4<f32> {
  // The runner hands uv01 with y down from the top, like stitchable MSL's
  // `position`; the orb was authored bottom-left, so flip back.
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let t   = u.time * u.speed;
  let rad = max(u.radius, 0.05);
  let r   = length(uv);

  var col = u.haloColor.rgb * exp(-max(r - rad, 0.0) * 12.0) * 0.30 * u.glow;

  // The film is evaluated for EVERY fragment, not only the ones on the disc:
  // `crease` is an fwidth of the thickness, and WGSL only allows a derivative
  // in uniform control flow. `m` is zero off the disc, so the mix at the end
  // throws the work away exactly where the original's `if` skipped it.
  let m   = sfSstep(rad + mfEdgeD(u.edgeSoftness), rad - u.edgeSoftness, r);
  let z   = sqrt(max(rad * rad - r * r, 0.0));
  let nrm = vec3<f32>(uv, z) / rad;
  let ca  = nrm.z;

  // Incommensurate sines: the film kneads in place, never drifts.
  let o1 = vec3<f32>(sin(t * 0.16) + 0.6 * sin(t * 0.071 + 1.3),
                     cos(t * 0.13) + 0.6 * cos(t * 0.062 + 0.8),
                     sin(t * 0.10 + 3.1)) * 0.5;
  let base = sfFbm(nrm * u.detail + o1) * 1.5;
  var th   = base + sin(t * 0.12) * 0.3;

  // Four packets in flight, each on its own period so they never re-sync.
  var ringE: f32 = 0.0;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    let fi   = f32(i);
    let per  = 7.0 + fi * 2.3;
    let ph   = t / per + fi * 0.41;
    let lt   = fract(ph);
    let seed = floor(ph) * 3.7 + fi * 11.0;
    let cp   = sfDropPt(seed);
    let d    = acos(clamp(dot(nrm, cp), -1.0, 1.0));
    let R    = lt * 2.4;
    let amp  = exp(-lt * 2.6) * smoothstep(0.0, 0.05, lt);
    th    = th + cos((d - R) * u.ripple) * exp(-abs(d - R) * (4.5 - 2.5 * lt)) * amp * u.impact;
    ringE = max(ringE, exp(-abs(d - R) * 9.0) * amp);
  }

  let crease = clamp(fwidth(th) * 6.0, 0.0, 1.0);
  // Both consumers of `film` below read the tinted value; white is a no-op.
  let film   = sfInterf(th, ca, u.spectrum) * u.filmColor.rgb;
  let fres   = pow(1.0 - ca, 2.1);
  let glint  = pow(crease, 1.5) * (0.25 + 1.8 * fres) + ringE * 0.95;

  // The palette, bundled into one value. effects/_shared/ramp.ts.
  let pal = mfRampOf(u.paletteCount,
                     u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                     u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                     u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                     u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb);

  // The palette IS this ramp — and it is the BODY's ramp, not the film's.
  // That is measured, not assumed: this orb's interference only ever paints
  // the fringe lines where the film folds, so a colour put there reaches
  // 1-3% of the ball and reads as nothing having happened. The body is the
  // other ~80%. The fringes keep their own rainbow, which is this orb's
  // whole character, and `filmColor` plus Spectrum still steer them.
  // SELECTED, never branched (effects/_shared/ramp.ts).
  let bodyT = smoothstep(-0.9, 1.0, uv.x * 0.4 - uv.y * 0.5 + base * 0.5);
  let deep = select(mix(u.deepColor.rgb, u.bodyColor.rgb, bodyT),
                    mfRampLinR(bodyT, pal), u.paletteCount > 0.5);
  // Both ends of the fresnel ramp are params; the defaults are the original
  // constants quantised to hex (#1A66FF and #D940FF).
  let rimc = mix(u.rimColor.rgb, u.rimTint.rgb,
                 smoothstep(-0.8, 0.8, uv.x + uv.y * 0.3));

  var c2 = deep;
  c2 = c2 + film * glint * u.glow;
  c2 = c2 + film * fres * fres * 0.5 * u.glow;
  c2 = c2 + rimc * fres * u.rim;
  c2 = c2 + u.specColor.rgb * pow(glint * fres, 2.5) * 3.0;
  col = mix(col, c2, m);

  col = vec3<f32>(1.0) - exp(-col * 1.8 * max(u.exposure, 0.0));
  // The Orbs edge bank — the Edge group's Glow. Adding zero is exactly
  // the render this file was diffed against, and zero is the default.
  let edged = mfEdgeGlow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), uv, vec2<f32>(0.0), rad,
                         u.edgeSoftness, u.edgeGlow, u.glowColor.rgb);
  return vec4<f32>(clamp(edged, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
