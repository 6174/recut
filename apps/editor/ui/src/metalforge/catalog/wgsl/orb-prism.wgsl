// Prism — domain-warped value noise read through a cosine palette.
//
// Two fbm fields displace the sample point, two more read the warped field, and
// their weighted sum drives a single cosine at three per-channel phases — which
// is where every hue in the image comes from, since the shader holds no colour
// constant at all. A raking highlight lifts the upper left, a counter-ramp
// darkens the lower right, a static film grain sits over the ball in an overlay
// blend, and behind the ball two blurred cones, pink over blue, leak past the
// limb as a halo.
//
// One of three implementations of the same maths: orb-prism.metal is what an
// iOS user downloads, orb-prism.sksl is the React Native export, and this file
// runs the browser preview. They are hand-written, not transpiled, so if you
// change one you must change all three.
//
// Ported from the "01 Prism" screen of the Thirteen Orbs design sheet. Every
// constant, the five octaves and the 0.55 gain are the sheet's; each new param
// defaults to the constant it replaced, so the default render is the original.
// Prism has its OWN noise bank — sine hash, gain 0.55, unnormalised, no
// per-octave rotation — which is NOT the bank the sheet's liquid shaders use.
//
// Deliberately not ported, and why:
//   · The ball div's `radial-gradient(circle at 35% 30%, #FDEBD6, …)` and the
//     two drifting blurred blobs inside it. The canvas is opaque everywhere the
//     ball is, so all three are visible only through the ~2% rim feather. The
//     gradient survives as the effect's swatch.
//   · The sheet's starting time `tm = 7.3`, and the liquid tiles' `3 + i*11.7`.
//     Those are a per-tile phase stagger so a wall of orbs is not in lockstep,
//     not a constant of the image; our timeline starts at 0.
//   · The hover gate (`animation-play-state: paused` plus the `hot` flag that
//     freezes an unhovered tile). That is the page's performance policy, and the
//     app already owns its own.
//
// Two things here are approximations rather than transcriptions, and are the
// only two in the file:
//   · The grain. The sheet overlays an SVG `feTurbulence` tile — a seeded,
//     tiled Perlin generator we cannot reproduce byte for byte — so a value
//     hash stands in for it. Its weight is NOT the 0.30 the two CSS opacities
//     (0.5 on the div, 0.6 on the rect) suggest: a uniform hash sits 0.289 RMS
//     off its mean where two-octave `fractalNoise` sits about 0.13 off its own,
//     so at 0.30 the stand-in is 2.26x too strong. 0.1327 is what matches, and
//     it is measured, not derived — the sheet's tile rendered in Chromium moves
//     the image by 5.48/255 RMS inside the ball, and so does this.
//   · The halo's 16px CSS blur is applied as an analytic widening of the div's
//     own circular clip rather than as a true gaussian over the two cones. The
//     cones are linear ramps, which a gaussian of this size barely moves; the
//     clip edge is where all the blur is visible.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering. The eight floats sit back to back after
// `time`, WGSL then pads to put `tintColor` on a 16-byte boundary — the packer
// mirrors that gap — and the four colours run back to back on 16.
struct Uniforms {
  size:           vec2<f32>,
  time:           f32,
  speed:          f32,
  radius:         f32,
  zoom:           f32,
  warp:           f32,
  spectrum:       f32,
  grain:          f32,
  glow:           f32,
  exposure:       f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  tintColor:      vec4<f32>,
  highlightColor: vec4<f32>,
  haloColor:      vec4<f32>,
  haloTintColor:  vec4<f32>,
  glowColor:      vec4<f32>,
  paletteStop0:   vec4<f32>,
  paletteStop1:   vec4<f32>,
  paletteStop2:   vec4<f32>,
  paletteStop3:   vec4<f32>,
  paletteStop4:   vec4<f32>,
  paletteStop5:   vec4<f32>,
  paletteStop6:   vec4<f32>,
  paletteStop7:   vec4<f32>,
  paletteStop8:   vec4<f32>,
  paletteStop9:   vec4<f32>,
  paletteStop10:  vec4<f32>,
  paletteStop11:  vec4<f32>,
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


// Prism's noise bank. Five octaves, lacunarity 2.03, gain 0.55, and NOT
// normalised by the weight sum — so fbm here peaks near 0.9, not 1.0, which is
// what puts the palette where the sheet put it.
fn prHash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn prNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(prHash(i),                       prHash(i + vec2<f32>(1.0, 0.0)), f.x),
             mix(prHash(i + vec2<f32>(0.0, 1.0)), prHash(i + vec2<f32>(1.0, 1.0)), f.x), f.y);
}

fn prFbm(pIn: vec2<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 5; i = i + 1) {
    v = v + a * prNoise(p);
    p = p * 2.03 + vec2<f32>(1.7, 9.2);
    a = a * 0.55;
  }
  return v;
}

// The CSS `overlay` blend the grain layer uses: hard-light with the operands
// swapped. Written with step rather than a branch because both halves evaluate
// to `s` at b == 0.5, so the seam is exact and there is nothing to threshold.
fn prOverlay(b: vec3<f32>, s: vec3<f32>) -> vec3<f32> {
  return mix(2.0 * b * s,
             vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - b) * (vec3<f32>(1.0) - s),
             step(vec3<f32>(0.5), b));
}

fn orbPrismAnim(uv01: vec2<f32>) -> vec4<f32> {
  // The runner hands uv01 with y down from the top, like stitchable MSL's
  // `position`; the sheet's fragment was authored bottom-left, so flip back.
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let rad = max(u.radius, 0.05);

  // Nothing on this pixel: 1.394470 is the outer stop of the halo's own fade,
  // `1 - smoothstep(0.971122, 1.394470, d)` below, which is EXACTLY zero past
  // it — and the ball's `1 - smoothstep(0.99, 1.0, d)` reached zero long before
  // — so the full path already returns opaque black here, after computing five
  // fbm fields, the grain and both cones and multiplying them all by nothing.
  // An early-out, not a clip: the number is that coverage term's own far edge,
  // so do not "tidy" it to 1.0 or the halo goes with it.
  //
  // Tested on `uv` rather than on `d` because `|uv| > rad * 1.394470` IS
  // `d > 1.394470`, and writing it this way leaves `p` and `d` in the same
  // basic block as the fluid. Branching on `d` after computing it splits that
  // block, the compiler stops folding `uv / rad` into its uses, and the last
  // bit that moves comes back through the grain hash as speckle up to 34/255.
  // Measured at 1024x1024: this form is bit-identical to no guard at all; the
  // `d` form is not.
  if (length(uv) > rad * 1.394470) {
    // Past even the cones. The edge bank's own halo still reaches here at
    // high Glow; at Glow 0 this is the black it always returned.
    return vec4<f32>(clamp(mfEdgeGlow(vec3<f32>(0.0), uv, vec2<f32>(0.0), rad,
                                      u.edgeSoftness, u.edgeGlow, u.glowColor.rgb),
                           vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
  }

  let t   = u.time * u.speed;
  let p   = uv / rad;      // ball space: |p| == 1 on the ball's edge
  let d   = length(p);

  // The fluid, verbatim from the sheet. Its canvas box IS the ball box there,
  // so the sheet's own uv is this p and nothing needs rescaling.
  let q = vec2<f32>(prFbm(p * 1.6 + vec2<f32>(0.0, t * 0.12)),
                    prFbm(p * 1.6 + vec2<f32>(5.2, t * 0.09)));
  let w  = p * u.zoom + u.warp * (q - vec2<f32>(0.5));
  let m1 = prFbm(w + vec2<f32>(t * 0.06, -t * 0.05));
  let m2 = prFbm(w * 1.7 - vec2<f32>(t * 0.04, t * 0.07));

  // `band` is the scalar the whole image is coloured by — the weighted sum of
  // the two warped fields, drifting on its own slow term. Everything above this
  // line is the sheet's; everything below is what reads it.
  let band = m1 * 1.15 + m2 * 0.35 + t * 0.015;

  // Two ways to colour it, and the palette picks.
  //
  // OFF (paletteCount == 0, the default): the sheet's own. The colour is
  // generated, not stored — one cosine read at three per-channel phases,
  // vec3(0.0, 0.33, 0.67), so the channels crest a third of a cycle apart and
  // the result sweeps the spectrum. `spectrum` collapses the triple toward its
  // shared first component: at 1 the arithmetic is bit-for-bit the original, at
  // 0 all three channels share phase 0, the rainbow goes greyscale with its
  // banding intact, and `tintColor` decides the hue.
  //
  // ON: the user's stops, in the same place. This is the only thing a
  // generated-colour orb could do — there is no stored hue here to resample, so
  // a CPU-side palette could only ever have tinted the whole ball, which is
  // exactly the "just a red filter" this replaced (see effects/_shared/ramp.ts).
  // The ramp is CYCLIC because `band` always was: the cosine has period 1 and
  // the field runs well past it, so wrapping keeps every band the image had and
  // only changes what they are coloured with. `spectrum` becomes how far around
  // the ramp one unit of field travels — 1 is one full pass, below that the
  // bands widen, 0 is a single flat colour.
  //
  // SELECTED, not branched, and both sides are always evaluated — which looks
  // like the wasteful way round and is not. An `if` here splits the fragment's
  // basic block, the compiler stops folding `uv / rad` into its uses, and the
  // grain hash forty lines down (`fract(sin(x) * 43758.5453)`, which amplifies
  // a last-bit change by ~44000x) turns that into speckle up to 33/255. That is
  // measured on this exact edit, and it is the same trap the early-out guard
  // above documents. The ramp is two dozen selects against five fbm fields, so
  // evaluating it on the default path costs far less than the branch would.
  let ph = vec3<f32>(0.0, 0.33, 0.67) * u.spectrum;
  let spec = select(
    vec3<f32>(0.58) + 0.42 * cos(6.28318 * (vec3<f32>(band) + ph)),
    mfRampCyc(band * u.spectrum, u.paletteCount,
              u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
              u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
              u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
              u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb),
    u.paletteCount > 0.5);
  var col = spec * u.tintColor.rgb;
  col = mix(col, u.highlightColor.rgb,
            vec3<f32>(0.5 * smoothstep(0.1, 1.2, dot(p, vec2<f32>(-0.35, 0.8)))));
  col = col * (1.0 - 0.26 * smoothstep(-0.2, 1.2, dot(p, vec2<f32>(0.45, -0.6))));

  // The grain overlay. Static — the sheet's turbulence tile carries no time
  // term, unlike the grain on its liquid orbs. See the header for why the
  // weight is 0.1327 and not the 0.30 the two CSS opacities multiply out to.
  let gn = prHash(p * 900.0);
  col = mix(col, prOverlay(col, vec3<f32>(gn)), vec3<f32>(0.1327 * u.grain));

  // The halo: the `inset:-5%` blurred ring behind the ball, and the only shell
  // layer Prism keeps. Its geometry is a pure ratio of the tile, so it needs no
  // page size: the div's circle is 0.55/0.465 == 1.182796 ball radii, the two
  // gradient centres sit 0.22/0.465 == 0.473118 off centre on the diagonal, and
  // `farthest-corner` puts the transparent stop at
  // 0.6 * 0.7 * sqrt(2) * 1.1 / 0.465 == 1.405090. Only the blur needs a real
  // size: `filter: blur(16px)` is a gaussian of sigma 16px (unlike a box-shadow,
  // where sigma is half the stated radius), the ball's radius is 142.104px on a
  // 305.6px column (five of them at the 1720px max width), and a gaussian CDF is a smoothstep over +-1.88 sigma —
  // hence the clip band 1.182796 -+ 0.211674.
  let cone1 = vec2<f32>(-0.473118,  0.473118);   // pink,  `circle at 30% 30%`
  let cone2 = vec2<f32>( 0.473118, -0.473118);   // blue,  `circle at 70% 70%`
  let a1 = 0.35 * max(1.0 - length(p - cone1) / 1.405090, 0.0);
  let a2 = 0.35 * max(1.0 - length(p - cone2) / 1.405090, 0.0);
  // Source-over in the markup's own order: the pink layer is listed first and
  // CSS paints that one on top. Premultiplied, because that is what the ball
  // composites against and what the alpha compositor reads back out.
  var halo = u.haloColor.rgb * a1 + u.haloTintColor.rgb * a2 * (1.0 - a1);
  halo = halo * ((1.0 - smoothstep(0.971122, 1.394470, d)) * u.glow);

  // The ball over the halo. The sheet stacks the canvas on an OPAQUE ball div —
  // a four-stop radial gradient under a `clip-path: circle(50%)` — so the halo
  // is hidden out to d == 1 and the canvas's own `1-smoothstep(.955,.995,d)`
  // feather crossfades into that gradient, never into the halo. We dropped the
  // gradient (the canvas is opaque over all of it, and two animated CSS blobs
  // sit between them that a fragment cannot honestly carry), so the feather
  // would reveal the halo instead and leave a pink rim up-left and a blue one
  // down-right. The ball therefore takes the div's own hard clip circle, and
  // the fluid runs out to it: same silhouette as the sheet, no bleed.
  let ballA = 1.0 - smoothstep(0.99 - mfEdgeD(u.edgeSoftness), 1.0 + mfEdgeD(u.edgeSoftness), d);
  var outc  = col * ballA + halo * (1.0 - ballA);

  outc = clamp(outc * u.exposure, vec3<f32>(0.0), vec3<f32>(1.0));
  // The Orbs edge bank — the Edge group's Glow. Adding zero is exactly
  // the render this file was diffed against, and zero is the default.
  let edged = mfEdgeGlow(outc, uv, vec2<f32>(0.0), rad,
                         u.edgeSoftness, u.edgeGlow, u.glowColor.rgb);
  return vec4<f32>(clamp(edged, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
