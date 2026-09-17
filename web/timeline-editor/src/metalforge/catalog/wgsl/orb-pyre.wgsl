// Pyre — a column of flame held inside the ball.
//
// One five-octave noise field, warped by a finer copy of itself and scrolled
// downward in time so the plume reads as rising, weighted by height into an
// intensity that ramps through four stops: soot, ember, flame, spark.
//
// Transcribed from the "Thirteen Orbs" design sheet, screen 13 (Pyre): the
// third liquid program's `md==8` branch, on config 38. Every constant is the
// sheet's. Each parameter's default IS the constant it replaced — every one
// except `radius` and `speed`, which the Orbs family adds. `radius` (0.72)
// frames the ball inside the panel where the sheet let it fill its own canvas;
// set it to 1.0 to reproduce the sheet's framing exactly. `speed` is the
// sheet's clock rate (`cfg.rate * 1.5 * 0.45`) rounded onto the slider's step,
// so the default animates a fraction of a percent slow.
//
// One idea, three files: orb-pyre.metal (what an iOS user exports), this one
// (what the browser preview runs) and orb-pyre.sksl (the React Native half).
// Same maths in three spellings — change one and change all three, or the Code
// tab starts lying about what it ships.
//
// Deliberately NOT ported from the sheet: the blurred contact-shadow ellipse
// under the ball (the Orbs family cut the source app's floor, and the export
// paints over black); the ball div's own `radial-gradient(circle at 40% 32%,
// #38160A, #0C0604)`, which the opaque canvas covers everywhere but the ~2% rim
// feather; the nineteen sibling branches of the sheet's third program plus its
// unused `h2` hash and `ang` term, which would be dead shaders in one file; and
// the sheet's per-orb clock seed `3 + i*11.7`, a phase and not a maths change.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering. Six floats sit back to back after
// `time`, then WGSL pads to put `colorA` on a 16-byte boundary — the packer
// mirrors that gap — and the five colours run back to back on 16.
struct Uniforms {
  size:           vec2<f32>,
  time:           f32,
  speed:          f32,
  radius:         f32,
  rise:           f32,
  shade:          f32,
  grain:          f32,
  exposure:       f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  colorA:         vec4<f32>,
  colorB:         vec4<f32>,
  colorC:         vec4<f32>,
  colorD:         vec4<f32>,
  highlightColor: vec4<f32>,
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


// The noise bank the sheet's three fluid programs share — a cheap 2D value
// hash, bilinear value noise over it, then five octaves normalised by their own
// weight sum. Note this is NOT the sine hash the sheet's Prism screen uses;
// mixing the two banks silently changes every field.
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
             mix(lqHash(i + vec2<f32>(0.0, 1.0)), lqHash(i + vec2<f32>(1.0, 1.0)), f.x),
             f.y);
}

// The sheet rotates the domain by `mat2(.8,.6,-.6,.8)` between octaves. GLSL
// reads that column-major — columns (.8,.6) and (-.6,.8) — so the product is
// (.8x - .6y, .6x + .8y), not the transpose a reader supplies from habit. It is
// written out by hand in all three files for exactly that reason.
fn lqFbm(pIn: vec2<f32>) -> f32 {
  var p = pIn;
  var s: f32 = 0.0;
  var a: f32 = 0.5;
  var m: f32 = 0.0;
  for (var i: i32 = 0; i < 5; i = i + 1) {
    s = s + a * lqNoise(p);
    m = m + a;
    a = a * 0.5;
    p = vec2<f32>(0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y) * 2.03;
  }
  return s / m;
}

fn orbPyreAnim(uv01: vec2<f32>) -> vec4<f32> {
  // The runner hands uv01 with y down from the top, like stitchable MSL's
  // `position`; the orb was composed bottom-left, so flip back.
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let rad = max(u.radius, 0.05);

  // Nothing on this pixel: 0.995 is the far edge of the disc's own coverage,
  // `1 - smoothstep(0.955, 0.995, d)` at the bottom of this function, which is
  // EXACTLY zero past it — so the full path already returns opaque black here,
  // after computing the whole plume and multiplying it by nothing. An
  // early-out, not a clip: the number is that coverage term's own far edge, so
  // do not "tidy" it to 1.0 and eat the feather.
  //
  // Tested on `uv` rather than on `d` because `|uv| > rad * 0.995` IS
  // `d > 0.995`, and writing it this way leaves `p` and `d` in the same basic
  // block as the fluid. Branching on `d` after computing it splits that block,
  // the compiler stops folding `uv / rad` into its uses, and the last bit that
  // moves comes back through the grain hash as speckle up to 13/255. Measured
  // at 1024x1024: this form is bit-identical to no guard at all; the `d` form
  // is not.
  if (length(uv) > rad * (0.995 + mfEdgeD(u.edgeSoftness))) {
    // Off the ball entirely — but the halo lives out here, so hand back
    // what the edge bank paints on nothing. Exactly black at Glow 0.
    return vec4<f32>(clamp(mfEdgeGlow(vec3<f32>(0.0), uv, vec2<f32>(0.0), rad,
                                      u.edgeSoftness, u.edgeGlow, u.glowColor.rgb),
                           vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
  }

  let t   = u.time * u.speed;
  let p   = uv / rad;   // ball space: |p| == 1 on the ball's edge
  let d   = length(p);

  // Both fields subtract time from y, so the noise falls and the flame reads as
  // climbing. `rise` scales only those two time terms.
  let y01 = p.y * 0.5 + 0.5;
  let wf  = lqFbm(vec2<f32>(p.x * 3.0, p.y * 3.0 - t * 0.8 * u.rise));
  let f   = lqFbm(vec2<f32>(p.x * 2.6, p.y * 1.9 - t * 1.5 * u.rise) + vec2<f32>(1.2 * wf));

  // The sheet's canvas box IS the ball box, so its uv never left [-1,1] and
  // `1 - y01` was never negative. Ours can be, above the limb, where a negative
  // base under `pow` is undefined — the clamp only touches pixels the disc mask
  // below has already zeroed.
  let inten = f * 1.7 * (1.15 - y01) + pow(max(1.0 - y01, 0.0), 2.0) * 0.55;

  // The palette, bundled into one value. effects/_shared/ramp.ts.
  let pal = mfRampOf(u.paletteCount,
                     u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                     u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                     u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                     u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb);

  var c = mix(u.colorA.rgb, u.colorB.rgb, smoothstep(0.18, 0.55, inten));
  c = mix(c, u.colorC.rgb, smoothstep(0.52, 0.92, inten));
  c = mix(c, u.colorD.rgb, smoothstep(0.88, 1.30, inten));
  // The palette IS this ramp. Unlike the other liquids, Pyre hands its ramp a
  // RAW intensity rather than a [0,1] parameter — the four stops sit between
  // 0.18 and 1.30 — so the palette is read over that same span and the seed is
  // sampled across it. SELECTED, never branched: an `if` here splits the basic
  // block and the grain hash below turns that into speckle.
  c = select(c, mfRampLinR(inten / 1.30, pal), u.paletteCount > 0.5);

  // The tail every liquid program ends on: a lift toward the highlight from the
  // upper left, a darkening from the lower right, a darkening into the limb,
  // and one hash sample of grain.
  c = mix(c, u.highlightColor.rgb,
          u.shade * 0.30 * smoothstep(0.25, 1.25, dot(p, vec2<f32>(-0.32, 0.78))));
  c = c * (1.0 - u.shade * 0.42 * smoothstep(-0.05, 1.25, dot(p, vec2<f32>(0.45, -0.62))));
  c = c * (1.0 - u.shade * 0.30 * smoothstep(0.72, 1.00, d));
  c = c + vec3<f32>((lqHash(p * 900.0 + vec2<f32>(t)) - 0.5) * 0.05 * u.grain);

  // The disc's own alpha, folded into the colour. The sheet drew this canvas
  // premultiplied over the page; we paint over nothing, so the multiply IS that
  // composite and everything outside the ball is exactly 0 — which is what the
  // runner's coverage-to-alpha pass needs to let the page through.
  let ballA = 1.0 - smoothstep(0.955 - mfEdgeD(u.edgeSoftness), 0.995 + mfEdgeD(u.edgeSoftness), d);
  var col = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)) * ballA;
  col = clamp(col * max(u.exposure, 0.0), vec3<f32>(0.0), vec3<f32>(1.0));
  // The Orbs edge bank — the Edge group's Glow. Adding zero is exactly
  // the render this file was diffed against, and zero is the default.
  let edged = mfEdgeGlow(col, uv, vec2<f32>(0.0), rad,
                         u.edgeSoftness, u.edgeGlow, u.glowColor.rgb);
  return vec4<f32>(clamp(edged, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
