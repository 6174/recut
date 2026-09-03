// Soap Film Orb — thin-film interference on a bubble, front and back layers.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering. The nine floats sit back to back and
// land `haloColor` on a 16-byte boundary with no padding — the packer mirrors
// whatever gap there is. Every colour the shader paints with is one of these
// fields; there are no baked colour literals left.
struct Uniforms {
  size:       vec2<f32>,
  time:       f32,
  speed:      f32,
  radius:     f32,
  thickness:  f32,
  warp:       f32,
  crease:     f32,
  rim:        f32,
  glow:       f32,
  exposure:   f32,
  spectrum:   f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  haloColor:  vec4<f32>,
  baseColor:  vec4<f32>,
  bodyColor:  vec4<f32>,
  veilColor:  vec4<f32>,
  rimColor:   vec4<f32>,
  rimTintColor: vec4<f32>,
  specularColor: vec4<f32>,
  filmColor:  vec4<f32>,
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

// Optical path ~ thickness / cos(angle); per-channel frequency ~ 1/wavelength
// (R < G < B), so one thickness reads out as three shifted cosines.
//
// `spec` is the Spectrum knob: the three wavelengths are pulled toward one
// shared frequency of 1.0, so the amount of channel separation — the rainbow
// itself — is a slider. At spec = 1 the vector is exactly the original
// (1.0, 1.31, 1.68); at 0 all three channels share one frequency and the
// interference goes greyscale with its banding pattern intact; above 1 the
// channels spread further apart into tighter fringes.
fn sfInterf(th: f32, ca: f32, spec: f32) -> vec3<f32> {
  let d = th * (1.0 + (1.0 - ca) * 0.9);
  let baseF = vec3<f32>(1.0, 1.31, 1.68);
  let freq  = vec3<f32>(1.0) + (baseF - vec3<f32>(1.0)) * spec;
  return vec3<f32>(0.5) - 0.5 * cos(6.2831 * d * freq);
}

fn orbSoapFilmAnim(uv01: vec2<f32>) -> vec4<f32> {
  // The runner hands uv01 with y down from the top, like stitchable MSL's
  // `position`; the orb was authored bottom-left, so flip back.
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let t   = u.time * u.speed;
  let rad = max(u.radius, 0.05);
  let r   = length(uv);

  var col = u.haloColor.rgb * exp(-max(r - rad, 0.0) * 12.0) * 0.30 * u.glow;

  // The original wraps the film in `if (r < rad + .01)`, but fwidth inside a
  // divergent branch is indeterminate; the film is evaluated straight-line
  // instead and the disc mask composites it. Outside the disc that mask is
  // exactly zero, so the image is the same one.
  let m   = sfSstep(rad + mfEdgeD(u.edgeSoftness), rad - u.edgeSoftness, r);
  let z   = sqrt(max(rad * rad - r * r, 0.0));
  let nrm = vec3<f32>(uv, z) / rad;
  let ca  = nrm.z;
  let q   = nrm;

  // In-place churn: the warp offsets orbit on incommensurate sines, so the
  // film kneads without drifting or picking up a net rotation.
  let o1 = vec3<f32>(sin(t * 0.21) + 0.6 * sin(t * 0.083 + 1.7),
                     cos(t * 0.17) + 0.6 * sin(t * 0.071 + 0.4),
                     sin(t * 0.13 + 2.6)) * 0.55;
  let o2 = vec3<f32>(cos(t * 0.11 + 1.1),
                     sin(t * 0.14 + 3.9),
                     cos(t * 0.09)) * 0.42;

  let w1 = vec3<f32>(sfFbm(q * 1.6 + o1),
                     sfFbm(q * 1.6 + vec3<f32>(4.7, 0.0, 0.0) - o1.yzx),
                     sfFbm(q * 1.6 + vec3<f32>(9.2, 0.0, 0.0) + o1.zxy));
  let w2 = vec3<f32>(sfFbm(q * 2.4 + w1 * 1.9 + o2),
                     sfFbm(q * 2.4 + w1 * 2.1 + vec3<f32>(3.1, 0.0, 0.0) - o2.yxz),
                     0.0);

  let th = sfFbm(q * 1.3 + vec3<f32>(w2.xy, w2.x) * u.warp) * u.thickness
         + w1.x * 1.2 + sin(t * 0.15) * 0.35;
  // Fold creases: the gradient magnitude of the thickness field, in screen space.
  let e     = fwidth(th);
  let fold  = clamp(e * u.crease, 0.0, 1.0);
  // Film tint: whatever colour the interference becomes once Spectrum pulls it
  // off the rainbow. White (the default) is a no-op.
  let filmF = sfInterf(th, ca, u.spectrum) * u.filmColor.rgb;

  // Back surface: the second bounce, mirrored through the sphere interior.
  let qb  = vec3<f32>(-nrm.x, nrm.y, -nrm.z);
  let wb1 = vec3<f32>(sfFbm(qb * 1.8 + vec3<f32>(2.2, 0.0, 0.0) + o2.zyx * 0.8),
                      sfFbm(qb * 1.8 + vec3<f32>(7.7, 0.0, 0.0) - o1.xzy * 0.6),
                      0.0);
  let thB   = sfFbm(qb * 1.5 + vec3<f32>(wb1.xy, wb1.x) * 2.2) * 2.4 + wb1.x;
  let filmB = sfInterf(thB, ca * 0.7, u.spectrum) * u.filmColor.rgb;

  let fres  = pow(1.0 - ca, 2.1);
  let fresB = pow(1.0 - ca, 1.2);
  // Fringe brightness: strongest where the film folds (thickness gradient
  // high) and at grazing angles.
  let glint  = pow(fold, 1.6) * (0.25 + 1.9 * fres);
  let glintB = pow(clamp(fwidth(thB) * 6.0, 0.0, 1.0), 1.8) * (0.08 + 0.55 * fresB);

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
  let bodyT = smoothstep(-0.9, 1.0, uv.x * 0.45 - uv.y * 0.55 + w1.x * 0.9);
  var base = select(mix(u.baseColor.rgb, u.bodyColor.rgb, bodyT),
                    mfRampLinR(bodyT, pal), u.paletteCount > 0.5);
  base = base + u.veilColor.rgb * sfFbm(q * 1.1 + vec3<f32>(3.3));
  // Fresnel rim ramp: was vec3(0.10, 0.40, 1.0) -> vec3(0.80, 0.24, 1.0), now
  // both ends are parameters (defaults #1A66FF and #CC3DFF).
  let rimc = mix(u.rimColor.rgb, u.rimTintColor.rgb,
                 smoothstep(-0.8, 0.8, uv.x + uv.y * 0.35));

  var c = base;
  c = c + filmB * glintB * u.glow;
  c = c + filmF * glint * u.glow;
  c = c + rimc * fres * 1.15 * u.rim;
  c = c + filmF * fres * fres * 0.55 * u.glow;
  // Specular spark: was a bare vec3(1.0), now a colour (default #FFFFFF).
  c = c + u.specularColor.rgb * pow(glint * fres, 2.5) * 3.0;
  col = mix(col, c, m);

  col = vec3<f32>(1.0) - exp(-col * 1.8 * max(u.exposure, 0.0));
  // The Orbs edge bank — the Edge group's Glow. Adding zero is exactly
  // the render this file was diffed against, and zero is the default.
  let edged = mfEdgeGlow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), uv, vec2<f32>(0.0), rad,
                         u.edgeSoftness, u.edgeGlow, u.glowColor.rgb);
  return vec4<f32>(clamp(edged, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
