// Cyclone — a vortex read through the skin of a ball.
//
// Two fbm fields sample a slowly drifting warp, the ball's own coordinate is
// spun by an angle that decays as a gaussian in the radius plus a constant
// rate, and a five-octave fbm read in that spun frame ramps through four
// palette stops. A key lifts the upper-left shoulder, a fill darkens the lower
// right, the limb rolls off and a hash grain sits over it all.
//
// Transcribed from the "12 Cyclone" tile of the Thirteen Orbs design sheet:
// program B, branch md == 3, in its uMode > 3.5 spin form, with the palette and
// knobs of cfgs[40]. Every constant, octave count and threshold is the sheet's;
// Each parameter's default IS the constant it replaced — every one except
// `radius` and `speed`, which the Orbs family adds. `radius` (0.72) frames the
// ball inside the panel where the sheet let it fill its own canvas; set it to
// 1.0 to reproduce the sheet's framing exactly. `speed` is the sheet's clock
// rate (`cfg.rate * 1.5 * 0.45`) rounded onto the slider's step, so the
// default animates a fraction of a percent slow.
//
// This is one of three implementations of the same shader: orb-cyclone.metal is
// what an iOS user exports and orb-cyclone.sksl is the React Native half.
// Change the maths in one, change it in all three.
//
// Deliberately NOT ported from the sheet: the contact-shadow ellipse under the
// ball (the Orbs family has no floor, and the export paints over black); the
// ball div's own radial-gradient, which this canvas is opaque over and which
// shows only inside the ~2% rim feather; the other nine branches of program B
// and the `ridge` helper only they call; and `q = pp + warp*(w - 0.5)`, which
// the sheet computes above the branch and this branch never reads — `w` itself
// is kept, because the spin form does use it.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering. The nine floats sit back to back and
// end exactly on byte 48, so the five colours follow on 16-byte boundaries with
// no padding anywhere. There is no float2 param, and never a vec3 in a struct.
struct Uniforms {
  size:           vec2<f32>,
  time:           f32,
  speed:          f32,
  radius:         f32,
  zoom:           f32,
  warp:           f32,
  twist:          f32,
  spin:           f32,
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


// The liquid bank's hash — the one the sheet's three fluid programs share, and
// NOT the sin/dot hash its Prism screen uses. The two banks differ in gain,
// normalisation and rotation as well; mixing them changes every grain.
fn lqHash(pIn: vec2<f32>) -> f32 {
  var p = fract(pIn * vec2<f32>(123.34, 456.21));
  p = p + vec2<f32>(dot(p, p + vec2<f32>(45.32)));
  return fract(p.x * p.y);
}

// Bilinear value noise on the hash above, smoothstep-interpolated.
fn lqNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (vec2<f32>(3.0) - 2.0 * f);
  return mix(mix(lqHash(i),                        lqHash(i + vec2<f32>(1.0, 0.0)), f.x),
             mix(lqHash(i + vec2<f32>(0.0, 1.0)),  lqHash(i + vec2<f32>(1.0, 1.0)), f.x), f.y);
}

// Five octaves, gain 0.5, normalised by the weight sum, lattice rotated each
// octave. GLSL's mat2(.8,.6,-.6,.8) is COLUMN-major — its columns are (.8,.6)
// and (-.6,.8) — so the product is written out by hand rather than trusting a
// matrix constructor to read the same way in three languages.
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

// The sheet's four-stop ramp, its overlapping thresholds included.
fn lqRamp(v: f32, cA: vec3<f32>, cB: vec3<f32>, cC: vec3<f32>, cD: vec3<f32>) -> vec3<f32> {
  var c = mix(cA, cB, vec3<f32>(smoothstep(0.0, 0.45, v)));
  c = mix(c, cC, vec3<f32>(smoothstep(0.38, 0.72, v)));
  return mix(c, cD, vec3<f32>(smoothstep(0.68, 1.0, v)));
}

fn orbCycloneAnim(uv01: vec2<f32>) -> vec4<f32> {
  // The runner hands uv01 with y down from the top, like stitchable MSL's
  // `position`; the sheet composed this bottom-left, so flip back.
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let rad = max(u.radius, 0.05);

  // Nothing on this pixel: 0.995 is the far edge of the disc's own coverage,
  // `1 - smoothstep(0.955, 0.995, d)` at the bottom of this function, which is
  // EXACTLY zero past it — so the full path already returns opaque black here,
  // after computing the whole vortex and multiplying it by nothing. An
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
  // Ball space: |p| == 1 on the limb. On this tile the sheet's canvas box IS
  // its ball box, so the sheet's own uv and this p are the same coordinate.
  let p   = uv / rad;
  let d   = length(p);

  let pp = p * u.zoom;
  let w  = vec2<f32>(lqFbm(pp * 1.1 + vec2<f32>(0.0,  t * 0.09)),
                     lqFbm(pp * 1.1 + vec2<f32>(7.7, -t * 0.07)));

  // The spin form of the branch. The still form the sheet leaves above it —
  // 2.4*exp(-d*d*1.1)*sin(t*.15) + t*.05 — belongs to the tiles that set
  // uMode = 3 exactly; this one sets 3.7 and takes the other road.
  let an = u.twist * exp(-d * d * 1.1) + t * u.spin;
  let cs = cos(an);
  let sn = sin(an);
  // GLSL mat2(cs,-sn,sn,cs) is column-major: columns (cs,-sn) and (sn,cs).
  let rp = vec2<f32>(cs * p.x + sn * p.y, -sn * p.x + cs * p.y) * u.zoom * 3.0;

  let v = lqFbm(rp * 1.3 + u.warp * 0.3 * (w - vec2<f32>(0.5)));
  // The palette, bundled into one value. effects/_shared/ramp.ts.
  let pal = mfRampOf(u.paletteCount,
                     u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                     u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                     u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                     u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb);

  // The ramp's own [0,1] parameter, named because both readings want it.
  let cv = smoothstep(0.15, 0.85, v);
  var c = lqRamp(cv, u.colorA.rgb, u.colorB.rgb, u.colorC.rgb, u.colorD.rgb);
  // The palette IS this ramp — the user's colours land exactly where colorA..D
  // did, however many of them there are. SELECTED, never branched: an `if`
  // here splits the basic block and the grain hash below turns that into
  // speckle (effects/_shared/ramp.ts).
  c = select(c, mfRampLinR(cv, pal), u.paletteCount > 0.5);

  // The tail every liquid program on the sheet closes with. Only the first
  // term carries a colour; the other two are multiplicative darkening and stay
  // literal, and the grain is achromatic by construction.
  c = mix(c, u.highlightColor.rgb,
          vec3<f32>(u.shade * 0.3 * smoothstep(0.25, 1.25, dot(p, vec2<f32>(-0.32, 0.78)))));
  c = c * (1.0 - u.shade * 0.42 * smoothstep(-0.05, 1.25, dot(p, vec2<f32>(0.45, -0.62))));
  c = c * (1.0 - u.shade * 0.3 * smoothstep(0.72, 1.0, d));
  c = c + vec3<f32>((lqHash(p * 900.0 + vec2<f32>(t)) - 0.5) * 0.05 * u.grain);

  // The disc's own alpha, used here as the mask that fades the ball into the
  // black behind it. Everything off the ball must be exactly zero — the runner
  // derives the orb's coverage from what this paints.
  let ballA = 1.0 - smoothstep(0.955 - mfEdgeD(u.edgeSoftness), 0.995 + mfEdgeD(u.edgeSoftness), d);
  let col   = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)) * ballA * max(u.exposure, 0.0);
  // The Orbs edge bank — the Edge group's Glow. Adding zero is exactly
  // the render this file was diffed against, and zero is the default.
  let edged = mfEdgeGlow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), uv, vec2<f32>(0.0), rad,
                         u.edgeSoftness, u.edgeGlow, u.glowColor.rgb);
  return vec4<f32>(clamp(edged, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
