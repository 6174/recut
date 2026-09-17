// Caustics — layered internal caustic sheets kneading inside a glass ball.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering. The ten floats sit back to back; the
// first colour then rounds up to the next 16-byte boundary (the packer's
// align(16) and WGSL's own struct layout agree on that padding), after which
// the eight colours follow back to back.
struct Uniforms {
  size:       vec2<f32>,
  time:       f32,
  speed:      f32,
  radius:     f32,
  density:    f32,
  thickness:  f32,
  refraction: f32,
  warp:       f32,
  rim:        f32,
  glow:       f32,
  exposure:   f32,
  spectrum:   f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  haloColor:  vec4<f32>,
  tintColor:  vec4<f32>,
  bodyColor:  vec4<f32>,
  ambientColor:  vec4<f32>,
  rimColor:      vec4<f32>,
  rimTintColor:  vec4<f32>,
  specColor:     vec4<f32>,
  filmColor:     vec4<f32>,
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


// Every smoothstep in the original is a falling ramp (edge0 > edge1), which
// GLSL tolerates and WGSL leaves indeterminate; this spells the formula out.
fn caSstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn caHash(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

fn caNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = caHash(i);
  let b = caHash(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = caHash(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = caHash(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = caHash(i + vec3<f32>(0.0, 0.0, 1.0));
  let g = caHash(i + vec3<f32>(1.0, 0.0, 1.0));
  let j = caHash(i + vec3<f32>(0.0, 1.0, 1.0));
  let k = caHash(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

fn caFbm(pIn: vec3<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * caNoise(p);
    p = p * 2.03 + vec3<f32>(7.1, 3.7, 1.3);
    a = a * 0.5;
  }
  return v;
}

fn orbCausticsAnim(uv01: vec2<f32>) -> vec4<f32> {
  // The runner hands uv01 with y down from the top, like stitchable MSL's
  // `position`; the orb was authored bottom-left, so flip back.
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let t   = u.time * u.speed;
  let rad = max(u.radius, 0.05);
  let r   = length(uv);

  var col = u.haloColor.rgb * exp(-max(r - rad, 0.0) * 11.0) * 0.30 * u.glow;

  if (r < rad + 0.01 + mfEdgeD(u.edgeSoftness)) {
    let m   = caSstep(rad + mfEdgeD(u.edgeSoftness), rad - u.edgeSoftness, r);
    let su  = uv / rad;
    let z   = sqrt(max(1.0 - dot(su, su), 0.0));
    let nrm = vec3<f32>(su, z);

    // Two incommensurate offset fields: the sheets fold and unfold in place
    // instead of drifting across the ball.
    let o1 = vec3<f32>(sin(t * 0.17) + 0.6 * sin(t * 0.073 + 1.2),
                       cos(t * 0.15) + 0.6 * cos(t * 0.067 + 2.8),
                       sin(t * 0.11 + 4.1)) * 0.6;
    let o2 = vec3<f32>(cos(t * 0.13 + 0.7),
                       sin(t * 0.10 + 2.2),
                       cos(t * 0.08 + 5.0)) * 0.45;

    // Sheet half-width; the second shell is always 0.7 of the first.
    let sw = max(u.thickness, 0.005);

    // The caustic's colour is interference, not a constant: one cosine sampled
    // at three per-channel "wavelengths" so R, G and B band at different rates.
    // `spectrum` slides those three frequencies toward the single shared 1.0 —
    // at 1 this is exactly vec3(1.0, 1.32, 1.70) (1 + (A - 1) * 1 is bit-exact
    // A), at 0 all three channels band together and the sheets go achromatic
    // with the banding pattern intact, above 1 they separate further.
    let baseF = vec3<f32>(1.0, 1.32, 1.70);
    let freq  = vec3<f32>(1.0) + (baseF - vec3<f32>(1.0)) * u.spectrum;

    // Hoisted out of the march — thirteen uniform reads that do not vary
    // along the ray.
    // The palette, bundled into one value. effects/_shared/ramp.ts.
    let pal = mfRampOf(u.paletteCount,
                       u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                       u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                       u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                       u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb);

    var acc = vec3<f32>(0.0);
    var T: f32 = 1.0;
    let N: i32 = 16;
    let dl = 2.0 * z / f32(N);
    for (var i: i32 = 0; i < N; i = i + 1) {
      let fz   = z - (f32(i) + 0.5) * dl;
      let lens = su * (1.0 - u.refraction * (z - fz));   // deeper samples bend inward
      let p    = vec3<f32>(lens, fz);
      let rr   = length(p);
      let g    = caFbm(p * 1.9 + o1);
      let f    = caFbm(p * 1.3 + vec3<f32>(g * (u.warp + 0.3 * sin(t * 0.19))) + o2);
      // A caustic is a level set, not a blob: keep only where a field crosses
      // its threshold, squared so the shell stays thin.
      let sheet = pow(caSstep(sw, 0.0, abs(f - 0.48)), 2.0)
                + 0.7 * pow(caSstep(sw * 0.7, 0.0, abs(g - 0.55)), 2.0);
      let dens = sheet * caSstep(1.0, 0.6, rr) * u.density;
      let aa   = 1.0 - exp(-dens * 5.5 * dl);
      let th   = f * 2.4 + g * 1.4 + fz * 0.8 + sin(t * 0.12) * 0.3;
      // `filmColor` says what colour the interference is once `spectrum` has
      // collapsed it; white is a no-op multiply, so the default is untouched.
      // The palette IS the interference here. `th` is the optical thickness the
      // three cosines were already banding on, so the fringes keep their exact
      // pattern and only their colour changes — read CYCLICALLY, because that
      // is what a periodic film does. Unlike the liquids this is a real look
      // change rather than a no-op: the triplet's three frequencies BEAT
      // against each other and never repeat, and a ramp has one period. The
      // seed carries one period of the original, so the default palette is the
      // same rainbow on the same thickness. SELECTED, never branched
      // (effects/_shared/ramp.ts).
      var c    = select(vec3<f32>(0.5) - 0.5 * cos(6.2831 * th * freq),
                        mfRampCycR(th, pal), u.paletteCount > 0.5) * u.filmColor.rgb
               * (0.5 + 0.5 * caSstep(0.9, 0.3, rr));
      c = c + u.tintColor.rgb;
      acc = acc + T * c * aa * 1.7;
      T   = T * (1.0 - aa * 0.8);
    }

    // The body seen through whatever the sheets left unblocked. The ramp runs a
    // little past 0..1, so the lerp is spelled out and extrapolates the way
    // GLSL's mix does.
    let bw   = 0.5 + 0.5 * su.x - 0.4 * su.y;
    let dark = u.ambientColor.rgb;
    let base = dark + (u.bodyColor.rgb - dark) * bw;
    acc = acc + T * base;

    // The limb ramps from `rimColor` on one side to `rimTintColor` on the
    // other; both ends are parameters, so a grey pair gives a grey limb.
    let fres = pow(1.0 - z, 2.2);
    acc = acc + mix(u.rimColor.rgb, u.rimTintColor.rgb, 0.5 + 0.5 * su.x) * fres * 1.1 * u.rim;

    let L = normalize(vec3<f32>(-0.5, 0.6, 0.62));
    acc = acc + u.specColor.rgb * pow(max(dot(nrm, L), 0.0), 40.0) * 0.9;
    acc = acc * (0.2 + 0.8 * u.glow);
    col = mix(col, acc, m);
  }

  col = vec3<f32>(1.0) - exp(-col * 1.7 * max(u.exposure, 0.0));
  // The Orbs edge bank — the Edge group's Glow. Adding zero is exactly
  // the render this file was diffed against, and zero is the default.
  let edged = mfEdgeGlow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), uv, vec2<f32>(0.0), rad,
                         u.edgeSoftness, u.edgeGlow, u.glowColor.rgb);
  return vec4<f32>(clamp(edged, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
