// Lava Lamp — the sheet's 19 · Lava Lamp. ENGINE: METABALLS.
//
// Six discrete blobs — by default; the Lava group makes that a slider — on their
// own orbits, merging and splitting as they cross.
// Each blob carries its own radius, its own orbit radius and its own integer
// rate, so every one of them closes the loop exactly; the inverse-square field
// they sum is thresholded into a soft-edged mass, dusted with a little noise,
// and the scalar that comes out is graded through an Oklab ramp, dispersed per
// channel at the rim, rotated in hue by a shimmer term, lit by a rim light and a
// glint, and closed with a disc feather.
//
// Transcribed from the Claude Design sheet "Liquid Orbs", screen 19 (Lava Lamp),
// on its CFG[18] — the one entry whose `uMode` is 4, the sheet's METABALLS
// branch. This is the family's own orb shell with a different engine dropped
// into the single slot that produces `n1`: everything from
// `x = (n1 - 0.5) * contrast + 0.5 + bias` onward is the shell, constant for
// constant. Every constant is the sheet's — the hash pair (127.1, 311.7) and its
// 34.56, the four octaves at gain 0.5 with the (1.6,1.2,-1.2,1.6) inter-octave
// rotation and NO weight-sum normalisation, the six blobs and their 1.3 / 2.1
// hash strides, the seed offsets +2 and +7, the 0.34 orbit centre, the
// 0.16 + 0.22 orbit radius, the 0.14 + 0.12 blob radius, the 0.003 softening
// term, the 0.5/1.4 threshold and the 0.08 noise dust, the 0.020/0.014/0.010
// wobble lobes, the 0.045 shade, the 0.40 glow offset and its 2.6 falloff, the
// 0.05 dispersion step, the 0.006 rim aberration, the pow-48 specular, the
// 0.85/2.4 halo. Each parameter's default IS the constant it replaced:
// `contrast` is CFG[18].cont, `refraction` is its refr, `seed` is its seed (18),
// `light` is its light. `radius` (0.86) is the sheet's own R0. Only `speed`,
// `grain` and `exposure` are new, and all three default to 1, where they are the
// identity.
//
// One idea, three files: orb-lava-lamp.metal (what an iOS user exports), this
// one (what the browser preview runs) and orb-lava-lamp.sksl (the React Native
// half). Same maths in three spellings — change one and change all three, or the
// Code tab starts lying about what it ships.
//
// TWO THINGS THAT LOOK LIKE BUGS AND ARE THE SOURCE:
//
//  1. `lqoLab2Lin`'s GREEN row carries -0.7034186147 where the published OKLab
//     inverse has -0.3413193965 — the blue row's middle coefficient, copied up.
//     That matrix is what all twenty of the sheet's orbs were rendered with, so
//     it is transcribed verbatim. It is why the ball runs hotter than its
//     swatches: the green channel is crushed. "Fixing" it would make this port
//     stop matching the design.
//  2. `lqoFbm` does not divide by its weight sum. The sheet's other noise banks
//     do; this one doesn't, so the dust term is scaled against a field that tops
//     out near 0.94 rather than 1 — which is what `contrast` and `bias` were
//     tuned against.
//
// THREE THINGS IN THE ENGINE THAT ARE LOAD-BEARING:
//
//  1. `lqoBalls` is called on `q0`, the REFRACTED ball coordinate, and NOT on
//     `q`. The seed offset (`q = q0 + vec2(seed*11.17, seed*5.31)`) is still
//     computed and still used — by the shimmer term, alone. Both variables have
//     to stay. The engine takes its seed the other way, through `uSeed` inside
//     the hash, which is why moving Seed relays the blobs instead of sliding
//     them.
//  2. The sheet names the blob radius `rad`. That would shadow this catalog's
//     `radius` param, so it is renamed `br` here and in the other two files.
//     Same number, different spelling — do not rename it back.
//  3. Every blob orbits at an integer rate `k` in 1..3 (`floor(h1*3)+1`), so
//     each one closes the loop exactly at ANG = 2π. That, plus a loop bound
//     that is a compile-time constant (twelve, with `blobs` breaking out of it
//     early), is what keeps this engine portable to SkSL.
//
// Deliberately NOT ported from the sheet: the other nineteen CFG entries and the
// other five motion engines behind `uMode` (they would ship as dead shaders in
// one file — screen 01 is its own effect, orb-magenta); the per-tile clock
// offset `0.17 * i`, which is a phase and not a difference in maths; and the
// sheet's own `uSoftPx`, folded into the constant below because the Orbs family
// already carries an `Edge softness` and two sliders for one feather is one too
// many.
//
// NOT PARAMETERS, on purpose: `flow`, `turbulence`, `scale` and `marble`. They
// are the four knobs of the fbm-churn engine the rest of the family runs, and
// the metaball branch reads none of them — shipping them would be four sliders
// that move nothing.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic uniform
// packer can walk one ordering: TWENTY-TWO floats back to back after `time`,
// then the float2, then the colours. 12 + 22*4 = 100, so the packer aligns
// `light` up to 104 (four bytes of padding) and the colours to 112. WGSL's own
// alignment rules produce exactly the same gap, which is why the struct can be
// written without mentioning it — but the arithmetic is here because adding a
// scalar MOVES that padding, and a struct that disagrees with the packer renders
// a plausible wrong image rather than an error.
struct Uniforms {
  size:         vec2<f32>,
  time:         f32,
  speed:        f32,
  radius:       f32,
  blobs:        f32,
  blobSize:     f32,
  blobVary:     f32,
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

// The sheet's per-orb constants that stayed constants. `LQO_LOOP` is CFG[18]'s
// loop length in seconds (the `speed` slider divides it); `LQO_SOFT` is its
// `soft`, the edge feather in pixels; `LQO_GRAIN` is its `grain`, which the
// Grain slider multiplies exactly as the sheet's own `grain` prop did.
const LQO_LOOP:  f32 = 9.0;
const LQO_SOFT:  f32 = 1.8;
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

// The engine: the sheet's `modeBalls`, verbatim.
//
// Six blobs, each with a hashed home (`c0`, on a circle of radius 0.34), a
// hashed orbit radius (`orb`), a hashed integer rate (`k` in 1..3) and a hashed
// direction. `fs` is the classic metaball sum of inverse squares — the 0.003 is
// what keeps a blob's own centre finite — and the 0.5/1.4 smoothstep is the
// isosurface that turns that sum into a mass with a soft skin. The 0.08 fbm
// term is dust, so the merged masses do not read as flat paint.
//
// `br` is the sheet's `rad`, renamed: `radius` is a parameter in this catalog
// and the shadow would be silent. Same number.
//
// Six iterations, fixed. Nothing here is uniform-bounded and nothing indexes an
// array, which is what lets the same loop transcribe into SkSL.
// `count`, `size` and `vary` are the only numbers in this function the sheet did
// not choose, and each default IS the constant it replaced: six blobs, and a
// radius of `0.14 + 0.12*h1` at size 1 and variation 1. Both multiplies are by
// exactly 1.0 at the default, so the field is bit-identical to the render this
// file was diffed against.
//
// THE LOOP IS BOUNDED BY THE SLIDER'S MAXIMUM AND BROKEN ON THE LIVE COUNT, not
// bounded by the count. SkSL has no uniform-bounded loops, and the React Native
// export has to be this same shader rather than something like it
// (ADDING-AN-EFFECT.md §12.2) — so twelve is the compile-time bound in all three
// languages and `blobs` decides where it stops. Twelve is also the cap the
// slider carries; raising one without the other silently does nothing.
fn lqoBalls(q: vec2<f32>, ANG: f32, seed: f32, count: f32, size: f32, vary: f32) -> f32 {
  var fs: f32 = 0.0;
  for (var i: i32 = 0; i < 12; i = i + 1) {
    let fi = f32(i);
    if (fi >= count) { break; }
    let h1 = lqoHash(vec2<f32>(fi * 1.3, seed + 2.0));
    let h2 = lqoHash(vec2<f32>(seed + 7.0, fi * 2.1));
    let k  = floor(h1 * 3.0) + 1.0;
    let dir = select(-1.0, 1.0, h2 < 0.5);
    let c0 = 0.34 * vec2<f32>(cos(LQO_PI2 * h1), sin(LQO_PI2 * h2));
    let orb = 0.16 + 0.22 * h2;
    let c = c0 + orb * vec2<f32>(cos(dir * k * ANG + LQO_PI2 * h1 * 3.0),
                                 sin(dir * k * ANG + LQO_PI2 * h1 * 3.0));
    // The sheet's `0.14 + 0.12*h1`: a floor every blob gets, plus a per-blob
    // share of the spread. `vary` scales only the spread — at 0 every blob is
    // the same size, at 2 the big ones are twice as far from the small — and
    // `size` scales the result.
    let br = (0.14 + 0.12 * h1 * vary) * size;
    fs = fs + br * br / (dot(q - c, q - c) + 0.003);
  }
  return clamp(smoothstep(0.5, 1.4, fs)
               + 0.08 * (lqoFbm(q * 3.0 + vec2<f32>(seed, seed)) - 0.5), 0.0, 1.0);
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
// general form's `n` is 2, its segment index is `min(floor(2x), 1)` — so only
// the first two of its four ternary arms are ever reachable — and each segment
// carries the chroma boost `1 + 0.5*f*(1-f)` that gives the midtones their bite.
// SELECTED, never branched: see the note on the colour lines below.
fn lqoPal(x: f32, A: vec3<f32>, B: vec3<f32>, C: vec3<f32>) -> vec3<f32> {
  let s = clamp(x, 0.0, 1.0) * 2.0;
  let i = min(floor(s), 1.0);
  let ff = s - i;
  let f = ff * ff * (3.0 - 2.0 * ff);
  let a = select(B, A, i < 0.5);
  let b = select(C, B, i < 0.5);
  let c = mix(a, b, f);
  let k = 1.0 + 0.5 * f * (1.0 - f);
  return vec3<f32>(c.x, c.y * k, c.z * k);
}

fn orbLavaLampAnim(uv01: vec2<f32>) -> vec4<f32> {
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
  // orb in this family carries. It is also the only `if` in this body — the
  // metaball engine and the palette line both use `select` for that reason.
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
  // too keeps ANG in [0, 2π) — which the grain frame index needs, and which the
  // blobs' integer rates need to land back where they started — and keeps the
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
  // The seed-offset coordinate. On the fbm-churn orbs this is what the whole
  // engine samples; here the engine takes its seed through the hash instead, so
  // `q` survives for the shimmer term alone. Both are the sheet's, and swapping
  // which one feeds `lqoBalls` would relay every blob.
  let q  = q0 + vec2<f32>(u.seed * 11.17, u.seed * 5.31);

  // The engine, on `q0` — the refracted coordinate, NOT `q`.
  let n1 = lqoBalls(q0, ANG, u.seed, u.blobs, u.blobSize, u.blobVary);

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

  // The halo the sheet painted OUTSIDE the disc, tinted with the body colour
  // lifted and desaturated — derived from `colorA`, so it follows the swatch.
  // CFG[18] carries 0.25 of it, so on this orb the halo is on by default.
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
