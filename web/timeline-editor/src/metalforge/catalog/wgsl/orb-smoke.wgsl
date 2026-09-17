// Smoke Orb — smoke sealed inside a glass ball, floating in a wall-only studio
// void.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering. The eight floats sit back to back after
// `time`, and WGSL then pads to put `tint` on a 16-byte boundary — the packer
// mirrors that gap. The fourteen colours follow back to back on 16.
struct Uniforms {
  size:         vec2<f32>,
  time:         f32,
  speed:        f32,
  radius:       f32,
  density:      f32,
  detail:       f32,
  shadow:       f32,
  scatter:      f32,
  glow:         f32,
  exposure:     f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  tint:         vec4<f32>,
  keyColor:     vec4<f32>,
  fillColor:    vec4<f32>,
  rimColor:     vec4<f32>,
  wallColor:    vec4<f32>,
  wallTint:     vec4<f32>,
  lampColor:    vec4<f32>,
  bounceColor:  vec4<f32>,
  specColor:    vec4<f32>,
  softboxColor: vec4<f32>,
  hiColor:      vec4<f32>,
  edgeColor:    vec4<f32>,
  albedoColor:  vec4<f32>,
  albedoTint:   vec4<f32>,
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
fn smSstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn smHash(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

fn smNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = smHash(i);
  let b = smHash(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = smHash(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = smHash(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = smHash(i + vec3<f32>(0.0, 0.0, 1.0));
  let g = smHash(i + vec3<f32>(1.0, 0.0, 1.0));
  let j = smHash(i + vec3<f32>(0.0, 1.0, 1.0));
  let k = smHash(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

// Four octaves — the density field the camera ray reads.
fn smFbm(pIn: vec3<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * smNoise(p);
    p = p * 2.03 + vec3<f32>(7.1, 3.7, 1.3);
    a = a * 0.5;
  }
  return v;
}

// Two octaves — the shadow taps only need the silhouette, and they run twice
// per lit slice, so they get the cheap field.
fn smFbm2(p: vec3<f32>) -> f32 {
  return smNoise(p) * 0.62 + smNoise(p * 2.07 + vec3<f32>(7.1, 3.3, 1.7)) * 0.31;
}

// Henyey-Greenstein: how much of the key light keeps going forward through a
// scattering event. g is the Scatter slider.
fn smHg(ct: f32, g: f32) -> f32 {
  let gg = g * g;
  let d = 1.0 + gg - 2.0 * g * ct;
  return (1.0 - gg) / (12.5664 * d * sqrt(max(d, 1e-4)));
}

fn smAces(x: vec3<f32>) -> vec3<f32> {
  return clamp((x * (2.51 * x + vec3<f32>(0.03))) / (x * (2.43 * x + vec3<f32>(0.59)) + vec3<f32>(0.14)),
               vec3<f32>(0.0), vec3<f32>(1.0));
}

// Distance from p to the far side of the unit sphere along d.
fn smSphExit(p: vec3<f32>, d: vec3<f32>) -> f32 {
  let b = dot(p, d);
  return -b + sqrt(max(1.0 - dot(p, p) + b * b, 0.0));
}

// Incommensurate sines: the smoke kneads in place, never drifts.
fn smKnead(t: f32, a: f32, b: f32, c: f32, ph: f32) -> vec3<f32> {
  return vec3<f32>(sin(t * a) + 0.55 * sin(t * a * 0.41 + ph),
                   cos(t * b) + 0.55 * cos(t * b * 0.37 + ph * 1.7),
                   sin(t * c + ph * 2.3));
}

fn smSchlick(ct: f32, f0: f32) -> f32 {
  return f0 + (1.0 - f0) * pow(max(1.0 - ct, 0.0), 5.0);
}

// The room the ball floats in: a wall graded from Wall at the bottom to Wall
// tint at the top, plus two soft lamp bounces — Lamp up-left, Bounce right.
// There is no floor and nothing below the ball.
fn smStudioBG(p: vec2<f32>, wallC: vec3<f32>, wallT: vec3<f32>,
              lampC: vec3<f32>, bounceC: vec3<f32>) -> vec3<f32> {
  var wall = mix(wallC, wallT, smoothstep(-0.55, 1.25, p.y));
  let s1 = (p - vec2<f32>(-0.80, 0.74)) * vec2<f32>(1.00, 1.65);
  wall = wall + lampC * exp(-dot(s1, s1) * 1.30);
  let s2 = (p - vec2<f32>(0.94, 0.14)) * vec2<f32>(1.30, 2.05);
  wall = wall + bounceC * exp(-dot(s2, s2) * 1.85);
  return wall;
}

// The wall seen through the glass. One refracted lookup per channel at three
// indices of refraction is the dispersion: red bends least, blue most.
fn smBgThrough(uv: vec2<f32>, N: vec3<f32>, wallC: vec3<f32>, wallT: vec3<f32>,
               lampC: vec3<f32>, bounceC: vec3<f32>) -> vec3<f32> {
  let d1 = refract(vec3<f32>(0.0, 0.0, -1.0), N, 1.0 / 1.500);
  let d2 = refract(vec3<f32>(0.0, 0.0, -1.0), N, 1.0 / 1.524);
  let d3 = refract(vec3<f32>(0.0, 0.0, -1.0), N, 1.0 / 1.552);
  return vec3<f32>(smStudioBG(uv + d1.xy * 1.15, wallC, wallT, lampC, bounceC).r,
                   smStudioBG(uv + d2.xy * 1.15, wallC, wallT, lampC, bounceC).g,
                   smStudioBG(uv + d3.xy * 1.15, wallC, wallT, lampC, bounceC).b) * 2.6;
}

// The shell itself: a tight specular pinpoint over a broad one (Specular), a
// softbox streak up-left (Softbox), a second key from the right (Highlight),
// the fresnel limb (Rim) and the thin bright line at the very edge (Edge).
fn smGlassHi(N: vec3<f32>, su: vec2<f32>, z: f32, rimC: vec3<f32>, specC: vec3<f32>,
             softC: vec3<f32>, hiC: vec3<f32>, edgeC: vec3<f32>) -> vec3<f32> {
  let V = vec3<f32>(0.0, 0.0, 1.0);
  let L1 = normalize(vec3<f32>(-0.62, 0.60, 0.50));
  let L2 = normalize(vec3<f32>(0.66, 0.16, 0.72));
  let H1 = normalize(L1 + V);
  let H2 = normalize(L2 + V);
  let k = max(dot(N, H1), 0.0);
  var c = specC * (pow(k, 420.0) * 2.8 + pow(k, 46.0) * 0.11);
  let sb = (su - vec2<f32>(-0.44, 0.46)) * vec2<f32>(2.0, 4.4);
  c = c + softC * exp(-dot(sb, sb) * 2.2) * 0.26;
  c = c + hiC * pow(max(dot(N, H2), 0.0), 120.0) * 0.34;
  let e = smoothstep(0.86, 1.0, length(su));
  c = c + rimC * e * pow(1.0 - z, 1.6) * 0.26;
  c = c + edgeC * pow(smoothstep(0.972, 1.0, length(su)), 0.75) * 0.26;
  return c;
}

// The smoke: one fbm warping another, thresholded into wisps and faded out
// before the shell so nothing touches the glass from inside.
fn smSmk(p: vec3<f32>, t: f32, density: f32, detail: f32) -> f32 {
  let k = smKnead(t, 0.16, 0.13, 0.10, 1.4) * 0.40;
  let g = smFbm(p * 1.85 + k);
  let w = smFbm(p * detail + vec3<f32>(g * 1.85) + k.zxy * 0.6);
  return pow(smoothstep(0.30, 0.76, w), 1.5) * smSstep(1.0, 0.66, length(p)) * density;
}

// The same field on the two-octave fbm, for the shadow taps only.
fn smSmkLo(p: vec3<f32>, t: f32, density: f32, detail: f32) -> f32 {
  let k = smKnead(t, 0.16, 0.13, 0.10, 1.4) * 0.40;
  let w = smFbm2(p * detail + vec3<f32>(smFbm2(p * 1.85 + k) * 1.85) + k.zxy * 0.6);
  return pow(smoothstep(0.30, 0.76, w), 1.5) * smSstep(1.0, 0.66, length(p)) * density;
}

fn orbSmokeAnim(uv01: vec2<f32>) -> vec4<f32> {
  // The runner hands uv01 with y down from the top, like stitchable MSL's
  // `position`; the orb was authored bottom-left, so flip back.
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let t   = u.time * u.speed;
  let rad = max(u.radius, 0.05);
  let tn  = u.tint.rgb;

  // The four room colours are near-black, so each swatch carries the constant
  // normalised by its own maximum and is scaled back by that maximum here.
  // At the defaults these are exactly (0.0080, 0.0086, 0.0112),
  // (0.0016, 0.0016, 0.0027), (0.0210, 0.0220, 0.0270) and
  // (0.0080, 0.0092, 0.0135).
  let wallC   = u.wallColor.rgb   * 0.0112;
  let wallT   = u.wallTint.rgb    * 0.0027;
  let lampC   = u.lampColor.rgb   * 0.0270;
  let bounceC = u.bounceColor.rgb * 0.0135;

  // Disc space: the ball sits a touch above centre.
  let su = (uv - vec2<f32>(0.0, 0.06)) / rad;
  let r  = length(su);

  var col = smStudioBG(uv, wallC, wallT, lampC, bounceC);
  col = col + tn * exp(-max(r - 1.0, 0.0) * 7.0) * 0.05 * u.glow;

  if (r < 1.004 + mfEdgeD(u.edgeSoftness)) {
    let m = smSstep(1.0 + mfEdgeD(u.edgeSoftness), 1.0 - u.edgeSoftness, r);
    let z = sqrt(max(1.0 - r * r, 0.0));
    let N = vec3<f32>(su, z);
    let F = smSchlick(z, 0.045);
    let D = refract(vec3<f32>(0.0, 0.0, -1.0), N, 1.0 / 1.52);
    let bg = smBgThrough(uv, N, wallC, wallT, lampC, bounceC);

    // Start just inside the shell and march to where the refracted ray leaves
    // the sphere; that length is what the 16 slices divide.
    let P0 = N * 0.997;
    let len = smSphExit(P0, D);
    let L = normalize(vec3<f32>(-0.60, 0.62, 0.50));
    let ph = smHg(dot(D, L), clamp(u.scatter, 0.0, 0.95)) * 1.1 + 0.30;

    // The palette, bundled into one value. effects/_shared/ramp.ts.
    let pal = mfRampOf(u.paletteCount,
                       u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                       u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                       u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                       u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb);

    let albC = u.albedoColor.rgb;
    let albT = u.albedoTint.rgb;
    let keyC = u.keyColor.rgb;
    let filC = u.fillColor.rgb;

    var acc = vec3<f32>(0.0);
    var T: f32 = 1.0;
    let NS: i32 = 16;
    let dl = len / f32(NS);
    for (var i: i32 = 0; i < NS; i = i + 1) {
      let p = P0 + D * ((f32(i) + 0.5) * dl);
      let d = smSmk(p, t, u.density, u.detail);
      if (d > 0.012) {
        let sh = exp(-(smSmkLo(p + L * 0.17, t, u.density, u.detail) * 1.0
                     + smSmkLo(p + L * 0.42, t, u.density, u.detail) * 0.65) * u.shadow);
        let aa = 1.0 - exp(-d * 3.4 * dl);
        let lit = keyC * sh * ph * 1.8 + filC * 0.42;
        // The palette IS the smoke's albedo — what each sample of the volume is
        // coloured before the key and fill light it. Read on DENSITY, the same
        // parameter the two-colour albedo already ran along, so the stops sort
        // themselves from the wisps to the core. SELECTED, never branched
        // (effects/_shared/ramp.ts).
        let albT01 = clamp(d * 0.5, 0.0, 1.0);
        let alb = select(mix(albC, albT, albT01),
                         mfRampLinR(albT01, pal), u.paletteCount > 0.5);
        acc = acc + T * alb * lit * aa;
        T   = T * (1.0 - aa * 0.93);
      }
    }

    // What the smoke did not absorb is the wall behind it, dimmed toward the
    // limb where the glass is thickest.
    var inner = acc + bg * T;
    inner = inner * exp(-pow(1.0 - z, 2.0) * 0.60);
    var c = inner * (1.0 - F) * (0.35 + 0.65 * u.glow);
    c = c + smGlassHi(N, su, z, u.rimColor.rgb, u.specColor.rgb,
                      u.softboxColor.rgb, u.hiColor.rgb, u.edgeColor.rgb);
    col = mix(col, c, m);
  }

  col = pow(smAces(col * max(u.exposure, 0.0)), vec3<f32>(1.0 / 2.2));
  // The Orbs edge bank — the Edge group's Glow. Adding zero is exactly
  // the render this file was diffed against, and zero is the default.
  let edged = mfEdgeGlow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), uv, vec2<f32>(0.0, 0.06), rad,
                         u.edgeSoftness, u.edgeGlow, u.glowColor.rgb);
  return vec4<f32>(clamp(edged, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
