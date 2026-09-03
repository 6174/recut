// Ridge — a frosted white sheet with a coloured landscape glowing up from
// behind it. This is the preview half.
//
// Ported from the study's Level 2 sheet (Wmetal01/Level2/PeakGlowCard.swift,
// design tiles 03 / 04 / 06). Unlike the eight Level 1 cards, which are CSS
// box-shadows and linear gradients, this one is drawn from `<path d="…">`
// strings: three filled silhouettes stacked light to dark, each blurred, over a
// white card.
//
// Three things the port changes on purpose:
//
// 1. Nothing is actually blurred. A Gaussian-blurred step edge is the normal CDF
//    of the signed distance, and `smoothstep(-K*sigma, K*sigma, d)` matches that
//    CDF to well under a level — so each silhouette is one distance evaluation
//    instead of an offscreen plate. The distance to a filled ridge is the
//    VERTICAL gap to the curve, divided by sqrt(1 + slope^2) to make it
//    perpendicular; that correction is what keeps the indigo slope's soft edge
//    the same width all the way up rather than fanning out where the curve is
//    steep.
//
// 2. The three layers PARALLAX along the light. The displacement is written
//    against (0,1) rather than against `ldir` itself, so it is exactly zero at
//    the default light and the card reproduces the reference render at rest. The
//    front layer moves furthest — that difference is what reads as depth.
//
// 3. The closing edge of each path is dropped. Every path finishes
//    `L…,440 L…,440 Z`, i.e. 56 design units BELOW the card, and the shader
//    fills everything under the ridge instead. Measured: including that edge
//    changes the darkest layer's alpha by nothing and the brightest layer's by
//    7% at the very bottom row, where two darker layers are painted over it —
//    a residual under 1% of one level.
//
// EVERY distance is in the study's own design units (a 300x384 board) and
// scaled at use, so resizing the card preserves the look. `L2Path` stretched a
// path to whatever frame it was given (`preserveAspectRatio="none"`), so the
// design box maps onto the card per-axis — that is `sx`/`sy` below. Blur,
// corner radius and grain use the single uniform `gs`, exactly as the study
// multiplied them all by `width / 300`.
//
// The one thing here that is NOT a port is the Animation group: three ways to
// move the landscape (Wave / Swell / Drift), a light that wanders, an intensity
// that breathes and grain that re-rolls. Every one of them is a DISPLACEMENT of
// the same baked curves, evaluated inside the coverage integral, so the
// geometry, the colours and the blur are untouched — and `Animation = Off`
// returns the reference still exactly.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic uniform
// packer can walk one ordering. Eighteen scalars land `card` on a multiple of 8
// and `light` on a multiple of 16, so the struct needs no implicit padding.
//
//
// MEASURED against the SwiftUI reference (Wmetal01 Level2Probe at 300pt, the
// card cropped and both resampled to 360x360): 0.88-0.97 mean 8-bit levels
// across the three styles, p99 of 6. For scale, the eight Level 1 cards sit at
// 0.8-4.8 and Peaks at 6.8. What is left is the grain, which is stochastic by
// construction and can only agree statistically.
// ridge.metal and ridge.sksl are the other two implementations of this same
// maths. Change one, change all three — and the block between the
// `@gen-l2-paths` markers is written by tools/gen-l2-ridges.mjs into all three
// at once, so paths are never hand-edited.
struct Uniforms {
  size:        vec2<f32>,
  time:        f32,
  // The 0-based index of the Style option: 0 violet, 1 indigo, 2 graphite.
  style:       f32,
  // The 0-based index of the Animation option: 0 wave, 1 swell, 2 drift,
  // 3 off. `off` is the study's still.
  anim:        f32,
  radius:      f32,
  layer1Blur:  f32,
  layer2Blur:  f32,
  layer3Blur:  f32,
  grainAmt:    f32,
  grainFreq:   f32,
  intensity:   f32,
  // The shadow bank's strength knob. Its TINT is a colour and so sits with the
  // other vec4s below — the bank's two keys are the one pair in the catalog
  // that does not travel together in `mslArgOrder`.
  shadowAmt:   f32,
  // The animation knobs. EIGHT of them, which is also what keeps this struct
  // padding-free: eighteen scalars land `card` on 80 and the colours on 96.
  animSpeed:   f32,
  animAmount:  f32,
  animSpread:  f32,
  waveFreq:    f32,
  lightSway:   f32,
  grainDrift:  f32,
  glowPulse:   f32,
  card:        vec2<f32>,
  light:       vec2<f32>,
  bgColor:     vec4<f32>,
  layer1Color: vec4<f32>,
  layer2Color: vec4<f32>,
  layer3Color: vec4<f32>,
  shadowColor: vec4<f32>,
  // The shared filter bank's fourteen. LAST, mirroring `mslArgOrder` in
  // config.ts — lib/preview/runner.ts packs this struct POSITIONALLY from that
  // list, so a field out of order silently writes every later value into the
  // wrong slot.
  //
  // `filterId`, not `filter`: the latter is a RESERVED KEYWORD in WGSL. It is
  // legal in MSL and SkSL, so only this file renames it, and the packer matches
  // by position rather than by name so nothing else cares.
  filterId:    f32,
  fAmount:     f32,
  fScale:      f32,
  fBlur:       f32,
  fFade:       f32,
  fSoft:       f32,
  fAngle:      f32,
  fGrain:      f32,
  fBrightness: f32,
  fContrast:   f32,
  fSaturation: f32,
  fRound:      f32,
  fBevel:      f32,
  fInset:      f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

// ── The shared card-shadow bank (WGSL) ──────────────────────────────────────
//
// The preview half of effects/_shared/shadow.metal. Same maths, same constants.
//
// Names carry no underscores, matching the WGSL house style in the card
// shaders, and nothing here reads `u` — the bank takes everything as arguments
// so the splice point never has to sit below the uniform block.

// smoothstep half-width, in sigmas, that best matches a Gaussian CDF.
const MFSK: f32 = 2.104;

// `box-shadow: 0 34px 70px -24px`, in reference pixels at the 320x420 design.
const MFSOFF: f32 = 34.0;
const MFSBLUR: f32 = 70.0;
const MFSSPREAD: f32 = -24.0;

// Peak alpha at Shadow = 1; `shadowAmt` scales it.
const MFSALPHA: f32 = 0.55;

/// Signed distance to a rounded rectangle — negative inside.
fn mfsSdRoundBox(p: vec2<f32>, ext: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - ext + vec2<f32>(r);
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

/// Paint the card's drop-glow onto the canvas, before the card is composited
/// over it. `q` is view-centred pixels and `ldir` the card's own light
/// direction, so the glow falls the way the light does.
fn mfsCardShadow(dst: vec3<f32>, q: vec2<f32>, ext: vec2<f32>, r: f32, gs: f32,
                 ldir: vec2<f32>, amt: f32, inten: f32, tint: vec3<f32>) -> vec3<f32> {
  let spread = MFSSPREAD * gs;
  let sext = max(ext + vec2<f32>(spread), vec2<f32>(0.0));
  let sr = clamp(r + spread, 0.0, min(sext.x, sext.y));
  let off = ldir * MFSOFF * gs;
  // CSS blur radius is 2 sigma.
  let sigma = max(MFSBLUR * gs * 0.5, 0.0001);
  let d = mfsSdRoundBox(q - off, sext, sr);
  let cov = 1.0 - smoothstep(-MFSK * sigma, MFSK * sigma, d);
  return mix(dst, tint, clamp(cov * MFSALPHA * amt * inten, 0.0, 1.0));
}


// ── constants ────────────────────────────────────────────────────────────────

// Half the study's board, 300x384 — the space every path below is written in.
const GREFX: f32 = 150.0;
const GREFY: f32 = 192.0;

// smoothstep half-width, in sigmas, that best matches a Gaussian CDF.
// Phi has a 10-90 width of 2*1.2816*sigma; smoothstep(-a,a,x) has 1.218*a.
// Equating gives a = 2.104*sigma.
const GK: f32 = 2.104;

// The DC canvas the study was rendered on (body background #07070B).
const GCANVAS: vec3<f32> = vec3<f32>(0.02745098, 0.02745098, 0.04313725);

// Parallax, in design units of travel per unit of light displacement. The front
// layer moves furthest; that difference is the depth cue.
const GPAR1: f32 = 10.0;
const GPAR2: f32 = 16.0;
const GPAR3: f32 = 22.0;

// l2Grain(baseFrequency, 3 octaves, gain 0.26, seed 17), opacity 0.2, overlay.
// THREE octaves here, matching Level2Noise.metal.
const GGAIN: f32 = 0.26;
const GSEED: f32 = 17.0;

// ── animation ────────────────────────────────────────────────────────────────
// How far each layer moves at Depth = 1, as a fraction of the front layer's
// travel. Same ordering as the parallax constants above and for the same
// reason: the difference between the layers is the depth cue.
const GAW2: f32 = 0.62;
const GAW3: f32 = 0.38;

// Peak travel at Motion = 1, in design units. Wave is the smallest because it
// is a shape change rather than a move — 14 units of ripple on a ridge already
// reads clearly, and more turns the silhouette into a corrugation.
const GAMP_WAVE: f32 = 14.0;
const GAMP_SWELL: f32 = 22.0;
const GAMP_DRIFT: f32 = 34.0;

// Drift's front layer sweeps +/-34 design units and the coverage integral
// reaches a further 1.8 sigma; the paths are defined out to -70..370 against a
// 0..300 card, so even at Motion = 2 the sweep stays inside the table and never
// runs off its clamped ends mid-card.
const GTAU: f32 = 6.28318530718;

// Five-node Gaussian quadrature along x — see gRidgeCoverage. Nodes in sigmas,
// weights exp(-n^2/2) normalised to sum to exactly 1.
const GQN1: f32 = 0.9;
const GQN2: f32 = 1.8;
const GQW0: f32 = 0.36633;
const GQW1: f32 = 0.24434;
const GQW2: f32 = 0.07249;

// ── helpers ──────────────────────────────────────────────────────────────────

/// The frame the card is measured in: the 393x851 reference iPhone, fitted
/// inside whatever view we are handed. `card` is a fraction of THIS, never of
/// the view — `card * res` stretched the rounded rect into a letterbox the
/// moment the canvas stopped being phone-shaped (a sidebar row, a square
/// gallery tile, an iPad), which is the one thing a card must never do.
fn gCardFrame(res: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(393.0, 851.0) * max(min(res.x / 393.0, res.y / 851.0), 0.0001);
}

/// Signed distance to a rounded rectangle — negative inside.
fn gSdRoundBox(p: vec2<f32>, ext: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - ext + vec2<f32>(r);
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

/// A blurred step across a signed distance: 1 inside, 0 outside, `sigma` wide.
/// The one primitive every soft edge in this card is built from.
fn gCoverage(d: f32, sigma: f32) -> f32 {
  let s = max(sigma, 0.0001);
  return 1.0 - smoothstep(-GK * s, GK * s, d);
}

/// Source-over with a straight (non-premultiplied) source.
fn gOver(dst: vec3<f32>, src: vec3<f32>, a: f32) -> vec3<f32> {
  return mix(dst, src, clamp(a, 0.0, 1.0));
}

/// Parallax for a layer with no offset shadow to carry the light.
///
/// EXACTLY ZERO at the default light (0.5, 1.0) — which is what guarantees this
/// card reproduces its SwiftUI reference at rest, and is why the term is written
/// as a displacement from (0,1) rather than as `ldir` itself.
fn gParallax(ldir: vec2<f32>, k: f32) -> vec2<f32> {
  return (ldir - vec2<f32>(0.0, 1.0)) * k;
}

/// The animation clock. ONE gate for the whole feature: `Animation = Off`
/// returns zero here, and every moving term below is written to vanish at t=0,
/// so the card falls back to the reference render exactly rather than nearly.
/// Speed 0 freezes the pose instead — the ripple stays, the clock stops.
fn gAnimT() -> f32 {
  if (i32(u.anim + 0.5) > 2) { return 0.0; }
  return u.time * max(u.animSpeed, 0.0);
}

/// How far layer `layerIdx` travels, relative to the front one. Depth = 0 moves
/// the three silhouettes as one slab; 1 is the study's own depth ordering.
fn gAnimWeight(layerIdx: i32) -> f32 {
  var w = 1.0;
  if (layerIdx == 1) { w = GAW2; }
  else if (layerIdx == 2) { w = GAW3; }
  return mix(1.0, w, clamp(u.animSpread, 0.0, 2.0));
}

/// Where layer `layerIdx` has moved to at design-x `x`, in design units.
///
/// A DISPLACEMENT of the baked curve, never a new curve: `.x` shifts which part
/// of the ridgeline is sampled and `.y` moves that height. Evaluated per
/// quadrature node rather than once per pixel, which is what keeps a moving
/// ridge's soft edge exactly as wide as a still one's — displacing the sample
/// point instead would shear the blur wherever the motion varies along x.
fn gAnimOffset(layerIdx: i32, x: f32, tt: f32) -> vec2<f32> {
  let mode = i32(u.anim + 0.5);
  var o = vec2<f32>(0.0);
  if (mode <= 2) {
    let w = gAnimWeight(layerIdx) * max(u.animAmount, 0.0);
    // The front layer is the fastest as well as the furthest, and each layer
    // starts a fixed phase behind the one in front — without that they move as
    // one body and the depth reads as a single sheet sliding.
    let rate = 1.0 - 0.22 * f32(layerIdx);
    let ph = f32(layerIdx) * 0.9;
    if (mode == 0) {
      // Wave — a ripple travelling ALONG the ridgeline. `k` is in radians per
      // design unit, so Ripples is a count across the card's own width.
      let k = GTAU * max(u.waveFreq, 0.0) / (2.0 * GREFX);
      o.y = GAMP_WAVE * w * sin(k * x - tt * 1.1 * rate + ph);
    } else if (mode == 1) {
      // Swell — uniform in x, so the whole range rises and falls. The lateral
      // term is a third of the vertical and much slower: enough that the range
      // leans into the rise instead of riding an elevator.
      o.y = GAMP_SWELL * w * sin(tt * 0.75 * rate + ph);
      o.x = 0.45 * GAMP_SWELL * w * sin(tt * 0.38 * rate + ph + 1.7);
    } else {
      // Drift — the landscape slides past. Mostly lateral, with a slow bob so
      // the horizon is not on rails.
      o.x = GAMP_DRIFT * w * sin(tt * 0.55 * rate + ph);
      o.y = 0.30 * GAMP_DRIFT * w * sin(tt * 0.37 * rate + ph + 2.1);
    }
  }
  return o;
}

/// The light, wandering around wherever it was dropped.
///
/// BOTH sine terms — not sin/cos — because a cosine is 1 at t=0 and would
/// teleport the light the instant the animation was switched on. As written the
/// drift starts from the posed direction, which is also what keeps the drag
/// handle honest. One source for the whole card: the per-layer parallax and the
/// drop-glow read this, so they can never disagree about where the light is.
fn gLightDir() -> vec2<f32> {
  let tt = gAnimT();
  let s = 0.5 * clamp(u.lightSway, 0.0, 1.0);
  return (u.light - vec2<f32>(0.5)) * 2.0
       + vec2<f32>(sin(tt * 0.31), sin(tt * 0.23)) * s;
}

/// Intensity, breathing. Rides on `intensity` rather than on the layer colours,
/// so the drop-glow — which is scaled by the same number — breathes with it.
fn gIntensity() -> f32 {
  let tt = gAnimT();
  let pulse = 1.0 + 0.35 * clamp(u.glowPulse, 0.0, 1.0) * sin(tt * 0.8);
  return max(0.0, u.intensity) * max(pulse, 0.0);
}

/// A per-frame reshuffle of the grain's channel seeds — film running through a
/// projector rather than a photograph of one frame. Zero at t=0 (sin(0) = 0),
/// and BOUNDED: the seed is hashed back into 0..97 instead of counting up, so
/// the grain does not degrade into stripes after a minute of large arguments
/// inside `gHash`'s own sin.
fn gGrainPhase(tt: f32) -> f32 {
  let fr = floor(tt * 14.0 * clamp(u.grainDrift, 0.0, 1.0));
  return fract(sin(fr * 12.9898) * 43758.5453) * 97.0;
}

/// One channel of the study's `l2Grain` fractal noise.
fn gHash(lattice: vec2<f32>, channel: f32) -> f32 {
  let v = vec3<f32>(lattice, channel + GSEED);
  return fract(sin(dot(v, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453123);
}

fn gValueNoise(p: vec2<f32>, channel: f32) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let a = gHash(i, channel);
  let b = gHash(i + vec2<f32>(1.0, 0.0), channel);
  let c = gHash(i + vec2<f32>(0.0, 1.0), channel);
  let d = gHash(i + vec2<f32>(1.0, 1.0), channel);
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y) * 2.0 - 1.0;
}

/// THREE octaves — the study's `L2GrainStyle.octaves` default.
fn gFractal(p: vec2<f32>, channel: f32) -> f32 {
  var sum = 0.0;
  var amp = 1.0;
  var freq = 1.0;
  for (var i = 0; i < 3; i = i + 1) {
    sum = sum + gValueNoise(p * freq, channel + f32(i) * 37.0) * amp;
    freq = freq * 2.0;
    amp = amp * 0.5;
  }
  return clamp(0.5 + GGAIN * sum, 0.0, 1.0);
}

/// The grain shader writes linearRGB, which is converted to sRGB before
/// compositing. Skip this and the grain reads far too dark.
fn gLinearToSRGB(c: f32) -> f32 {
  if (c <= 0.0031308) { return c * 12.92; }
  return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

/// Photoshop/CSS `overlay` — `L2GrainStyle.blend`.
fn gOverlay(base: f32, blend: f32) -> f32 {
  if (base < 0.5) { return 2.0 * base * blend; }
  return 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
}

// @gen-l2-paths
// ── Ridge ridge tables — GENERATED by tools/gen-l2-ridges.mjs ──────────
// Design-space paths from the study, in a 300x384 viewBox, y down.
// Do not hand-edit between the markers: rerun the generator.

fn mfRidgeSeg(x: f32, p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>) -> vec2<f32> {
  // Cubic coefficients, x then y. Written out rather than looped so the
  // three languages read identically and nothing needs an array.
  let xa = p3.x - 3.0 * p2.x + 3.0 * p1.x - p0.x;
  let xb = 3.0 * p2.x - 6.0 * p1.x + 3.0 * p0.x;
  let xc = 3.0 * p1.x - 3.0 * p0.x;
  // Linear guess, then Newton. x(t) is strictly increasing on every segment
  // in this table (asserted by the generator), so the root is unique and four
  // steps take the initial ~0.15 error below single-precision resolution.
  var t = clamp((x - p0.x) / max(p3.x - p0.x, 0.0001), 0.0, 1.0);
  for (var i = 0; i < 4; i = i + 1) {
    let f = ((xa * t + xb) * t + xc) * t + p0.x - x;
    let df = (3.0 * xa * t + 2.0 * xb) * t + xc;
    t = clamp(t - f / max(df, 0.0001), 0.0, 1.0);
  }
  let ya = p3.y - 3.0 * p2.y + 3.0 * p1.y - p0.y;
  let yb = 3.0 * p2.y - 6.0 * p1.y + 3.0 * p0.y;
  let yc = 3.0 * p1.y - 3.0 * p0.y;
  let y = ((ya * t + yb) * t + yc) * t + p0.y;
  let dy = (3.0 * ya * t + 2.0 * yb) * t + yc;
  let dx = (3.0 * xa * t + 2.0 * xb) * t + xc;
  return vec2<f32>(y, dy / max(dx, 0.0001));
}

fn mfRdgViolet1(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 96.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 330.0), vec2<f32>(-10.0, 240.0), vec2<f32>(60.0, 150.0), vec2<f32>(96.0, 150.0)); }
  else if (cx < 190.0) { r = mfRidgeSeg(cx, vec2<f32>(96.0, 150.0), vec2<f32>(132.0, 150.0), vec2<f32>(152.0, 262.0), vec2<f32>(190.0, 262.0)); }
  else if (cx < 282.0) { r = mfRidgeSeg(cx, vec2<f32>(190.0, 262.0), vec2<f32>(226.0, 262.0), vec2<f32>(250.0, 196.0), vec2<f32>(282.0, 196.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(282.0, 196.0), vec2<f32>(316.0, 196.0), vec2<f32>(344.0, 270.0), vec2<f32>(370.0, 330.0)); }
  return r;
}

fn mfRdgViolet2(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 98.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 356.0), vec2<f32>(0.0, 286.0), vec2<f32>(62.0, 212.0), vec2<f32>(98.0, 212.0)); }
  else if (cx < 192.0) { r = mfRidgeSeg(cx, vec2<f32>(98.0, 212.0), vec2<f32>(134.0, 212.0), vec2<f32>(154.0, 300.0), vec2<f32>(192.0, 300.0)); }
  else if (cx < 284.0) { r = mfRidgeSeg(cx, vec2<f32>(192.0, 300.0), vec2<f32>(228.0, 300.0), vec2<f32>(252.0, 254.0), vec2<f32>(284.0, 254.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(284.0, 254.0), vec2<f32>(318.0, 254.0), vec2<f32>(346.0, 300.0), vec2<f32>(370.0, 356.0)); }
  return r;
}

fn mfRdgViolet3(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 100.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 386.0), vec2<f32>(10.0, 340.0), vec2<f32>(66.0, 296.0), vec2<f32>(100.0, 296.0)); }
  else if (cx < 194.0) { r = mfRidgeSeg(cx, vec2<f32>(100.0, 296.0), vec2<f32>(136.0, 296.0), vec2<f32>(156.0, 344.0), vec2<f32>(194.0, 344.0)); }
  else if (cx < 288.0) { r = mfRidgeSeg(cx, vec2<f32>(194.0, 344.0), vec2<f32>(230.0, 344.0), vec2<f32>(256.0, 312.0), vec2<f32>(288.0, 312.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(288.0, 312.0), vec2<f32>(320.0, 312.0), vec2<f32>(348.0, 346.0), vec2<f32>(370.0, 386.0)); }
  return r;
}

fn mfRdgIndigo1(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 176.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 392.0), vec2<f32>(40.0, 368.0), vec2<f32>(110.0, 300.0), vec2<f32>(176.0, 214.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(176.0, 214.0), vec2<f32>(216.0, 162.0), vec2<f32>(250.0, 120.0), vec2<f32>(370.0, 96.0)); }
  return r;
}

fn mfRdgIndigo2(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 184.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 404.0), vec2<f32>(50.0, 386.0), vec2<f32>(118.0, 330.0), vec2<f32>(184.0, 254.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(184.0, 254.0), vec2<f32>(222.0, 210.0), vec2<f32>(256.0, 176.0), vec2<f32>(370.0, 152.0)); }
  return r;
}

fn mfRdgIndigo3(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 192.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 424.0), vec2<f32>(60.0, 412.0), vec2<f32>(126.0, 372.0), vec2<f32>(192.0, 314.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(192.0, 314.0), vec2<f32>(230.0, 280.0), vec2<f32>(262.0, 254.0), vec2<f32>(370.0, 238.0)); }
  return r;
}

fn mfRdgGraphite1(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 96.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 330.0), vec2<f32>(-4.0, 290.0), vec2<f32>(44.0, 206.0), vec2<f32>(96.0, 206.0)); }
  else if (cx < 210.0) { r = mfRidgeSeg(cx, vec2<f32>(96.0, 206.0), vec2<f32>(142.0, 206.0), vec2<f32>(168.0, 150.0), vec2<f32>(210.0, 150.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(210.0, 150.0), vec2<f32>(262.0, 150.0), vec2<f32>(336.0, 278.0), vec2<f32>(370.0, 330.0)); }
  return r;
}

fn mfRdgGraphite2(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 100.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 356.0), vec2<f32>(4.0, 324.0), vec2<f32>(52.0, 254.0), vec2<f32>(100.0, 254.0)); }
  else if (cx < 214.0) { r = mfRidgeSeg(cx, vec2<f32>(100.0, 254.0), vec2<f32>(146.0, 254.0), vec2<f32>(172.0, 208.0), vec2<f32>(214.0, 208.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(214.0, 208.0), vec2<f32>(264.0, 208.0), vec2<f32>(338.0, 306.0), vec2<f32>(370.0, 356.0)); }
  return r;
}

fn mfRdgGraphite3(x: f32) -> vec2<f32> {
  let cx = clamp(x, -70.0, 370.0);
  var r = vec2<f32>(0.0);
  if (cx < 104.0) { r = mfRidgeSeg(cx, vec2<f32>(-70.0, 386.0), vec2<f32>(14.0, 358.0), vec2<f32>(60.0, 310.0), vec2<f32>(104.0, 310.0)); }
  else if (cx < 218.0) { r = mfRidgeSeg(cx, vec2<f32>(104.0, 310.0), vec2<f32>(150.0, 310.0), vec2<f32>(178.0, 278.0), vec2<f32>(218.0, 278.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(218.0, 278.0), vec2<f32>(266.0, 278.0), vec2<f32>(344.0, 344.0), vec2<f32>(370.0, 386.0)); }
  return r;
}

fn mfRidge(styleIdx: i32, layerIdx: i32, x: f32) -> vec2<f32> {
  var r = vec2<f32>(0.0);
  if (styleIdx == 0) {
    if (layerIdx == 0) { r = mfRdgViolet1(x); }
    else if (layerIdx == 1) { r = mfRdgViolet2(x); }
    else { r = mfRdgViolet3(x); }
  }
  else if (styleIdx == 1) {
    if (layerIdx == 0) { r = mfRdgIndigo1(x); }
    else if (layerIdx == 1) { r = mfRdgIndigo2(x); }
    else { r = mfRdgIndigo3(x); }
  }
  else {
    if (layerIdx == 0) { r = mfRdgGraphite1(x); }
    else if (layerIdx == 1) { r = mfRdgGraphite2(x); }
    else { r = mfRdgGraphite3(x); }
  }
  return r;
}
// @end-l2-paths

/// Coverage of one blurred silhouette at a point.
///
/// Blurring a filled region `y > h(x)` with an isotropic Gaussian is EXACTLY
/// `integral G(u) * Phi((y - h(x+u)) / sigma) du` — a convolution along x of the
/// unblurred vertical step. Five weighted samples of that integral is what this
/// is. (For a straight edge it collapses to the familiar
/// `d / sqrt(1 + slope^2)` perpendicular distance; the earlier port used that
/// closed form alone and was 11.9 mean 8-bit levels off the SwiftUI reference,
/// up to 52 locally, because a real blur also rounds the APEX of a ridge and
/// fills its valley. Five nodes bring it to 1.35 mean / 6.2 max, in line with
/// the other cards. Seven nodes buy 0.2 of a level and cost 40% more.)
///
/// `p` is the sample in DESIGN units (the study board, y down, origin at the
/// board's top-left). The Gaussian is isotropic in POINT space, so its width is
/// converted to design-x units to place the nodes.
/// `tt` rides all the way down here rather than being read from the uniform,
/// because this is inside the integral: every node of it must see the SAME
/// instant, and the animation offset must be evaluated at the node's own x.
fn gRidgeAt(styleIdx: i32, layerIdx: i32, x: f32, py: f32, sigma: f32, sy: f32,
            tt: f32) -> f32 {
  let o = gAnimOffset(layerIdx, x, tt);
  let r = mfRidge(styleIdx, layerIdx, x + o.x);
  return gCoverage((r.x + o.y - py) * sy, sigma);
}

fn gRidgeCoverage(p: vec2<f32>, styleIdx: i32, layerIdx: i32, sigma: f32,
                  sx: f32, sy: f32, tt: f32) -> f32 {
  let sdx = sigma / max(sx, 0.0001);
  let n1 = GQN1 * sdx;
  let n2 = GQN2 * sdx;
  return GQW0 * gRidgeAt(styleIdx, layerIdx, p.x, p.y, sigma, sy, tt)
       + GQW1 * (gRidgeAt(styleIdx, layerIdx, p.x + n1, p.y, sigma, sy, tt)
               + gRidgeAt(styleIdx, layerIdx, p.x - n1, p.y, sigma, sy, tt))
       + GQW2 * (gRidgeAt(styleIdx, layerIdx, p.x + n2, p.y, sigma, sy, tt)
               + gRidgeAt(styleIdx, layerIdx, p.x - n2, p.y, sigma, sy, tt));
}

// ── entry ────────────────────────────────────────────────────────────────────

/// The card's CONTENTS — the white sheet and the three silhouettes, unclipped
/// and unbounded, with no canvas, no grain and no dither.
///
/// Defined outside 0..1 on purpose, and CLAMP-EXTENDED at the edge. The filter
/// bank taps this through `mfTap`, which clamps its uv to 0..1 before calling in
/// — so a blur near the rim re-reads the edge of the card rather than reaching
/// past it. What must NOT appear here is the canvas; the caller applies the
/// card's SDF mask AFTER filtering, so the silhouette stays razor sharp however
/// hard the contents are warped.
fn mfSrc(cuv: vec2<f32>) -> vec3<f32> {
  let res = u.size;

  let frame = gCardFrame(res);
  let halfExt = 0.5 * clamp(u.card, vec2<f32>(0.02), vec2<f32>(1.0)) * frame;

  // Design → point scale, PER AXIS: `L2Path` stretched a path to its frame, so
  // a card that is not 300:384 stretches the landscape exactly as the study
  // would have. `gs` (uniform, the min) is the study's own `width / 300` and is
  // what every blur, the radius and the grain ride on.
  let sx = max(halfExt.x / GREFX, 0.0001);
  let sy = max(halfExt.y / GREFY, 0.0001);
  let gs = max(min(sx, sy), 0.0001);

  let ldir = gLightDir();
  let inten = gIntensity();
  let sIdx = i32(u.style + 0.5);
  let tt = gAnimT();

  // `cuv` is CARD space: 0..1 across the card. Design space is the same box
  // measured in the study's 300x384 units, so the paths read as written.
  let dp = cuv * vec2<f32>(2.0 * GREFX, 2.0 * GREFY);

  // Named cardCol, not card: `u.card` is the SIZE uniform, and a later edit that
  // dropped the `u.` would otherwise compile into the wrong variable in silence.
  var cardCol = u.bgColor.rgb;

  // Brightest first, darkest last — `PeakGlowStyle.layers` order. Each is
  // opaque inside its silhouette; the blur is the whole of the falloff.
  let o1 = gParallax(ldir, GPAR1);
  cardCol = gOver(cardCol, u.layer1Color.rgb,
                  gRidgeCoverage(dp - o1, sIdx, 0, u.layer1Blur * gs, sx, sy, tt) * inten);

  let o2 = gParallax(ldir, GPAR2);
  cardCol = gOver(cardCol, u.layer2Color.rgb,
                  gRidgeCoverage(dp - o2, sIdx, 1, u.layer2Blur * gs, sx, sy, tt) * inten);

  let o3 = gParallax(ldir, GPAR3);
  cardCol = gOver(cardCol, u.layer3Color.rgb,
                  gRidgeCoverage(dp - o3, sIdx, 2, u.layer3Blur * gs, sx, sy, tt) * inten);

  return cardCol;
}

// Shared filter bank — WGSL. See effects/_shared/filters.ts for the contract.
//
// Eleven filters — Mesh's fourteen minus Blocks, Fluted and Ribbed, which were
// cut from the CARD bank (see filters.ts). Ported so a PROCEDURAL effect can
// use them. Mesh runs these as a post-pass over an offscreen texture; a
// kind:"stitchable" effect has no texture, so `tap()` here does not sample —
// it CALLS THE EFFECT BACK. Every adopting shader defines
//
//     fn mfSrc(uv: vec2<f32>) -> vec3<f32>
//
// and the bank evaluates it wherever Mesh would have sampled. A blur becomes 17
// evaluations of the source function instead of 17 texture reads.
//
// The maths is otherwise a literal port of `fs_post` in effects/mesh/mesh.wgsl.
// Change one, change all three (filters.wgsl / .metal / .sksl).

/// Mesh clamps every sample to the frame; matching that keeps warped filters
/// identical at the borders.
fn mfTap(uv: vec2<f32>) -> vec3<f32> {
  return mfSrc(clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)));
}

/// 17-tap two-ring disc blur — 1 centre + 8 at 0.55r + 8 at r. Weights sum to
/// exactly 1.0. This is the expensive one: 17 source evaluations per pixel.
fn mfBlurAt(uv: vec2<f32>, res: vec2<f32>, radiusPx: f32) -> vec3<f32> {
  if (radiusPx < 0.35) { return mfTap(uv); }
  let step = radiusPx / max(res, vec2<f32>(1.0));
  var sum = mfTap(uv) * 0.18;
  for (var i = 0; i < 8; i = i + 1) {
    let ang = (f32(i) / 8.0) * 6.2831853;
    let d = vec2<f32>(cos(ang), sin(ang));
    sum = sum + mfTap(uv + d * step * 0.55) * 0.075;
    sum = sum + mfTap(uv + d * step) * 0.0275;
  }
  return sum;
}

/// Directional (motion) blur — 17 taps along ONE axis, UNIFORMLY weighted.
/// Uniform, not the disc's falloff, on purpose: a motion streak is an even
/// exposure over the travel, and a bell curve there reads as a soft smudge
/// rather than movement. Same 17-evaluation budget as `mfBlurAt`.
fn mfMotionAt(uv: vec2<f32>, res: vec2<f32>, radiusPx: f32, angleDeg: f32) -> vec3<f32> {
  if (radiusPx < 0.35) { return mfTap(uv); }
  let th = angleDeg * 0.017453292;
  let d = vec2<f32>(cos(th), sin(th)) * radiusPx / max(res, vec2<f32>(1.0));
  var sum = vec3<f32>(0.0);
  for (var i = -8; i <= 8; i = i + 1) {
    sum = sum + mfTap(uv + d * (f32(i) / 8.0));
  }
  return sum / 17.0;
}

fn mfLuma(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

/// Film grain, the wrapped-product kind from effects/grain. Unit space, so the
/// density is the same on the canvas and on the phone.
fn mfFilmGrain(uv: vec2<f32>) -> f32 {
  let x = (uv.x + 4.0) * (uv.y + 4.0) * 10.0;
  return (((x % 13.0) + 1.0) * ((x % 123.0) + 1.0)) % 0.01 - 0.005;
}

fn mfHash21(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn mfVnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mfHash21(i), mfHash21(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(mfHash21(i + vec2<f32>(0.0, 1.0)), mfHash21(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y,
  );
}

/// The frame's aspect, so a round distortion stays round on a tall phone.
fn mfAspect(res: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(res.x / max(res.y, 1.0), 1.0);
}

/// The bank.
///
///   mode   0 None, 1 Grain, 2 Glass, 3 Frosted, 4 Crystal, 5 Blur,
///          6 Fade blur, 7 Vignette, 8 Brightness, 9 Contrast, 10 Saturation,
///          11 Motion blur
///   a, b   the two shared knobs; meaning is per filter (see filters.ts)
///   ppp    points -> pixels, so a blur radius in points lands the same on
///          every renderer
///
/// fRound / fBevel / fInset are unread since the Blocks/Fluted/Ribbed cut. They
/// stay in the signature so the positional uniform pack in every adopting effect
/// is untouched — see filters.ts.
fn mfFilter(uv: vec2<f32>, res: vec2<f32>, mode: f32, ppp: f32,
            fAmount: f32,
            fScale: f32,
            fBlur: f32,
            fFade: f32,
            fSoft: f32,
            fAngle: f32,
            fGrain: f32,
            fBrightness: f32,
            fContrast: f32,
            fSaturation: f32,
            fRound: f32,
            fBevel: f32,
            fInset: f32) -> vec3<f32> {
  let m = i32(mode + 0.5);
  var col = mfTap(uv);

  if (m == 5) {                                        // Blur
    let a = fBlur;
    col = mfBlurAt(uv, res, a * ppp);
  } else if (m == 6) {                                 // Fade blur
    let a = fBlur;
    let b = fFade;
    let k = smoothstep(clamp(1.0 - b, 0.0, 0.999), 1.0, uv.y);
    col = mix(col, mfBlurAt(uv, res, a * ppp), k);
  } else if (m == 11) {                                 // Motion blur
    col = mfMotionAt(uv, res, fBlur * ppp, fAngle);
  } else if (m == 7) {                                  // Vignette
    let a = fAmount;
    let b = fSoft;
    let halfDiag = length(res) * 0.5;
    let r = length((uv - vec2<f32>(0.5)) * res) / max(halfDiag, 1.0);
    let inner = mix(0.95, 0.15, clamp(b, 0.0, 1.0));
    let k = clamp((r - inner) / max(1.05 - inner, 0.001), 0.0, 1.0);
    col = col * (1.0 - clamp(a, 0.0, 1.0) * k);
  } else if (m == 8) {                                  // Brightness
    let a = fBrightness;
    col = clamp(col + vec3<f32>(a), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 9) {                                  // Contrast
    let a = fContrast;
    col = clamp((col - vec3<f32>(0.5)) * a + vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 10) {                                 // Saturation
    let a = fSaturation;
    col = clamp(mix(vec3<f32>(mfLuma(col)), col, a), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 1) {                                 // Grain
    let a = fGrain;
    col = clamp(col + vec3<f32>(mfFilmGrain(uv) * a), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 2) {                                 // Glass
    let a = fAmount;
    let b = fScale;
    let s = max(b, 0.5);
    let w = vec2<f32>(
      sin(uv.y * s * 6.2831853 + 1.3) + 0.5 * sin(uv.y * s * 12.9 + 0.7),
      cos(uv.x * s * 6.2831853 + 2.1) + 0.5 * cos(uv.x * s * 11.3 + 1.9),
    );
    col = mfTap(uv + w * a * 0.02);
  } else if (m == 4) {                                 // Crystal
    let a = fAmount;
    let b = fScale;
    let asp = mfAspect(res);
    let cell = floor(uv * asp * max(b, 1.0));
    let h1 = mfHash21(cell);
    let h2 = mfHash21(cell + vec2<f32>(37.0, 17.0));
    let off = (vec2<f32>(h1, h2) - vec2<f32>(0.5)) * a * 0.06 / asp;
    col = clamp(mfTap(uv + off) * (1.0 + (h1 - 0.5) * a * 0.35), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (m == 3) {                                // Frosted
    let a = fAmount;
    let b = fBlur;
    let asp = mfAspect(res);
    let p = uv * asp * 42.0;
    let n = vec2<f32>(mfVnoise(p), mfVnoise(p + vec2<f32>(7.3, 2.1))) - vec2<f32>(0.5);
    col = mfBlurAt(uv + n * a * 0.05 / asp, res, b * ppp);
  }
  return col;
}


fn ridge(uv01: vec2<f32>) -> vec4<f32> {
  let res = u.size;
  let p = uv01 * res;
  let frame = gCardFrame(res);
  let halfExt = 0.5 * clamp(u.card, vec2<f32>(0.02), vec2<f32>(1.0)) * frame;
  let q = p - 0.5 * res;
  let gs = max(min(halfExt.x / GREFX, halfExt.y / GREFY), 0.0001);
  let r = clamp(u.radius * gs, 0.0, min(halfExt.x, halfExt.y));

  // ── the canvas — DELIBERATELY OUTSIDE mfSrc ──
  // The filter must only touch the CARD. Warping or blurring the composite
  // would drag the distortion across the whole screen and chew the card's
  // rounded silhouette into a rectangle.
  var col = GCANVAS;

  // The card's drop-glow, from the shared shadow bank. Painted BEFORE the card:
  // the card is opaque over its own footprint, so only the spill past the
  // silhouette ever shows.
  // The SAME light and the SAME intensity mfSrc uses — both through the
  // animated accessors, so the glow under the card drifts and breathes with the
  // landscape on it instead of sitting still beneath a moving picture.
  let ldirC = gLightDir();
  col = mfsCardShadow(col, q, halfExt, r, gs, ldirC, u.shadowAmt,
                      gIntensity(), u.shadowColor.rgb);

  // CARD SPACE, not frame space. `cuv` runs 0..1 across the card and `cres` is
  // the card in pixels, so every filter is expressed relative to the thing it is
  // filtering. `393` is the reference iPhone width in points, so a radius given
  // in points lands the same in the preview (device px), on iOS (points) and on
  // Skia (dp).
  let cres = 2.0 * halfExt;
  let cuv = (q + halfExt) / max(cres, vec2<f32>(1.0));
  var cardCol = mfFilter(cuv, cres, u.filterId, frame.x / 393.0,
                         u.fAmount, u.fScale, u.fBlur, u.fFade, u.fSoft, u.fAngle, u.fGrain, u.fBrightness, u.fContrast, u.fSaturation, u.fRound, u.fBevel, u.fInset);

  // Grain. The study's `l2Grain` writes four independent channels — R, G, B AND
  // A — in linearRGB, which is converted to sRGB before compositing. Alpha as
  // noise is most of the look, so it is reproduced rather than simplified.
  // AFTER the filter on purpose: it is the film over the finished card, and
  // putting it inside mfSrc would cost 17 evaluations under a blur.
  if (u.grainAmt > 0.0) {
    // Card-relative, i.e. design units. Going through `gs` is what makes the
    // three renderers agree: this shader receives `p` in DEVICE pixels in the
    // WebGPU preview but in POINTS on iOS and dp on Skia, and anything keyed off
    // raw `p` comes out ~2x finer in the preview than in either export.
    let np = q / gs * max(u.grainFreq, 0.0001);
    // One phase for all four channels: they stay independent of each other (the
    // seeds are 0/101/211/307 apart) but re-roll together, which is one frame of
    // film advancing rather than four.
    let gp = gGrainPhase(gAnimT());
    let nr = gLinearToSRGB(gFractal(np, 0.0 + gp));
    let ng = gLinearToSRGB(gFractal(np, 101.0 + gp));
    let nb = gLinearToSRGB(gFractal(np, 211.0 + gp));
    let na = gFractal(np, 307.0 + gp);
    let mixed = vec3<f32>(gOverlay(cardCol.r, nr), gOverlay(cardCol.g, ng), gOverlay(cardCol.b, nb));
    cardCol = mix(cardCol, mixed, clamp(u.grainAmt * na, 0.0, 1.0));
  }

  // Now clip. The mask is the card's OWN distance field, evaluated on the
  // unwarped position, so the silhouette survives any amount of distortion
  // inside it. One-pixel feather so the corner reads clean.
  let dCard = gSdRoundBox(q, halfExt, r);
  col = gOver(col, cardCol, 1.0 - smoothstep(-1.0, 1.0, dCard));

  // Dither. A white sheet fading through one hue into black is exactly the ramp
  // 8-bit banding shows up on.
  let dth = (fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  return vec4<f32>(clamp(col + vec3<f32>(dth), vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
