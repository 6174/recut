// Solar Flare — the sheet's 14 · Solar Flare, the halo orb.
//
// "White-hot center with a strong outer halo — a small sun." The silhouette
// holds still while the liquid inside churns: every point rides its own small
// circle once per loop, so the loop closes with no jump. Two warp fields (a slow
// one on the loop's own angle, a finer one running the other way) displace a
// marbled four-octave value-noise field; the scalar that comes out is graded
// through a THREE-stop Oklab ramp — flare orange, gold, then a corona white —
// dispersed per channel at the rim, rotated in hue by a shimmer term, lit by a
// rim light and a glint, and closed with a disc feather.
//
// WHAT MAKES IT A SUN RATHER THAN A BALL: `halo` 0.6 is the strongest on the
// shelf and `innerGlow` 0.85 the deepest, and the two work as a pair — the inner
// glow bleaches the lit shoulder to white while the halo throws light past the
// limb, so the eye reads a body burning rather than a body being lit.
//
// TWO DIFFERENT HALOS LIVE IN THIS FILE, do not confuse them:
//
//  * `halo` (default 0.6) is the SHEET's own term, painted by this shader
//    OUTSIDE the limb between `Rl` and `haloOuter`, tinted from `colorA` lifted
//    and desaturated — see the block near the bottom. It is part of the
//    transcription and is on by default because CFG[13] has it on.
//  * `edgeGlow` (default 0) is the shared Orbs Edge bank's Glow — `mfEdgeGlow`,
//    the last line, tinted by `glowColor`. It is a pure addition across all
//    seventeen orbs and adds exactly zero at its default.
//
// Transcribed from the Claude Design sheet "Liquid Orbs", screen 14 (Solar
// Flare), on its CFG[13], motion engine 0. Every constant is the sheet's — the
// hash pair (127.1, 311.7) and its 34.56, the four octaves at gain 0.5 with the
// (1.6,1.2,-1.2,1.6) inter-octave rotation and NO weight-sum normalisation, the
// 1.05/0.85/2.7/3.1 warp field scales, the 0.55+0.9 and 0.45+0.9 amplitudes, the
// 0.020/0.014/0.010 wobble lobes, the 0.045 shade, the 0.40 glow offset and its
// 2.6 falloff, the 0.05 dispersion step, the 0.006 rim aberration, the pow-48
// specular, the 0.85/2.4 halo. Each parameter's default IS the constant it
// replaced: `contrast` is CFG[13].cont, `flow` is its flow, `light` is its light,
// `seed` (13) is its seed. `radius` (0.86) is the sheet's own R0. Only `speed`,
// `grain` and `exposure` are new, and all three default to 1, where they are the
// identity.
//
// One idea, three files: orb-solar-flare.metal (what an iOS user exports), this
// one (what the browser preview runs) and orb-solar-flare.sksl (the React Native
// half). Same maths in three spellings — change one and change all three, or the
// Code tab starts lying about what it ships.
//
// TWO THINGS THAT LOOK LIKE BUGS AND ARE THE SOURCE:
//
//  1. `lqoLab2Lin`'s GREEN row carries -0.7034186147 where the published OKLab
//     inverse has -0.3413193965 — the blue row's middle coefficient, copied up.
//     That matrix is what all twenty of the sheet's orbs were rendered with, so
//     it is transcribed verbatim. It is why a #FF6D00 stop paints as #FF5B00:
//     the green channel is crushed and the ball is hotter than its swatch.
//     "Fixing" it would make this port stop matching the design.
//  2. `lqoFbm` does not divide by its weight sum. The sheet's other noise banks
//     do; this one doesn't, so the field tops out near 0.94 rather than 1, which
//     is exactly what `contrast` and `bias` were tuned against.
//
// Deliberately NOT ported from the sheet: the other nineteen CFG entries and the
// five alternate motion engines behind `uMode` (they would ship as dead shaders
// in one file — screen 19 is its own effect, orb-lava-lamp); the per-tile clock
// offset `0.17 * i`, which is a phase and not a difference in maths; and the
// sheet's own `uSoftPx`, folded into the constant below because the Orbs family
// already carries an `Edge softness` and two sliders for one feather is one too
// many.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering: twenty-three floats back to back after
// `time` (which lands `light` on an 8-byte boundary and the colours on a
// 16-byte one with no padding at all), then the float2, then the colours.
struct Uniforms {
  size:         vec2<f32>,
  time:         f32,
  speed:        f32,
  radius:       f32,
  flow:         f32,
  turbulence:   f32,
  scale:        f32,
  marble:       f32,
  wobble:       f32,
  shimmer:      f32,
  refraction:   f32,
  contrast:     f32,
  bias:         f32,
  fringe:       f32,
  iridescence:  f32,
  rim:          f32,
  glint:        f32,
  innerGlow:    f32,
  halo:         f32,
  grain:        f32,
  seed:         f32,
  exposure:     f32,
  edgeSoftness: f32,
  edgeGlow:     f32,
  paletteCount: f32,
  light:        vec2<f32>,
  colorA:       vec4<f32>,
  colorB:       vec4<f32>,
  colorC:       vec4<f32>,
  rimColor:     vec4<f32>,
  glintColor:   vec4<f32>,
  iridColor:    vec4<f32>,
  glowColor:    vec4<f32>,
  paletteStop0:  vec4<f32>,
  paletteStop1:  vec4<f32>,
  paletteStop2:  vec4<f32>,
  paletteStop3:  vec4<f32>,
  paletteStop4:  vec4<f32>,
  paletteStop5:  vec4<f32>,
  paletteStop6:  vec4<f32>,
  paletteStop7:  vec4<f32>,
  paletteStop8:  vec4<f32>,
  paletteStop9:  vec4<f32>,
  paletteStop10: vec4<f32>,
  paletteStop11: vec4<f32>,
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


const LQO_PI2: f32 = 6.28318530718;

// The sheet's per-orb constants that stayed constants. `LQO_LOOP` is CFG[13]'s
// loop length in seconds (the `speed` slider divides it); `LQO_SOFT` is its
// `soft`, the edge feather in pixels — the widest of the five, which is part of
// why the limb reads as light rather than as an edge; `LQO_GRAIN` is its
// `grain`, which the Grain slider multiplies exactly as the sheet's own `grain`
// prop did.
const LQO_LOOP:  f32 = 7.5;
const LQO_SOFT:  f32 = 2.0;
const LQO_GRAIN: f32 = 0.05;

fn lqoHash(pIn: vec2<f32>) -> f32 {
  var p = fract(pIn * vec2<f32>(127.1, 311.7));
  p = p + vec2<f32>(dot(p, p + vec2<f32>(34.56)));
  return fract(p.x * p.y);
}

fn lqoNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(lqoHash(i), lqoHash(i + vec2<f32>(1.0, 0.0)), w.x),
             mix(lqoHash(i + vec2<f32>(0.0, 1.0)), lqoHash(i + vec2<f32>(1.0, 1.0)), w.x),
             w.y);
}

// Four octaves, gain 0.5, no normalisation. The sheet rotates the domain by
// `mat2(1.6,1.2,-1.2,1.6)`; GLSL reads that column-major — columns (1.6,1.2)
// and (-1.2,1.6) — so the product is (1.6x - 1.2y, 1.2x + 1.6y), not the
// transpose a reader supplies from habit. Written out by hand in all three
// files for exactly that reason.
fn lqoFbm(pIn: vec2<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * lqoNoise(p);
    p = vec2<f32>(1.6 * p.x - 1.2 * p.y, 1.2 * p.x + 1.6 * p.y);
    a = a * 0.5;
  }
  return v;
}

fn lqoSrgb(cIn: vec3<f32>) -> vec3<f32> {
  let c = clamp(cIn, vec3<f32>(0.0), vec3<f32>(1.0));
  return mix(12.92 * c,
             1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055),
             step(vec3<f32>(0.0031308), c));
}

// sRGB -> OKLab. The sheet did this on the CPU (`_okl`, on each palette hex)
// and handed the shader Oklab uniforms; our colours arrive as ordinary sRGB
// params, so the conversion moves into the shader. Same arithmetic, same
// coefficients; `pow(x, 1/3)` stands in for JS's `Math.cbrt` (the argument is a
// linear-light value and can never be negative here).
fn lqoOkl(cs: vec3<f32>) -> vec3<f32> {
  let hi = pow((cs + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  let lo = cs / 12.92;
  // `step(cs, 0.04045)` is 1 exactly where the sheet's `v <= 0.04045` is true.
  // Spelled with step rather than a comparison so all three files read the same
  // — SkSL has no vector-conditional select.
  let lin = mix(hi, lo, step(cs, vec3<f32>(0.04045)));
  let l = pow(dot(vec3<f32>(0.4122214708, 0.5363325363, 0.0514459929), lin), 1.0 / 3.0);
  let m = pow(dot(vec3<f32>(0.2119034982, 0.6806995451, 0.1073969566), lin), 1.0 / 3.0);
  let s = pow(dot(vec3<f32>(0.0883024619, 0.2817188376, 0.6299787005), lin), 1.0 / 3.0);
  return vec3<f32>(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
                   1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                   0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}

// OKLab -> linear sRGB, the sheet's own matrix. See the header: the green row's
// middle coefficient is the blue row's. Verbatim on purpose.
fn lqoLab2Lin(c: vec3<f32>) -> vec3<f32> {
  let l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  let m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  let s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  let L = vec3<f32>(l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_);
  return vec3<f32>(dot(vec3<f32>( 4.0767416621, -3.3077115913,  0.2309699292), L),
                   dot(vec3<f32>(-1.2684380046,  2.6097574011, -0.7034186147), L),
                   dot(vec3<f32>(-0.0041960863, -0.7034186147,  1.7076147010), L));
}

// The sheet's `pal(x)`, unrolled for this orb's THREE stops. With `uNC == 3` the
// general form's `n` is 2, so the parameter walks two segments: `i` picks A→B or
// B→C and `ff` is the position within whichever it picked. The per-segment chroma
// boost `1 + 0.5*f*(1-f)` rides on top and is what gives the gold band its bite.
//
// SELECTED, never branched — same reason as the ramp line below.
fn lqoPal(x: f32, A: vec3<f32>, B: vec3<f32>, C: vec3<f32>) -> vec3<f32> {
  let s  = clamp(x, 0.0, 1.0) * 2.0;
  let i  = min(floor(s), 1.0);
  let ff = s - i;
  let f  = ff * ff * (3.0 - 2.0 * ff);
  let a  = select(B, A, i < 0.5);
  let b  = select(C, B, i < 0.5);
  let c  = mix(a, b, f);
  let k  = 1.0 + 0.5 * f * (1.0 - f);
  return vec3<f32>(c.x, c.y * k, c.z * k);
}

fn orbSolarFlareAnim(uv01: vec2<f32>) -> vec4<f32> {
  // The runner hands uv01 with y down from the top, like stitchable MSL's
  // `position`; the sheet composed on a bottom-left gl_FragCoord, so flip back.
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  // The sheet normalised by `uRes.y` on a square canvas. The Orbs family
  // normalises by the SHORT side, which is the same number there and is what
  // the preview's coverage-to-alpha pass recomputes, so the disc it derives
  // sits on the ball at any aspect.
  let mn = max(min(u.size.x, u.size.y), 1.0);
  let uv = (2.0 * fc - u.size) / mn;

  let R0 = max(u.radius, 0.05);
  let rr = length(uv);

  let px = 2.0 / mn;
  let aa = px * max(1.25, LQO_SOFT);
  // The halo's outer edge. The sheet wrote 0.985 against its fixed R0 of 0.86;
  // as `R0 + 0.125` that is the same number at the default and stays a band of
  // constant width once Radius moves, instead of inverting when R0 passes it.
  // On this orb the band is doing real work — `halo` ships at 0.6 — so the
  // early-out below has to reach it.
  let haloOuter = R0 + 0.125;

  // Nothing on this pixel: past the outermost of the disc's own feather and the
  // halo's outer edge, `aEdge` and `haloA` are both EXACTLY zero and the full
  // path returns black after computing the entire fluid. The wobble bound is
  // its three lobes' amplitudes summed (0.020 + 0.014 + 0.010), so this is a
  // uniform-only expression — no per-pixel value enters it.
  //
  // Written on `uv`, before the ball-space divide, and deliberately not on a
  // radius derived after it: splitting the basic block once `pn`/`sN` exist
  // stops the compiler folding `uv / Rl` into its uses, and the last bit that
  // moves comes back through the grain hash as speckle. Same measurement every
  // orb in this family carries.
  let rMax = max(R0 * (1.0 + u.wobble * 0.044) + aa, haloOuter) + mfEdgeD(u.edgeSoftness);
  if (rr > rMax) {
    // Off the ball and past its halo — but the Edge bank's Glow lives out here,
    // so hand back what it paints on nothing. Exactly black at Glow 0.
    return vec4<f32>(clamp(mfEdgeGlow(vec3<f32>(0.0), uv, vec2<f32>(0.0), R0,
                                      u.edgeSoftness, u.edgeGlow, u.glowColor.rgb),
                           vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
  }

  // The clock. The sheet advanced `phase` by `dt * speed / loop` and wrapped it,
  // so `speed` is a rate multiplier and 1 is the sheet's own rate. Wrapping here
  // too keeps ANG in [0, 2π) — which the grain frame index needs — and keeps the
  // trig accurate however long the timeline has been running.
  let ph  = fract(u.time * u.speed / LQO_LOOP);
  let ANG = LQO_PI2 * ph;

  // The silhouette wobble: three lobes travelling the rim at different speeds
  // and in different directions while the core holds still.
  let th  = atan2(uv.y, uv.x);
  let wob = u.wobble * (0.020 * sin(3.0 * th - ANG + 0.7)
                      + 0.014 * sin(5.0 * th + 2.0 * ANG + 2.1)
                      + 0.010 * sin(7.0 * th - 3.0 * ANG + 4.4));
  let Rl  = R0 * (1.0 + wob);

  let sN = rr / Rl;
  let z  = sqrt(max(1.0 - sN * sN, 0.0));
  let pn = uv / Rl;
  let pu = normalize(pn + vec2<f32>(1e-5, 0.0));
  let Ld = normalize(u.light);

  // Refraction pulls the sampled field toward the centre as the sphere turns
  // away, which is what makes the liquid read as being INSIDE glass.
  let q0 = pn * mix(1.0, 0.55 + 0.45 * z, u.refraction * 0.8);
  let q  = q0 + vec2<f32>(u.seed * 11.17, u.seed * 5.31);

  // The churn. Each point rides a circle of its own radius and phase once per
  // loop (o1), with a finer counter-rotating one over it (o2); the sum warps a
  // marbled fbm. Because both offsets are periodic in ANG, the loop closes.
  let ph1 = LQO_PI2 * lqoFbm(q * 1.05 + vec2<f32>(3.7, 17.3));
  let am1 = 0.55 + 0.9 * lqoFbm(q * 0.85 + vec2<f32>(27.1, 9.4));
  let o1  = u.flow * am1 * vec2<f32>(cos(ANG + ph1), sin(ANG + ph1));
  let ph2 = LQO_PI2 * lqoFbm(q * 2.7 + vec2<f32>(43.9, 5.2));
  let am2 = 0.45 + 0.9 * lqoFbm(q * 3.1 + vec2<f32>(8.8, 31.7));
  let o2  = u.turbulence * am2 * vec2<f32>(cos(ph2 - ANG), sin(ph2 - ANG));
  let wp  = (q + o1 + o2) * u.scale;
  let n1  = lqoFbm(wp + u.marble * vec2<f32>(lqoFbm(wp + vec2<f32>(5.2, 1.3)),
                                             lqoFbm(wp + vec2<f32>(9.7, 8.1))));

  let x = (n1 - 0.5) * u.contrast + 0.5 + u.bias;

  // Shimmer rotates the whole colour's chroma in Oklab, once per loop, by an
  // amount that itself varies across the ball.
  let shim = u.shimmer * sin(ANG + LQO_PI2 * lqoFbm(q * 0.75 + vec2<f32>(61.3, 2.9)));
  let cs = cos(shim);
  let sn = sin(shim);

  // Chromatic dispersion, fenced to the outer half of the disc where a real
  // lens would put it.
  let band = smoothstep(0.45, 1.0, sN);
  let fr   = u.fringe * band;

  let shade = 0.045 * sN * dot(pu, Ld);
  let gp    = -Ld * 0.40;
  let glow  = u.innerGlow * exp(-dot(pn - gp, pn - gp) * 2.6);
  let ib    = clamp(u.iridescence * smoothstep(0.55, 0.95, sN)
                    * (0.6 + 0.4 * sin(2.0 * th + ANG)), 0.0, 1.0);

  // The palette's stops and this orb's own three, both in hand. The stops stay
  // in sRGB and are converted after the ramp reads them, which costs three
  // conversions rather than twelve.
  let pal = mfRampOf(u.paletteCount,
                     u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                     u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                     u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                     u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb);
  let oklA = lqoOkl(u.colorA.rgb);
  let oklB = lqoOkl(u.colorB.rgb);
  let oklC = lqoOkl(u.colorC.rgb);
  let iridAB = lqoOkl(u.iridColor.rgb).yz;

  // The sheet's three-channel loop, unrolled: red, green and blue each read the
  // ramp at their own offset, so the grade itself splits into fringes at the
  // rim. Everything between the read and `lab2lin` happens in Oklab.
  //
  // The palette IS this ramp. SELECTED, never branched: an `if` here splits the
  // basic block and the grain hash below turns that into speckle. Zero stops is
  // the default and takes the sheet's own branch, so an untouched orb is
  // bit-identical to the render this file was diffed against.
  var lin = vec3<f32>(0.0);
  let off0 = -0.05 * fr;
  let off2 =  0.05 * fr;

  var L3 = lqoPal(x + off0, oklA, oklB, oklC);
  L3 = select(L3, lqoOkl(mfRampLinR(x + off0, pal)), u.paletteCount > 0.5);
  L3 = vec3<f32>(L3.x, cs * L3.y - sn * L3.z, sn * L3.y + cs * L3.z);
  L3 = vec3<f32>(L3.x + shade + 0.10 * glow + 0.04 * ib, L3.y, L3.z);
  L3 = vec3<f32>(L3.x, L3.y * (1.0 - 0.45 * glow), L3.z * (1.0 - 0.45 * glow));
  L3 = vec3<f32>(L3.x, mix(L3.y, iridAB.x, ib), mix(L3.z, iridAB.y, ib));
  lin.x = lqoLab2Lin(L3).x;

  L3 = lqoPal(x, oklA, oklB, oklC);
  L3 = select(L3, lqoOkl(mfRampLinR(x, pal)), u.paletteCount > 0.5);
  L3 = vec3<f32>(L3.x, cs * L3.y - sn * L3.z, sn * L3.y + cs * L3.z);
  L3 = vec3<f32>(L3.x + shade + 0.10 * glow + 0.04 * ib, L3.y, L3.z);
  L3 = vec3<f32>(L3.x, L3.y * (1.0 - 0.45 * glow), L3.z * (1.0 - 0.45 * glow));
  L3 = vec3<f32>(L3.x, mix(L3.y, iridAB.x, ib), mix(L3.z, iridAB.y, ib));
  lin.y = lqoLab2Lin(L3).y;

  L3 = lqoPal(x + off2, oklA, oklB, oklC);
  L3 = select(L3, lqoOkl(mfRampLinR(x + off2, pal)), u.paletteCount > 0.5);
  L3 = vec3<f32>(L3.x, cs * L3.y - sn * L3.z, sn * L3.y + cs * L3.z);
  L3 = vec3<f32>(L3.x + shade + 0.10 * glow + 0.04 * ib, L3.y, L3.z);
  L3 = vec3<f32>(L3.x, L3.y * (1.0 - 0.45 * glow), L3.z * (1.0 - 0.45 * glow));
  L3 = vec3<f32>(L3.x, mix(L3.y, iridAB.x, ib), mix(L3.z, iridAB.y, ib));
  lin.z = lqoLab2Lin(L3).z;

  // The rim light, with its own per-channel radius scale — the sheet's only
  // other source of colour, and a GENERATED one: at Fringes 0 the three scales
  // collapse to 1 and the rim is exactly `rimColor`, at 1 it splits into a
  // spectrum. That is why it owes the panel a swatch as well as the slider.
  let eSc = vec3<f32>(1.0) + u.fringe * vec3<f32>(0.006, 0.0, -0.006);
  let aEdge = 1.0 - smoothstep(-aa - mfEdgeD(u.edgeSoftness),
                                aa + mfEdgeD(u.edgeSoftness), rr - Rl);
  let rim3 = u.rim * vec3<f32>(pow(smoothstep(0.55, 1.0, rr / (Rl * eSc.x)), 4.0),
                               pow(smoothstep(0.55, 1.0, rr / (Rl * eSc.y)), 4.0),
                               pow(smoothstep(0.55, 1.0, rr / (Rl * eSc.z)), 4.0));

  let nrm  = vec3<f32>(pn.x, pn.y, z);
  let H    = normalize(vec3<f32>(Ld * 0.85, 0.55));
  let spec = pow(max(dot(nrm, H), 0.0), 48.0) * u.glint * (0.4 + 0.6 * z);
  lin = lin + rim3 * u.rimColor.rgb + spec * u.glintColor.rgb;

  // `exposure` is the family's universal knob and multiplies the light itself,
  // so 1 is the untouched render.
  var col = lqoSrgb(max(lin * max(u.exposure, 0.0), vec3<f32>(0.0)));

  // Grain, in display space and quantised to 24 frames per loop so it reads as
  // film rather than as a per-frame fizz.
  let grainF = floor(ph * 24.0);
  let g = lqoHash(floor(fc) + vec2<f32>(grainF * 17.13, grainF * 7.77)) - 0.5;
  col = col + vec3<f32>(g * LQO_GRAIN * u.grain);

  // THE SHEET'S HALO — the one that makes this a small sun. Painted OUTSIDE the
  // disc, between the limb and `haloOuter`, tinted with the body colour lifted
  // and desaturated, so it follows `colorA`'s swatch (at the default that is
  // #FF6D00 → a lifted #FF8760). Unlike every other orb on the shelf this ships
  // ON, at CFG[13]'s 0.6. It is NOT the Edge bank's Glow, which is added last
  // and is still zero by default.
  let w = clamp(1.0 - (rr - Rl) / max(haloOuter - Rl, 1e-4), 0.0, 1.0);
  let haloA = select(0.0, u.halo * 0.85 * pow(w, 2.4), u.halo > 0.001 && rr > Rl);
  var hc = lqoOkl(u.colorA.rgb);
  hc = vec3<f32>(min(1.0, hc.x + 0.12), hc.y * 0.85, hc.z * 0.85);
  let haloRGB = lqoSrgb(max(lqoLab2Lin(hc), vec3<f32>(0.0)));

  // The sheet drew this canvas premultiplied over the page; we paint over
  // nothing, so the multiply IS that composite and everything outside the ball
  // is exactly 0 — which is what the runner's coverage-to-alpha pass needs to
  // let the page through.
  var out = col * aEdge + haloRGB * (haloA * (1.0 - aEdge));
  // The Orbs edge bank — the Edge group's Glow. Adding zero is exactly the
  // render this file was diffed against, and zero is the default.
  out = mfEdgeGlow(out, uv, vec2<f32>(0.0), R0,
                   u.edgeSoftness, u.edgeGlow, u.glowColor.rgb);
  return vec4<f32>(clamp(out, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
