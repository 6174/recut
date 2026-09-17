// Glass Liquid — nine fluids seen through one frosted-glass shell.
//
// The browser-preview half of the effect. The fluid is the design sheet's
// liquid bank: five octaves of rotated value noise, domain-warped by a second
// pair of the same, ramped through four palette stops. Four of the nine styles
// share the warped-body branch outright; the other five take the sheet's progB
// at modes 0, 1, 6 and 7. The Style selector's option index IS the branch
// number, so `options[]` in config.ts must never be reordered.
//
// The shell is the sheet's DOM, composited in the markup's own order over the
// page colour the glass sits on: a porcelain radial fill, three inset white
// box-shadows, the blurred fluid, a rim ramp, and two rotated specular
// ellipses. Its geometry is derived once from the sheet's CSS at the tile size
// the sheet actually renders — a five-column 1720px grid gives a 305.6px tile,
// and `inset:3.5%` gives a ball of radius 142.104px — so every offset below is
// a pixel count times GL_PX, and every box is a percentage times GL_TILE.
//
// Three files, one effect: orb-glass-liquid.wgsl (this file), the iOS export in
// orb-glass-liquid.metal, and the React Native export in
// orb-glass-liquid.sksl. They are the same maths in three spellings; change one
// and you change all three, or the Code tab starts claiming a parity it no
// longer has.
//
// ---------------------------------------------------------------------------
// The canvas's `filter: blur(5px) saturate(1.15); opacity:.92`, and why it is
// not a convolution any more.
// ---------------------------------------------------------------------------
//
// This effect used to spend thirteen taps of the whole fluid on that blur — a
// centre plus two moment-matched six-tap rings — which made it, by a factor of
// two, the most expensive shader in the repo: **9.0 ms/frame at 1024² on an
// M-series Mac**, against orb-smoke at 4.4 and every other orb under 2.5. A
// SwiftUI `colorEffect` runs once per *device* pixel at full Retina, so on a
// phone that is the difference between a still image and a live one, and
// PERFORMANCE.md is the standing reminder that the machine we develop on is not
// the machine anyone visits on.
//
// The blur is now taken in the frequency domain instead, which costs ONE fluid
// evaluation. It is the same gaussian, applied three ways:
//
//  1. **Per-octave attenuation, inside `lqFbm`.** Convolving with a gaussian of
//     sigma σ scales a component at wavenumber k by exp(-k²σ²/2). An fbm's
//     octaves have known wavenumbers — octave i sits at 2.03^i times the base —
//     so each octave's amplitude is scaled by its own factor and the field is
//     sampled once. The mean is untouched (a blur preserves it), so only the
//     deviation from 0.5 is scaled and the `s / m` normaliser is unchanged.
//     Every caller passes the blur sigma expressed in ITS OWN input units,
//     which is what makes this track `zoom`: at zoom 0.3 the top octave is
//     attenuated to about a sixth and the bottom three are barely touched; at
//     zoom 1 the top three are gone; at zoom 0.05 almost nothing is.
//
//  2. **Value-space quadrature at every pointwise nonlinearity.** This is the
//     part that is easy to get wrong. `blur(ridge(f))` is not `ridge(blur(f))`:
//     attenuating first and ridging after leaves filaments thin and hard where
//     the blur should have spread them, which is exactly how the earlier
//     analytic-edge version failed. So `lqFbm` also returns the standard
//     deviation of the detail the attenuation removed — within a gaussian
//     window an octave scaled by β contributes variance ∝ (1 - β²), NOT
//     (1 - β)² — and every nonlinearity applied to that field integrates it
//     back out with a three-point Gauss-Hermite rule (exact through the fourth
//     moment). Three evaluations of a function of one float, not three
//     evaluations of the noise. `lqRidgeS`/`lqStepS`/`lqPowS` below; Nectar's
//     branch has the fbm inside a `sin`, where the same integral is closed-form
//     (E[sin(A + cε)] = sin A · exp(-c²σ²/2)), so it damps the sine instead.
//
//  3. **The disc's edge, analytically.** `smoothstep(a,b)` is a gaussian CDF of
//     sigma (b-a)/(2·1.88); adding the blur's sigma in quadrature and going
//     back gives GL_EA/GL_EB. Alone this was the old, rejected fix — the rim
//     was right and the interior stayed sharp. With (1) and (2) doing the
//     interior it is the correct third of the job.
//
// Measured, not argued, on the same headless-WebGPU bench that produced the
// 13-tap numbers: **0.67 ms/frame at 1024², a 12.2x speed-up**, and against the
// 13-tap render at 1024² across the nine styles the mean absolute channel error
// inside the ball is 0.79–1.62/255 (worst single channel 12–35). For scale, the
// 13-tap's own error against the real Chromium tile it was built to match was
// 0.84–1.48/255, and the analytic-edge version it replaced was 1.51–5.22. So
// this lands between them on accuracy and an order of magnitude below both on
// cost. Do NOT reintroduce the ring taps: the constants GL_KA / GL_KR / GL_KWA
// are fitted to that bench and a tap loop would double-blur.
//
// Deliberately NOT ported, and why:
//   - The liquid grain. Every other screen in the sheet ends its tail with
//     `(h(uv*900+t)-.5)*.05*uGrain`, but this section's canvas carries
//     `filter: blur(5px)`: at the sheet's size that noise has a period of about
//     a quarter of a display pixel, and the blur erases it. Porting it would
//     make this render DIFFER from the source, so Glass Liquid has no Grain
//     parameter at all.
//   - The two contact-shadow ellipses under the ball and its outer
//     `0 26px 50px -24px` drop shadow. The Orbs family cut the source app's
//     floor at the user's request, and the export paints over `Color.black`.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering. Thirteen floats (the Style select
// arrives as its 0-based option index) sit back to back after `time`, ending on
// byte 64, so the eleven colours land on 16-byte boundaries with no padding to
// mirror. Never a vec3 in here.
struct Uniforms {
  size:           vec2<f32>,
  time:           f32,
  speed:          f32,
  radius:         f32,
  zoom:           f32,
  warp:           f32,
  ridgeAmt:       f32,
  sharp:          f32,
  shade:          f32,
  sheen:          f32,
  gloss:          f32,
  shellMidAlpha:  f32,
  shellEdgeAlpha: f32,
  exposure:       f32,
  style:          f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  colorA:         vec4<f32>,
  colorB:         vec4<f32>,
  colorC:         vec4<f32>,
  colorD:         vec4<f32>,
  highlightColor: vec4<f32>,
  shellInner:     vec4<f32>,
  shellMid:       vec4<f32>,
  shellEdge:      vec4<f32>,
  sheenColor:     vec4<f32>,
  specColor:      vec4<f32>,
  canvasColor:    vec4<f32>,
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


// Shell geometry, in ball radii (|p| == 1 on the ball's edge, y up).
const GL_TILE: f32 = 2.15053763;   // tile side = 2/0.93 R
const GL_PX:   f32 = 0.00703710;   // one CSS pixel = 1/142.104 R
const GL_FU:   f32 = 0.88172043;   // canvas half-side = 0.82/0.93 R

// The canvas's `filter: blur(5px)`, in FLUID units (|fu| == 1 on the canvas
// edge): 5 CSS px over the 125.3px fluid radius the sheet renders at
// (0.82 * 305.6 / 2).
const GL_BSIG: f32 = 0.03990000;

// --- the three constants the frequency-domain blur is fitted on -------------
// A gaussian's response is exp(-k²σ²/2), so GL_KA is k²/2 for the wavenumber
// where smoothstep-interpolated value noise actually keeps its energy. The
// textbook choice — one cycle per noise cell, k = 2π, GL_KA = 19.74 — blurs too
// hard, because the smoothstep interpolation is itself a low-pass and pulls the
// effective k down to about 3.5. Fitted against the 13-tap render.
const GL_KA:  f32 = 6.0;
// (2.03)² — how σ grows, in its own octave's cells, from one octave to the next.
const GL_KG:  f32 = 4.1209;
// The warp field displaces the fluid rather than colouring it, so blurring the
// image does not attenuate it as strongly as the model says. Also fitted.
const GL_KWA: f32 = 0.5;
// One value-noise octave's standard deviation about its own mean, as a fraction
// of its range — the scale that turns "amplitude the attenuation removed" into
// "how far the removed detail typically pushed the value".
const GL_KR:  f32 = 0.32;
const GL_GH:  f32 = 1.73205081;   // sqrt(3), the 3-point Gauss-Hermite abscissa

// The disc's own alpha, `1 - smoothstep(0.955, 0.995, df)`, convolved with the
// blur: sigma (0.995-0.955)/(2*1.88) = 0.010638 in quadrature with GL_BSIG is
// 0.041294, and 1.88 of that either side of the unchanged centre 0.975 gives
// this pair.
const GL_EA: f32 = 0.89736760;
const GL_EB: f32 = 1.05263240;

// ---------------------------------------------------------------------------
// The sheet's liquid noise bank. Five octaves, gain .5, normalised by the
// weight sum, and rotated every octave. This is NOT the bank the sheet's Prism
// screen uses (a different hash, gain .55, unnormalised, no rotation).
// ---------------------------------------------------------------------------
fn lqHash(pIn: vec2<f32>) -> f32 {
  var p = fract(pIn * vec2<f32>(123.34, 456.21));
  p = p + vec2<f32>(dot(p, p + vec2<f32>(45.32)));
  return fract(p.x * p.y);
}

fn lqNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(lqHash(i), lqHash(i + vec2<f32>(1.0, 0.0)), f.x),
             mix(lqHash(i + vec2<f32>(0.0, 1.0)), lqHash(i + vec2<f32>(1.0, 1.0)), f.x), f.y);
}

// The fbm, pre-blurred. `bs` is the blur's sigma expressed in THIS call's input
// units — the caller scales it by whatever it scaled the domain by. Returns
// `.x` the attenuated value and `.y` the standard deviation of the detail the
// attenuation took out, which is what a following nonlinearity has to integrate
// over. Both are exact for a gaussian window: the surviving amplitude is β and
// the variance that leaves is (1 - β²), per octave, weighted by that octave's
// own share of the normalised sum.
fn lqFbm(pIn: vec2<f32>, bs: f32) -> vec2<f32> {
  var p = pIn;
  var s:  f32 = 0.0;
  var a:  f32 = 0.5;
  var m:  f32 = 0.0;
  var vr: f32 = 0.0;
  let e = -GL_KA * bs * bs;
  var g: f32 = 1.0;
  for (var i: i32 = 0; i < 5; i = i + 1) {
    let b = exp(e * g);
    s  = s  + a * (0.5 + b * (lqNoise(p) - 0.5));
    vr = vr + a * a * (1.0 - b * b);
    m  = m + a;
    a  = a * 0.5;
    g  = g * GL_KG;
    // GLSL's mat2(.8,.6,-.6,.8) is COLUMN-major — columns (.8,.6) and
    // (-.6,.8) — so the product is written out rather than constructed.
    p = vec2<f32>(0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y) * 2.03;
  }
  return vec2<f32>(s / m, GL_KR * sqrt(vr) / m);
}

fn lqRidge(v: f32, k: f32) -> f32 {
  return pow(clamp(1.0 - abs(v * 2.0 - 1.0), 0.0, 1.0), k);
}

// The sheet's four-stop ramp, shared by every branch of every program.
fn lqRamp(v: f32, cA: vec3<f32>, cB: vec3<f32>, cC: vec3<f32>, cD: vec3<f32>) -> vec3<f32> {
  var c = mix(cA, cB, smoothstep(0.0, 0.45, v));
  c = mix(c, cC, smoothstep(0.38, 0.72, v));
  c = mix(c, cD, smoothstep(0.68, 1.0, v));
  // The palette IS this ramp, and it goes HERE rather than at the five call
  // sites: every branch of every program reaches its body colour through this
  // one function, so one select covers all nine styles. `v` is already the
  // [0,1] parameter the four stops were placed along. Selected, never branched
  // (effects/_shared/ramp.ts).
  return select(c, mfRampLin(v, u.paletteCount,
                             u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                             u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                             u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                             u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb), u.paletteCount > 0.5);
}

// ---------------------------------------------------------------------------
// The three nonlinearities the fluid applies to a pre-blurred field, each
// integrated over the detail `lqFbm` attenuated away. Three-point
// Gauss-Hermite — nodes 0 and ±sqrt(3)·sd, weights 4/6 and 1/6 — reproduces a
// gaussian's second AND fourth moments, which is what keeps a ridged filament
// spreading as it dims instead of just dimming. `vs` is an `lqFbm` result:
// `.x` the value, `.y` that standard deviation.
// ---------------------------------------------------------------------------
fn lqRidgeS(vs: vec2<f32>, k: f32) -> f32 {
  let d = GL_GH * vs.y;
  return (lqRidge(vs.x - d, k) + 4.0 * lqRidge(vs.x, k) + lqRidge(vs.x + d, k)) / 6.0;
}

fn lqStepS(vs: vec2<f32>, a: f32, b: f32) -> f32 {
  let d = GL_GH * vs.y;
  return (smoothstep(a, b, vs.x - d) + 4.0 * smoothstep(a, b, vs.x)
        + smoothstep(a, b, vs.x + d)) / 6.0;
}

fn lqPowS(vs: vec2<f32>, k: f32) -> f32 {
  let d = GL_GH * vs.y;
  return (pow(clamp(vs.x - d, 0.0, 1.0), k) + 4.0 * pow(clamp(vs.x, 0.0, 1.0), k)
        + pow(clamp(vs.x + d, 0.0, 1.0), k)) / 6.0;
}

// ---------------------------------------------------------------------------
// The fluid, at one point, already blurred and straight (not premultiplied):
// the sheet's shader on `fu` — both programs, all four inner branches, and the
// shared shade tail — with the blur folded into the noise bank as above. The
// disc's own alpha is the caller's, because it is analytic now.
// ---------------------------------------------------------------------------
fn glsFluid(fu: vec2<f32>, md: i32, t: f32) -> vec3<f32> {
  let df = length(fu);

  let cA = u.colorA.rgb;
  let cB = u.colorB.rgb;
  let cC = u.colorC.rgb;
  let cD = u.colorD.rgb;

  // The blur's sigma, carried from fluid units into the fluid's own domains.
  // `sp` is it in pp/q units — the warp shifts q about but does not stretch it
  // on average, so pp and q share one. `sw` is the warp field's own, softened
  // by GL_KWA.
  let sp = GL_BSIG * u.zoom;
  let sw = sp * 1.1 * GL_KWA;

  var fcol: vec3<f32>;
  if (md < 0) {
    // progA — the warped body, the only branch with the slow vertical drift
    // and the only one that reads Ridge.
    var pp = fu * u.zoom;
    pp.y = pp.y + t * 0.05;
    let w = vec2<f32>(lqFbm(pp * 1.1 + vec2<f32>(0.0, t * 0.09), sw).x,
                      lqFbm(pp * 1.1 + vec2<f32>(7.7, -t * 0.07), sw).x);
    let q = pp + u.warp * (w - vec2<f32>(0.5));
    let body  = lqFbm(q * 1.5 + vec2<f32>(t * 0.04, 0.0), sp * 1.5);
    let veins = lqRidgeS(lqFbm(q * 2.2 + vec2<f32>(3.1), sp * 2.2), u.sharp);
    let v = mix(lqStepS(body, 0.12, 0.88),
                clamp(veins * 0.85 + 0.45 * body.x, 0.0, 1.0), u.ridgeAmt);
    fcol = lqRamp(v, cA, cB, cC, cD);
  } else {
    // progB — same warp, no vertical drift, four inner branches.
    let pp = fu * u.zoom;
    let w = vec2<f32>(lqFbm(pp * 1.1 + vec2<f32>(0.0, t * 0.09), sw).x,
                      lqFbm(pp * 1.1 + vec2<f32>(7.7, -t * 0.07), sw).x);
    let q = pp + u.warp * (w - vec2<f32>(0.5));
    if (md == 0) {
      // Nectar — a sine band the noise leans on. The fbm is INSIDE the sine, so
      // the removed detail integrates out in closed form rather than by
      // quadrature: E[sin(A + 6e)] = sin(A)·exp(-18·sd²). The second term of
      // the exponent is the same integral for the sine's own `q.x * 7.0`, which
      // the blur attenuates by exp(-49·sp²/2).
      let n0 = lqFbm(q * 2.2, sp * 2.2);
      let damp = exp(-18.0 * n0.y * n0.y - 24.5 * sp * sp);
      var v = 0.5 + 0.5 * damp * sin(q.x * 7.0 + n0.x * 6.0 + t * 0.35);
      v = mix(v, lqFbm(q * 1.4 + vec2<f32>(t * 0.03), sp * 1.4).x, 0.25);
      fcol = lqRamp(v, cA, cB, cC, cD);
    } else if (md == 1) {
      // Lumen — two ridged fields multiplied into filaments. The two fields are
      // independent, so each integrates its own detail out before the product.
      let v = lqRidgeS(lqFbm(q * 1.4 + vec2<f32>(t * 0.06, 0.0), sp * 1.4), u.sharp)
            * lqRidgeS(lqFbm(q * 1.7 - vec2<f32>(0.0, t * 0.05), sp * 1.7), u.sharp);
      fcol = lqRamp(pow(v, 0.7), cA, cB, cC, cD);
    } else if (md == 6) {
      // Sprig — noise warped by noise, with a ridged edge darkening it.
      let v = lqFbm(q * 1.3 + vec2<f32>(1.5 * lqFbm(q * 2.6 + vec2<f32>(t * 0.025), sp * 2.6).x), sp * 1.3);
      let edge = lqRidgeS(lqFbm(q * 2.1 + vec2<f32>(7.0), sp * 2.1), 1.3);
      fcol = lqRamp(lqStepS(v, 0.1, 0.9), cA, cB, cC, cD);
      fcol = fcol * (1.0 - 0.18 * edge);
    } else {
      // Haze and Smoke — the same rising plume at two palettes.
      let q2 = q + vec2<f32>(0.0, -t * 0.14);
      let v = lqFbm(q2 * 1.6 + vec2<f32>(2.2 * lqFbm(q2 * 2.4 + vec2<f32>(0.0, -t * 0.05), sp * 2.4).x), sp * 1.6);
      fcol = lqRamp(lqPowS(v, 1.5), cA, cB, cC, cD);
    }
  }

  // The sheet's shared tail: a highlight up-left, a shadow down-right, and a
  // darkened limb. All three are far below the blur's cutoff, so they are the
  // sheet's own expressions untouched. The grain term the sheet ends on is not
  // ported — see the header. The two `1 - shade*k*smoothstep(...)` terms are
  // multiplicative darkening, not colours, so they stay literal.
  fcol = mix(fcol, u.highlightColor.rgb,
             u.shade * 0.3 * smoothstep(0.25, 1.25, dot(fu, vec2<f32>(-0.32, 0.78))));
  fcol = fcol * (1.0 - u.shade * 0.42 * smoothstep(-0.05, 1.25, dot(fu, vec2<f32>(0.45, -0.62))));
  fcol = fcol * (1.0 - u.shade * 0.3 * smoothstep(0.72, 1.0, df));
  return clamp(fcol, vec3<f32>(0.0), vec3<f32>(1.0));
}

// ---------------------------------------------------------------------------
// The shell.
// ---------------------------------------------------------------------------

// A box-shadow blur of B px is a gaussian of sigma B/2, and a gaussian CDF is
// a smoothstep across about ±1.88 sigma. `sd` is the signed distance outside
// the shadow's own shape, which for an inset shadow is what gets painted.
fn glsCdf(sd: f32, sg: f32) -> f32 {
  return smoothstep(-1.88 * sg, 1.88 * sg, sd);
}

// Source-over onto an opaque destination, straight (un-premultiplied) sRGB.
fn glsOver(dst: vec3<f32>, src: vec3<f32>, a: f32) -> vec3<f32> {
  let k = clamp(a, 0.0, 1.0);
  return src * k + dst * (1.0 - k);
}

// One of the two rotated specular ellipses: a white radial gradient inside its
// own `border-radius:50%` box. `ca`/`sa` are cos/sin of -theta_css, because a
// CSS rotation in a y-down frame is the opposite rotation in ours. `gy` lifts
// the gradient's centre off the box's when the CSS says `ellipse at 50% 40%`.
fn glsSpec(p: vec2<f32>, c: vec2<f32>, ab: f32, bb: f32, ca: f32, sa: f32,
           ag: f32, bg: f32, gy: f32, a0: f32) -> f32 {
  let dv = p - c;
  let lx =  dv.x * ca + dv.y * sa;
  let ly = -dv.x * sa + dv.y * ca;
  let e  = sqrt((lx / ab) * (lx / ab) + (ly / bb) * (ly / bb));
  let mask = 1.0 - smoothstep(0.98, 1.02, e);
  let g  = sqrt((lx / ag) * (lx / ag) + ((ly - gy) / bg) * ((ly - gy) / bg));
  return a0 * clamp(1.0 - g / 0.7, 0.0, 1.0) * mask;
}

fn orbGlassLiquidAnim(uv01: vec2<f32>) -> vec4<f32> {
  // The runner hands uv01 with y down from the top, like stitchable MSL's
  // `position`; the orb was authored bottom-left, so flip back.
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let rad = max(u.radius, 0.05);

  // Nothing on this pixel — and here that is the whole fluid and the whole
  // shell skipped, over roughly 60% of the quad. 1.01 is the far edge of the
  // ball's own coverage, `1 - smoothstep(0.99, 1.01, pd)` on the last line of
  // this function, which is EXACTLY zero past it, so the full path already
  // returns opaque black here. An early-out, not a clip: the number is that
  // coverage term's own far edge, so do not "tidy" it to 1.0 — that would
  // shave the outer half of the limb's antialiasing.
  //
  // Tested on `uv` rather than on `pd` because `|uv| > rad * 1.01` IS
  // `pd > 1.01`, and it keeps `p` and `pd` in the same basic block as
  // everything that reads them — the shape the four sibling orbs of this port
  // need, where branching on `d` after computing it makes the compiler stop
  // folding `uv / rad` into its uses and the moved last bit comes back through
  // their grain hash as speckle up to 34/255. Glass Liquid has no grain and is
  // nearly immune either way: at 1024x1024 this costs under a dozen bytes of a
  // four-million-byte frame, off by 1/255. Those are the branch existing, not a
  // pixel wrongly skipped — a copy of this guard with a threshold it can never
  // reach diffs identically, and against it the guard is exactly 0/255.
  if (length(uv) > rad * (1.01 + mfEdgeD(u.edgeSoftness))) {
    // Off the ball entirely — but the halo lives out here, so hand back
    // what the edge bank paints on nothing. Exactly black at Glow 0.
    return vec4<f32>(clamp(mfEdgeGlow(vec3<f32>(0.0), uv, vec2<f32>(0.0), rad,
                                      u.edgeSoftness, u.edgeGlow, u.glowColor.rgb),
                           vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
  }

  let t   = u.time * u.speed;
  let p   = uv / rad;            // ball space: |p| == 1 on the ball's edge
  let pd  = length(p);

  // ---- the fluid ------------------------------------------------------
  // The sheet insets the canvas to left/top 9%, w/h 82% while the ball is
  // inset 3.5%, so the fluid's own uv is the ball coordinate over the canvas
  // half-side.
  let fu = p / GL_FU;
  let df = length(fu);

  // Branch dispatch. Frost/Blush/Zest/Cirrus are progA (md < 0); the rest are
  // progB at the sheet's own mode number. An if-chain, not a const array —
  // a runtime-indexed array is the shape PERFORMANCE.md forbids.
  let s = i32(u.style + 0.5);
  var md: i32 = -1;
  if (s == 1) { md = 1; }
  else if (s == 3 || s == 8) { md = 7; }
  else if (s == 5) { md = 6; }
  else if (s == 7) { md = 0; }

  // The blurred disc coverage, analytic (see the header). A second early-out
  // rides on it: past GL_EB the fluid contributes nothing at all, and that is
  // another 15% of the ball's pixels where the shell alone is drawn.
  let fa = 1.0 - smoothstep(GL_EA, GL_EB, df);
  var fcol = vec3<f32>(0.0);
  if (fa > 0.0) { fcol = glsFluid(fu, md, t); }

  // ---- the shell, in the markup's DOM order ---------------------------
  // L1/L2 (the two contact-shadow ellipses) are not ported; the composite
  // starts on the page colour they would have fallen on.
  var col = u.canvasColor.rgb;

  // L3a — the porcelain fill: `radial-gradient(circle at 40% 30%, ...)` over
  // the ball's own square box, default farthest-corner extent. CSS interpolates
  // a gradient in PREMULTIPLIED space (CSS Images 3), so the stops are
  // premultiplied before the lerp and the result composites as-is.
  {
    let gc = vec2<f32>(-0.2, 0.4);      // 40% 30% of a box spanning ±1
    let ge: f32 = 1.84390889;           // |(1,-1) - gc| = sqrt(3.4)
    let g  = clamp(length(p - gc) / ge, 0.0, 1.0);
    let aInner: f32 = 0.70;             // rgba(255,255,255,.7)
    let sInner = u.shellInner.rgb * aInner;
    let sMid   = u.shellMid.rgb   * u.shellMidAlpha;
    let sEdge  = u.shellEdge.rgb  * u.shellEdgeAlpha;
    var pm: vec3<f32>;
    var pa: f32;
    if (g < 0.55) {
      let f = g / 0.55;
      pm = mix(sInner, sMid, f);
      pa = mix(aInner, u.shellMidAlpha, f);
    } else {
      let f = (g - 0.55) / 0.45;
      pm = mix(sMid, sEdge, f);
      pa = mix(u.shellMidAlpha, u.shellEdgeAlpha, f);
    }
    col = pm + col * (1.0 - clamp(pa, 0.0, 1.0));
  }

  // L3b — three inset white box-shadows on the same div, clipped to the ball.
  // CSS paints the FIRST-listed shadow on top, so they composite in reverse
  // list order. An inset shadow paints outside its offset shape, hence
  // `length(p - off) - 1` as the signed distance.
  {
    let sc = u.sheenColor.rgb;
    // 3rd listed: inset 0 -20px 44px rgba(255,255,255,.25)
    let a3 = 0.25 * u.sheen
           * glsCdf(length(p - vec2<f32>(0.0, 20.0 * GL_PX)) - 1.0, 22.0 * GL_PX);
    col = glsOver(col, sc, a3);
    // 2nd listed: inset 0 16px 36px rgba(255,255,255,.55)
    let a2 = 0.55 * u.sheen
           * glsCdf(length(p - vec2<f32>(0.0, -16.0 * GL_PX)) - 1.0, 18.0 * GL_PX);
    col = glsOver(col, sc, a2);
    // 1st listed: inset 0 0 0 1px rgba(255,255,255,.6) — a hard 1px ring with
    // half a pixel of antialiasing either side of its inner edge.
    let a1 = 0.60 * u.sheen * smoothstep(1.0 - 1.5 * GL_PX, 1.0 - 0.5 * GL_PX, pd);
    col = glsOver(col, sc, a1);
  }

  // L4 — the fluid: `filter: blur(5px) saturate(1.15); opacity:.92`. The blur
  // lives inside `glsFluid` and in `fa`; `saturate()` follows it and runs on the
  // STRAIGHT colour, as a CSS filter chain does. It is CSS's luminance-
  // preserving matrix in sRGB, which is exactly lum + (c-lum)*s.
  {
    let lum = dot(fcol, vec3<f32>(0.213, 0.715, 0.072));
    let sat = clamp(vec3<f32>(lum) + (fcol - vec3<f32>(lum)) * 1.15,
                    vec3<f32>(0.0), vec3<f32>(1.0));
    col = glsOver(col, sat, 0.92 * fa);
  }

  // L5 — the rim ramp: `radial-gradient(circle at 50% 50%, white 58%→0,
  // 84%→.26, 97%→.65, 100%→.2)`, farthest-corner (sqrt(2)) over the ball's box.
  // Only the second segment is reachable while |p| ≤ 1; the rest is here so the
  // layer stays correct if the ball is ever re-framed.
  {
    let g: f32 = pd / 1.41421356;
    var a: f32;
    if (g < 0.58) { a = 0.0; }
    else if (g < 0.84) { a = 0.26 * (g - 0.58) / 0.26; }
    else if (g < 0.97) { a = mix(0.26, 0.65, (g - 0.84) / 0.13); }
    else if (g < 1.0) { a = mix(0.65, 0.20, (g - 0.97) / 0.03); }
    else { a = 0.20; }
    col = glsOver(col, u.specColor.rgb, a * u.gloss);
  }

  // L6/L7 — the two rotated specular ellipses. Children of the TILE box, not of
  // the ball, so their boxes are percentages of GL_TILE. Farthest-corner on an
  // ellipse gradient scales the side distances by sqrt(2).
  {
    let sc = u.specColor.rgb;
    // left:16% top:6.5% w:46% h:22%; rotate(-18deg); gradient at 50% 40%.
    let a6 = glsSpec(p, vec2<f32>(-0.11 * GL_TILE, 0.325 * GL_TILE),
                     0.23 * GL_TILE, 0.11 * GL_TILE,
                     0.95105652, 0.30901699,
                     1.41421356 * 0.23 * GL_TILE, 1.41421356 * 0.132 * GL_TILE,
                     0.022 * GL_TILE, 0.95);
    col = glsOver(col, sc, a6 * u.gloss);
    // left:62% top:70% w:18% h:9%; rotate(-20deg); centred gradient.
    let a7 = glsSpec(p, vec2<f32>(0.21 * GL_TILE, -0.245 * GL_TILE),
                     0.09 * GL_TILE, 0.045 * GL_TILE,
                     0.93969262, 0.34202014,
                     1.41421356 * 0.09 * GL_TILE, 1.41421356 * 0.045 * GL_TILE,
                     0.0, 0.75);
    col = glsOver(col, sc, a7 * u.gloss);
  }

  // The ball's own edge, and nothing outside it — everything the effect does
  // not paint must be exactly 0 so the page shows through.
  let ballA = 1.0 - smoothstep(0.99 - mfEdgeD(u.edgeSoftness), 1.01 + mfEdgeD(u.edgeSoftness), pd);
  col = clamp(col * max(u.exposure, 0.0), vec3<f32>(0.0), vec3<f32>(1.0)) * ballA;
  // The Orbs edge bank — the Edge group's Glow. Adding zero is exactly
  // the render this file was diffed against, and zero is the default.
  let edged = mfEdgeGlow(col, uv, vec2<f32>(0.0), rad,
                         u.edgeSoftness, u.edgeGlow, u.glowColor.rgb);
  return vec4<f32>(clamp(edged, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
