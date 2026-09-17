// Ferrofluid Orb — a near-black magnetic mirror that flashes colour off its spikes.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic uniform
// packer can walk one ordering. The eight floats sit back to back, and WGSL then
// pads to put `bodyColor` on a 16-byte boundary — the packer mirrors that gap.
//
// The GLSL original declares `ridge` twice (a scalar one from the prelude and
// the vec3 one below). Only the vec3 one is reachable from main, and WGSL has no
// overloading, so the dead scalar version is dropped in all three ports.
//
// Every colour in the image is a uniform — the four lamps, the dark body and the
// bright end of its fresnel ramp, the key-light specular and the direct
// highlight. The only vec3 literals left are directions, hash weights and noise
// offsets, none of which is a colour.
struct Uniforms {
  size:           vec2<f32>,
  time:           f32,
  speed:          f32,
  radius:         f32,
  spikes:         f32,
  sharpness:      f32,
  relief:         f32,
  flank:          f32,
  glow:           f32,
  exposure:       f32,
  edgeSoftness:   f32,
  edgeGlow:       f32,
  paletteCount:   f32,
  bodyColor:      vec4<f32>,
  aquaColor:      vec4<f32>,
  violetColor:    vec4<f32>,
  magentaColor:   vec4<f32>,
  amberColor:     vec4<f32>,
  bodyTintColor:  vec4<f32>,
  specularColor:  vec4<f32>,
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


// The original leans on GLSL's smoothstep with edge0 > edge1 (a falling ramp);
// WGSL leaves that indeterminate, so both places spell the formula out.
fn ffSstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn ffHash(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

fn ffNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = ffHash(i);
  let b = ffHash(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = ffHash(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = ffHash(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = ffHash(i + vec3<f32>(0.0, 0.0, 1.0));
  let g = ffHash(i + vec3<f32>(1.0, 0.0, 1.0));
  let j = ffHash(i + vec3<f32>(0.0, 1.0, 1.0));
  let k = ffHash(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

fn ffFbm(pIn: vec3<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * ffNoise(p);
    p = p * 2.03 + vec3<f32>(7.1, 3.7, 1.3);
    a = a * 0.5;
  }
  return v;
}

// The spike field: fbm folded about 0.5 so its mid-band becomes a crest, then
// raised to a power that sets how needle-like the cones read.
fn ffRidge(p: vec3<f32>, k: f32) -> f32 {
  return pow(1.0 - abs(ffFbm(p) - 0.5) * 2.0, k);
}

// Incommensurate sines: the field kneads in place, never drifts.
fn ffKnead(t: f32, a: f32, b: f32, c: f32, ph: f32) -> vec3<f32> {
  return vec3<f32>(sin(t * a) + 0.55 * sin(t * a * 0.41 + ph),
                   cos(t * b) + 0.55 * cos(t * b * 0.37 + ph * 1.7),
                   sin(t * c + ph * 2.3));
}

// Schlick fresnel — f0 is high here, which is what makes the body a mirror.
fn ffSch(ct: f32, f0: f32) -> f32 {
  return f0 + (1.0 - f0) * pow(max(1.0 - ct, 0.0), 5.0);
}

// The environment: four unit-sphere lights on slow incommensurate orbits,
// blended by an exponential lobe so a direction sees mostly the nearest one.
fn ffEnv(d: vec3<f32>, t: f32, cA: vec3<f32>, cB: vec3<f32>, cC: vec3<f32>, cD: vec3<f32>) -> vec3<f32> {
  let p0 = normalize(vec3<f32>(sin(t * 0.088 + 0.0), 0.65 * sin(t * 0.068 + 0.0), cos(t * 0.096 + 0.0)));
  let p1 = normalize(vec3<f32>(sin(t * 0.101 + 2.1), 0.65 * sin(t * 0.079 + 2.7), cos(t * 0.113 + 1.5)));
  let p2 = normalize(vec3<f32>(sin(t * 0.114 + 4.3), 0.65 * sin(t * 0.090 + 5.6), cos(t * 0.130 + 3.0)));
  let p3 = normalize(vec3<f32>(sin(t * 0.127 + 1.2), 0.65 * sin(t * 0.101 + 1.6), cos(t * 0.147 + 0.8)));
  let w0 = exp(4.8 * (dot(d, p0) - 1.0));
  let w1 = exp(4.8 * (dot(d, p1) - 1.0));
  let w2 = exp(4.8 * (dot(d, p2) - 1.0));
  let w3 = exp(4.8 * (dot(d, p3) - 1.0));
  return (w0 * cA + w1 * cB + w2 * cC + w3 * cD) / (w0 + w1 + w2 + w3 + 1e-4);
}

fn ffAces(x: vec3<f32>) -> vec3<f32> {
  return clamp((x * (2.51 * x + vec3<f32>(0.03))) / (x * (2.43 * x + vec3<f32>(0.59)) + vec3<f32>(0.14)),
               vec3<f32>(0.0), vec3<f32>(1.0));
}

fn orbFerrofluidAnim(uv01: vec2<f32>) -> vec4<f32> {
  // The runner hands uv01 with y down from the top, like stitchable MSL's
  // `position`; the orb was authored bottom-left, so flip back.
  let fc = vec2<f32>(uv01.x, 1.0 - uv01.y) * u.size;
  let uv = (2.0 * fc - u.size) / max(min(u.size.x, u.size.y), 1.0);

  let t   = u.time * u.speed;
  let rad = max(u.radius, 0.05);
  let r   = length(uv);

  let cA = u.aquaColor.rgb;
  let cB = u.violetColor.rgb;
  let cC = u.magentaColor.rgb;
  let cD = u.amberColor.rgb;

  // Outside the disc, the same environment bled through a tight falloff.
  var col = ffEnv(normalize(vec3<f32>(uv, 0.5)), t, cA, cB, cC, cD)
          * exp(-max(r - rad, 0.0) * 8.0) * 0.12 * u.glow;

  if (r < rad + 0.01 + mfEdgeD(u.edgeSoftness)) {
    let m  = ffSstep(rad + mfEdgeD(u.edgeSoftness), rad - u.edgeSoftness, r);
    let su = uv / rad;
    let z  = sqrt(max(1.0 - dot(su, su), 0.0));
    let N  = vec3<f32>(su, z);
    let V  = vec3<f32>(0.0, 0.0, 1.0);

    // Sample the spike field in the sphere's own frame, kneaded by time.
    let w = N * u.spikes + ffKnead(t, 0.18, 0.14, 0.11, 2.6) * 0.7;

    // Central differences give the field's gradient; its tangential part is
    // what tilts the normal, so the cones lean rather than merely brighten.
    let e  = 0.05;
    let gr = vec3<f32>(ffRidge(w + vec3<f32>(e, 0.0, 0.0), u.sharpness) - ffRidge(w - vec3<f32>(e, 0.0, 0.0), u.sharpness),
                       ffRidge(w + vec3<f32>(0.0, e, 0.0), u.sharpness) - ffRidge(w - vec3<f32>(0.0, e, 0.0), u.sharpness),
                       ffRidge(w + vec3<f32>(0.0, 0.0, e), u.sharpness) - ffRidge(w - vec3<f32>(0.0, 0.0, e), u.sharpness));
    let gt = gr - N * dot(gr, N);
    let Nn = normalize(N - gt * u.relief);

    let spk = ffRidge(w, u.sharpness);
    let ndv = max(dot(Nn, V), 0.0);
    let fr  = ffSch(ndv, 0.90);
    let R   = reflect(-V, Nn);

    var env = ffEnv(R, t, cA, cB, cC, cD) * (0.16 + 0.84 * smoothstep(-1.0, 1.0, R.y));
    let K   = normalize(vec3<f32>(-0.55, 0.62, 0.56));
    let k   = max(dot(R, K), 0.0);
    let spc = u.specularColor.rgb;
    env = env + spc * pow(k, 420.0) * 7.0 + spc * pow(k, 26.0) * 0.28;
    env = env * (1.0 - 0.58 * ffSstep(-0.15, -1.0, R.y));

    // The palette, bundled into one value. effects/_shared/ramp.ts.
    let pal = mfRampOf(u.paletteCount,
                       u.paletteStop0.rgb, u.paletteStop1.rgb, u.paletteStop2.rgb,
                       u.paletteStop3.rgb, u.paletteStop4.rgb, u.paletteStop5.rgb,
                       u.paletteStop6.rgb, u.paletteStop7.rgb, u.paletteStop8.rgb,
                       u.paletteStop9.rgb, u.paletteStop10.rgb, u.paletteStop11.rgb);

    // The palette IS the ferrofluid's body — the thing the four-lobe environment
    // above is multiplied INTO. Spread along the Fresnel term, so the stops run
    // from face to limb across the spikes rather than flooding them.
    // SELECTED, never branched (effects/_shared/ramp.ts).
    var c = env * select(mix(u.bodyColor.rgb, u.bodyTintColor.rgb, fr),
                         mfRampLinR(fr, pal), u.paletteCount > 0.5);
    c = c + ffEnv(Nn, t, cA, cB, cC, cD) * pow(spk, 2.0) * pow(1.0 - ndv, 1.5) * u.flank;
    c = c + u.highlightColor.rgb * pow(max(dot(Nn, normalize(K + V)), 0.0), 300.0) * 3.2;
    c = c * (0.30 + 0.70 * smoothstep(-0.9, 0.45, Nn.y));
    c = c * (0.35 + 0.65 * u.glow);
    col = mix(col, c, m);
  }

  col = pow(ffAces(col * max(u.exposure, 0.0)), vec3<f32>(1.0 / 2.2));
  // The Orbs edge bank — the Edge group's Glow. Adding zero is exactly
  // the render this file was diffed against, and zero is the default.
  let edged = mfEdgeGlow(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), uv, vec2<f32>(0.0), rad,
                         u.edgeSoftness, u.edgeGlow, u.glowColor.rgb);
  return vec4<f32>(clamp(edged, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
