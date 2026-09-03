// Abalone — paua nacre, swirled growth bands with dark ridge grooves.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic uniform
// packer can walk one ordering. size + time + the nine floats fill 48 bytes
// exactly, so the colours follow with no padding — the packer arrives at the
// same offsets.
struct Uniforms {
  size:           vec2<f32>,
  time:           f32,
  speed:          f32,
  radius:         f32,
  swirl:          f32,
  thickness:      f32,
  bands:          f32,
  grooves:        f32,
  glow:           f32,
  exposure:       f32,
  spectrum:       f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  tintColor:      vec4<f32>,
  shellColor:     vec4<f32>,
  sheenColor:     vec4<f32>,
  bloomColor:     vec4<f32>,
  bounceColor:    vec4<f32>,
  wallColor:      vec4<f32>,
  wallTintColor:  vec4<f32>,
  lampColor:      vec4<f32>,
  fillColor:      vec4<f32>,
  keyColor:       vec4<f32>,
  irisColor:      vec4<f32>,
  irisTintColor:  vec4<f32>,
  shellTintColor: vec4<f32>,
  specColor:      vec4<f32>,
  filmColor:      vec4<f32>,
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


// Every colour the shader paints with is a parameter — nothing is a literal.
// Five of them are near-black in the original (the two wall ends, the two lamp
// spills and the shell's dark base), too dark to survive a 0–255 swatch, so
// each is exposed normalised by its own maximum and scaled back by that maximum
// at the point of use (0.0112, 0.0027, 0.0270, 0.0135, 0.07). At the defaults
// the products are the original constants to within a millionth.

// The original leans on GLSL's smoothstep with edge0 > edge1 (a falling ramp);
// WGSL leaves that indeterminate, so every such site spells the formula out.
fn abSstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn abHash(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

fn abNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = abHash(i);
  let b = abHash(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = abHash(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = abHash(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = abHash(i + vec3<f32>(0.0, 0.0, 1.0));
  let g = abHash(i + vec3<f32>(1.0, 0.0, 1.0));
  let j = abHash(i + vec3<f32>(0.0, 1.0, 1.0));
  let k = abHash(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

fn abFbm(pIn: vec3<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * abNoise(p);
    p = p * 2.03 + vec3<f32>(7.1, 3.7, 1.3);
    a = a * 0.5;
  }
  return v;
}

// Filmic tonemap; the caller gamma-encodes what comes out.
fn abAces(x: vec3<f32>) -> vec3<f32> {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14),
               vec3<f32>(0.0), vec3<f32>(1.0));
}

// The one rotation the shell has — the nacre field turns with it, the
// silhouette does not.
fn abRotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// The room: a graded back wall with two soft lamp spills, and nothing else.
// There is no floor — the orb stands in a void, so no horizon, no contact
// shadow and no reflection.
fn abStudioBG(p: vec2<f32>, wallC: vec3<f32>, wallT: vec3<f32>,
              lampC: vec3<f32>, fillC: vec3<f32>) -> vec3<f32> {
  var wall = mix(wallC * 0.0112, wallT * 0.0027, smoothstep(-0.55, 1.25, p.y));
  let s1 = (p - vec2<f32>(-0.80, 0.74)) * vec2<f32>(1.00, 1.65);
  wall = wall + lampC * 0.0270 * exp(-dot(s1, s1) * 1.30);
  let s2 = (p - vec2<f32>(0.94, 0.14)) * vec2<f32>(1.30, 2.05);
  wall = wall + fillC * 0.0135 * exp(-dot(s2, s2) * 1.85);
  return wall;
}

// What the shell mirrors: the room re-sampled along the reflected direction,
// three specular lobes off one key light, an iridescent band across the
// reflection and a warm bounce underneath.
fn abEnvMirror(uv: vec2<f32>, R: vec3<f32>, keyP: f32, keyI: f32,
               wallC: vec3<f32>, wallT: vec3<f32>, lampC: vec3<f32>, fillC: vec3<f32>,
               keyC: vec3<f32>, irisC: vec3<f32>, irisT: vec3<f32>,
               sheen: vec3<f32>, bloom: vec3<f32>, bounce: vec3<f32>) -> vec3<f32> {
  let L1 = normalize(vec3<f32>(-0.60, 0.64, 0.48));
  var e = abStudioBG(uv * 0.55 + R.xy * 0.72, wallC, wallT, lampC, fillC) * 7.5;
  e = e + keyC * pow(max(dot(R, L1), 0.0), keyP) * keyI;
  e = e + sheen * pow(max(dot(R, L1), 0.0), 22.0) * 0.55;
  e = e + bloom * pow(max(dot(R, L1), 0.0), 4.0) * 0.30;
  e = e + mix(irisC, irisT, 0.5 + 0.5 * R.x) * pow(1.0 - abs(R.y), 3.0) * 0.42;
  e = e + bounce * abSstep(0.2, -0.9, R.y) * 0.16;
  return e;
}

fn orbAbaloneAnim(uv01: vec2<f32>) -> vec4<f32> {
  // The runner hands uv01 with y down from the top, like stitchable MSL's
  // `position`; the orb was authored bottom-left, so flip back.
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let t    = u.time * u.speed;
  let rad  = max(u.radius, 0.05);
  let tint = u.tintColor.rgb;

  // The room's four colours, threaded through both room functions.
  let wallC = u.wallColor.rgb;
  let wallT = u.wallTintColor.rgb;
  let lampC = u.lampColor.rgb;
  let fillC = u.fillColor.rgb;

  // Orb space: the sphere sits a touch above centre, and one unit is its edge.
  let su = (uv - vec2<f32>(0.0, 0.06)) / rad;
  let r  = length(su);

  var col = abStudioBG(uv, wallC, wallT, lampC, fillC);
  col = col + tint * exp(-max(r - 1.0, 0.0) * 11.0) * 0.045 * u.glow;

  if (r < 1.004 + mfEdgeD(u.edgeSoftness)) {
    let m = abSstep(1.0 + mfEdgeD(u.edgeSoftness), 1.0 - u.edgeSoftness, r);
    let z = sqrt(max(1.0 - r * r, 0.0));
    let N = vec3<f32>(su, z);
    let V = vec3<f32>(0.0, 0.0, 1.0);
    let L = normalize(vec3<f32>(-0.58, 0.62, 0.52));

    // The growth field: a coarse fbm on the turning normal, and a finer one the
    // coarse field warps. `sw` is what everything else is read off.
    let d  = abRotY(N, t * 0.035);
    let g  = abFbm(d * 2.4 + vec3<f32>(0.0, t * 0.03, 0.0));
    let sw = abFbm(d * 4.8 + vec3<f32>(g * u.swirl));

    // Thin-film thickness, thicker where the growth piled up and at the limb,
    // read out at three wavelengths as the nacre colour. The triplet
    // (1.0, 1.45, 1.88) is a set of wavelengths, not a colour — which is exactly
    // why no swatch could reach the rainbow it makes. `spectrum` lerps the three
    // toward one shared frequency: at 1 the result is the original triple to the
    // bit (1 + (A - 1) * 1 == A), at 0 the channels band together and the film
    // goes greyscale for `filmColor` to tint. The band term rotates the channels
    // afterwards, so one ring over is a different hue; the tint is applied after
    // that rotation so a chosen colour stays that colour.
    let bnd = sin((d.x + d.y * 0.7) * u.bands + sw * 8.0) * 0.5 + 0.5;
    let th  = 0.9 + g * u.thickness + sw * 1.5 + (1.0 - z) * 1.2;
    let baseF = vec3<f32>(1.0, 1.45, 1.88);
    let freq  = vec3<f32>(1.0) + (baseF - vec3<f32>(1.0)) * u.spectrum;
    // The palette, bundled into one value. effects/_shared/ramp.ts.
    let pal = mfRampOf(u.paletteCount,
                       u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                       u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                       u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                       u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb);

    // The palette IS the nacre. `th` is the optical thickness the three
    // wavelengths were already banding on, so the growth rings keep their exact
    // pattern and only their colour changes — read CYCLICALLY, because a film is
    // periodic. Like the other interference orbs this is a real look change: the
    // triplet's frequencies (1, 1.45, 1.88) beat and never repeat, and a ramp has
    // one period. SELECTED, never branched (effects/_shared/ramp.ts).
    let nac0 = select(vec3<f32>(0.5) - 0.5 * cos(6.2831853 * th * freq),
                      mfRampCycR(th, pal), u.paletteCount > 0.5);
    let nac = mix(nac0, nac0.gbr, bnd * 0.45) * u.filmColor.rgb;

    // The crest of the warp field: the shell's ridge lines, which both catch the
    // film and cut the dark groove down their middle.
    let ridge = pow(1.0 - abs(sw - 0.5) * 2.0, u.grooves);
    let body  = mix(u.shellTintColor.rgb * 0.07, u.shellColor.rgb, g);
    let lam   = 0.30 + 0.70 * max(dot(N, L), 0.0);

    var c = body * lam;
    c = c + nac * (0.30 + 0.55 * pow(1.0 - z, 1.6) + 0.45 * ridge) * 1.35 * u.glow;
    c = c + nac * pow(max(dot(N, normalize(L + V)), 0.0), 14.0) * 0.9;
    c = c * (1.0 - ridge * 0.35);
    c = c + u.specColor.rgb * pow(max(dot(N, normalize(L + V)), 0.0), 260.0) * 1.3;
    c = c + abEnvMirror(uv, reflect(-V, N), 800.0, 5.5,
                        wallC, wallT, lampC, fillC,
                        u.keyColor.rgb, u.irisColor.rgb, u.irisTintColor.rgb,
                        u.sheenColor.rgb, u.bloomColor.rgb, u.bounceColor.rgb) * nac * 0.30;
    c = c * (0.32 + 0.68 * smoothstep(-0.95, 0.33, N.y));
    c = c * (0.35 + 0.65 * u.glow);
    col = mix(col, c, m);
  }

  col = pow(abAces(col * max(u.exposure, 0.0)), vec3<f32>(1.0 / 2.2));
  // The Orbs edge bank — the Edge group's Glow. Adding zero is exactly
  // the render this file was diffed against, and zero is the default.
  let edged = mfEdgeGlow(col, uv, vec2<f32>(0.0, 0.06), rad,
                         u.edgeSoftness, u.edgeGlow, u.glowColor.rgb);
  return vec4<f32>(clamp(edged, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
