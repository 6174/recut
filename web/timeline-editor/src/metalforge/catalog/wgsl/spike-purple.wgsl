// Spike — a dark squircle with a glow rising out of its bottom edge and a fine
// dot screen over the top. This is the preview half.
//
// Ported from the study's Level 2 sheet (Wmetal01/Level2/DottedGlowCard.swift +
// DotGrid.swift, design tiles 10 / 13 / 15).
//
// FIVE things the port decides, in the order you will notice them:
//
// 1. The mounds are SVG paths, baked. `tools/gen-l2-ridges.mjs` turns each
//    `<path d="…">` into a `y(x)` evaluator — pick the cubic segment holding the
//    sample, Newton-invert x(t), read y(t) and dy/dx — and writes the table into
//    all three shader files at once. The blur is not a blur: a Gaussian-blurred
//    step edge is the normal CDF of the signed distance, and dy/dx is what turns
//    the vertical gap to the curve into the perpendicular one the Gaussian
//    actually spreads over.
//
// 2. The light pools need no rectangle. The study fills a box with an
//    `EllipticalGradient(endRadiusFraction: 0.5)` and blurs it, but every one of
//    the three ends its last stop at 0.90 of that radius — inside the box on
//    every axis, corners included — so the box edge contributes nothing and the
//    blur has no step to soften. Only the second, LINEAR pool (the purple tile's
//    base wash) has live edges, and only horizontally; that one keeps a blurred
//    coverage.
//
// 3. The dot screen sits AFTER the filter, beside the grain rather than inside
//    `mfSrc`. It is the card's film, not its gradient — and a 17-tap blur
//    through two Newton inversions plus a dot grid is several times the work for
//    a result the study does not draw either (its `DotGridView` is a sibling
//    layer, not part of the gradient).
//
// 4. The dot grid's per-dot randomness is a float hash, not the study's 64-bit
//    integer one. SkSL has no bitwise operators, so an exact transcription is
//    impossible; what matters is that all THREE languages hash identically,
//    which they do. The study also quantises dot opacity into 14 buckets to
//    batch its `Canvas` fills — a CPU-drawing optimisation with no analogue
//    here, and dropping it is strictly smoother.
//
// 5. Neither the word on the top line nor the bead beside it is drawn. The word
//    never could be — glyphs are the one thing a fragment shader cannot paint.
//    The bead was closed form and WAS drawn, and has been cut: on a gradient
//    card it read as an emoji stuck to the corner.
//
// EVERY distance is in the study's own design units (a 300x300 board) and scaled
// at use. `L2Path` stretched a path to whatever frame it was given
// (`preserveAspectRatio="none"`), so the design box maps onto the card per-axis
// — that is `sx`/`sy` below. Blur, corner radius and dots use the
// single uniform `gs`, exactly as the study multiplied them all by `width/300`.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic uniform
// packer can walk one ordering. Seventeen scalars land `card` on a multiple of 8
// packs too; `light` then ends on a multiple of 16.
//
//
// MEASURED against the SwiftUI reference (Wmetal01 Level2Probe at 300pt, the
// card cropped and both resampled to 360x360): 2.4-3.6 mean 8-bit levels across
// the three styles once the word and the bead are excluded — neither of which
// this shader draws at all any more. For
// scale, the eight Level 1 cards sit at 0.8-4.8. Two known contributors, both
// small and both deliberate:
//
//   - The light pools are not blurred. The study blurs each by 14-16 design
//     units; modelled exactly in Python that costs 2.0-4.3 mean levels, and
//     buying it back means multi-sampling a 2-D gradient, which is more work
//     than the whole rest of the card.
//   - The dot screen is sampled, not drawn. A one-unit dot lands on a different
//     sub-pixel phase in each renderer, so a per-pixel diff spikes on the dots
//     while the screen reads identically.
// spike.metal and spike.sksl are the other two implementations of this same
// maths. Change one, change all three.
struct Uniforms {
  size:        vec2<f32>,
  time:        f32,
  // The 0-based index of the Style option: 0 purple, 1 aqua, 2 lime.
  style:       f32,
  // The 0-based index of the Animation option: 0 wave, 1 swell, 2 drift,
  // 3 off. `off` is the study's still. Unrelated to `dotMotion` below — that
  // one animates the dot screen, this one animates the light under it.
  anim:        f32,
  radius:      f32,
  mound1Blur:  f32,
  mound2Blur:  f32,
  glowAmt:     f32,
  baseGlow:    f32,
  dotSpacing:  f32,
  dotSize:     f32,
  dotAmt:      f32,
  // 0 still, 1 twinkle, 2 wave, 3 breathe — `DotAnimation.Kind`, same order.
  dotMotion:   f32,
  dotSpeed:    f32,
  dotDepth:    f32,
  // The background pattern: 0 none, 1 dots, 2 rings, 3 grid, 4 plus, 5 mosaic.
  // The index IS the branch in gPattern — never renumber.
  dotStyle:    f32,
  // 0 overlay (over the finished gradient, outside the filter), 1 background
  // (inside mfSrc, on the fill and under both mounds).
  dotLayer:    f32,
  // Rotation of the LATTICE in degrees. The marks stay axis-aligned.
  dotAngle:    f32,
  // Static per-dot dimming, off the same hash Twinkle uses on another salt.
  dotVary:     f32,
  borderAmt:   f32,
  intensity:   f32,
  // The shadow bank's strength knob. Its TINT is a colour and so sits with the
  // other vec4s below — the bank's two keys are the one pair in the catalog
  // that does not travel together in `mslArgOrder`.
  shadowAmt:   f32,
  // The animation knobs. SEVEN of them — Ridge's eight minus `grainDrift`,
  // which has nothing to drift here: this card's film is the dot screen and it
  // has had its own clock since the port. Seven is also what makes this struct
  // padding-free: twenty-five scalars land `card` on 112 and the colours on 128.
  animSpeed:   f32,
  animAmount:  f32,
  animSpread:  f32,
  waveFreq:    f32,
  lightSway:   f32,
  glowPulse:   f32,
  card:        vec2<f32>,
  light:       vec2<f32>,
  bgColor:     vec4<f32>,
  mound1Color: vec4<f32>,
  mound2Color: vec4<f32>,
  poolTint:    vec4<f32>,
  dotColor:    vec4<f32>,
  borderColor: vec4<f32>,
  shadowColor: vec4<f32>,
  // The shared filter bank's fourteen. LAST, mirroring `mslArgOrder`.
  // `filterId`, not `filter`: the latter is a RESERVED KEYWORD in WGSL. The
  // packer matches by position rather than by name, so nothing else cares.
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

// Half the study's board, 300x300 — the space every path below is written in.
const GREFX: f32 = 150.0;
const GREFY: f32 = 150.0;

// smoothstep half-width, in sigmas, that best matches a Gaussian CDF.
const GK: f32 = 2.104;

// The DC canvas the study was rendered on (body background #07070B).
const GCANVAS: vec3<f32> = vec3<f32>(0.02745098, 0.02745098, 0.04313725);

// Parallax, in design units of travel per unit of light displacement. The front
// mound moves further than the back one; that difference is the depth cue.
const GPAR1: f32 = 8.0;
const GPAR2: f32 = 14.0;

// The purple tile's second, LINEAR pool: `left:0 width:1 bottom:-0.06
// height:0.16`, stops (white 0) 0%, (white 1) 72%, (white 1) 100%, blur 12.
// Geometry is baked because it is the same on every tile that uses it; whether
// it is used at all is the `baseGlow` knob.
const GBASE_BOTTOM: f32 = -0.06;
const GBASE_HEIGHT: f32 = 0.16;
const GBASE_MID: f32 = 0.72;
const GBASE_BLUR: f32 = 12.0;

// `DotAnimation` defaults: wave runs at 45 degrees with two bands across.
const GWAVE_ANGLE: f32 = 0.7853982;
const GWAVE_COUNT: f32 = 2.0;

// Five-node Gaussian quadrature along x — see gRidgeCoverage. Nodes in sigmas,
// weights exp(-n^2/2) normalised to sum to exactly 1.
// ── animation ────────────────────────────────────────────────────────────────
// How far the BACK mound moves at Depth = 1, as a fraction of the front one's
// travel. Same ordering as the parallax constants above and for the same
// reason: the difference between the layers is the depth cue. Note the mounds
// are indexed back-to-front here (0 back, 1 front), the opposite of Ridge's
// layers, so the depth index is derived rather than being the layer index.
const GAW_BACK: f32 = 0.62;

// Peak travel at Motion = 1, in design units. Wave is the smallest because it
// is a shape change rather than a move. Scaled down from Ridge's 14/22/34: this
// board is 300x300 against Ridge's 300x384 and the mounds sit far lower in it,
// so the same absolute travel reads as a bigger gesture.
const GAMP_WAVE: f32 = 11.0;
const GAMP_SWELL: f32 = 17.0;
const GAMP_DRIFT: f32 = 26.0;

const GTAU: f32 = 6.28318530718;

const GQN1: f32 = 0.9;
const GQN2: f32 = 1.8;
const GQW0: f32 = 0.36633;
const GQW1: f32 = 0.24434;
const GQW2: f32 = 0.07249;

// ── helpers ──────────────────────────────────────────────────────────────────

/// The frame the card is measured in: the 393x851 reference iPhone, fitted
/// inside whatever view we are handed.
fn gCardFrame(res: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(393.0, 851.0) * max(min(res.x / 393.0, res.y / 851.0), 0.0001);
}

/// Signed distance to a rounded rectangle — negative inside.
fn gSdRoundBox(p: vec2<f32>, ext: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - ext + vec2<f32>(r);
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

/// A blurred step across a signed distance: 1 inside, 0 outside, `sigma` wide.
fn gCoverage(d: f32, sigma: f32) -> f32 {
  let s = max(sigma, 0.0001);
  return 1.0 - smoothstep(-GK * s, GK * s, d);
}

/// Source-over with a straight (non-premultiplied) source.
fn gOver(dst: vec3<f32>, src: vec3<f32>, a: f32) -> vec3<f32> {
  return mix(dst, src, clamp(a, 0.0, 1.0));
}

/// Premultiplied gradient interpolation, un-premultiplied on the way out.
/// The pools fade a white core into a tinted falloff, changing RGB *and* alpha
/// across one segment, so interpolating straight would drag the hue.
fn gMixStop(c1: vec3<f32>, a1: f32, c2: vec3<f32>, a2: f32, f: f32) -> vec4<f32> {
  let p1 = vec4<f32>(c1 * a1, a1);
  let p2 = vec4<f32>(c2 * a2, a2);
  let pm = mix(p1, p2, clamp(f, 0.0, 1.0));
  var rgb = c2;
  if (pm.a > 1e-6) { rgb = pm.rgb / pm.a; }
  return vec4<f32>(rgb, pm.a);
}

/// Parallax for a layer with no offset shadow to carry the light. EXACTLY ZERO
/// at the default light (0.5, 1.0).
fn gParallax(ldir: vec2<f32>, k: f32) -> vec2<f32> {
  return (ldir - vec2<f32>(0.0, 1.0)) * k;
}

/// The animation clock. ONE gate for the whole feature: `Animation = Off`
/// returns zero here, and every moving term below is written to vanish at t=0,
/// so the card falls back to the reference render exactly rather than nearly.
/// Speed 0 freezes the pose instead — the ripple stays, the clock stops.
///
/// The DOT screen does not read this: it has its own `dotSpeed` off raw
/// `u.time`, so the two clocks are independent by design.
fn gAnimT() -> f32 {
  if (i32(u.anim + 0.5) > 2) { return 0.0; }
  return u.time * max(u.animSpeed, 0.0);
}

/// Depth rank of a mound: 0 is the front one. The mounds are stored back to
/// front (0 back, 1 front), so this is the layer index reversed — and it is
/// what every per-layer term below keys off, which keeps the maths identical to
/// Ridge's despite the opposite storage order.
fn gAnimDepth(layerIdx: i32) -> i32 {
  return 1 - layerIdx;
}

/// How far a mound travels, relative to the front one. Depth = 0 moves both as
/// one slab; 1 is the study's own depth ordering.
fn gAnimWeight(layerIdx: i32) -> f32 {
  var w = 1.0;
  if (gAnimDepth(layerIdx) == 1) { w = GAW_BACK; }
  return mix(1.0, w, clamp(u.animSpread, 0.0, 2.0));
}

/// Where a mound has moved to at design-x `x`, in design units.
///
/// A DISPLACEMENT of the baked curve, never a new curve: `.x` shifts which part
/// of the mound line is sampled and `.y` moves that height. Evaluated per
/// quadrature node rather than once per pixel, which is what keeps a moving
/// mound's soft edge exactly as wide as a still one's — displacing the sample
/// point instead would shear the blur wherever the motion varies along x.
fn gAnimOffset(layerIdx: i32, x: f32, tt: f32) -> vec2<f32> {
  let mode = i32(u.anim + 0.5);
  var o = vec2<f32>(0.0);
  if (mode <= 2) {
    let d = f32(gAnimDepth(layerIdx));
    let w = gAnimWeight(layerIdx) * max(u.animAmount, 0.0);
    // The front mound is the fastest as well as the furthest, and the back one
    // runs a fixed phase behind — without that they move as one body and the
    // depth reads as a single sheet sliding.
    let rate = 1.0 - 0.22 * d;
    let ph = d * 0.9;
    if (mode == 0) {
      // Wave — a ripple travelling ALONG the mound line. `k` is in radians per
      // design unit, so Ripples is a count across the card's own width.
      let k = GTAU * max(u.waveFreq, 0.0) / (2.0 * GREFX);
      o.y = GAMP_WAVE * w * sin(k * x - tt * 1.1 * rate + ph);
    } else if (mode == 1) {
      // Swell — uniform in x, so the whole spike rises and falls. The lateral
      // term is a third of the vertical and much slower: enough that the mound
      // leans into the rise instead of riding an elevator.
      o.y = GAMP_SWELL * w * sin(tt * 0.75 * rate + ph);
      o.x = 0.45 * GAMP_SWELL * w * sin(tt * 0.38 * rate + ph + 1.7);
    } else {
      // Drift — the mounds slide past. Mostly lateral, with a slow bob so the
      // horizon is not on rails.
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
/// handle honest. One source for the whole card: the per-mound parallax and the
/// drop-glow read this, so they can never disagree about where the light is.
fn gLightDir() -> vec2<f32> {
  let tt = gAnimT();
  let s = 0.5 * clamp(u.lightSway, 0.0, 1.0);
  return (u.light - vec2<f32>(0.5)) * 2.0
       + vec2<f32>(sin(tt * 0.31), sin(tt * 0.23)) * s;
}

/// Intensity, breathing. Rides on `intensity` rather than on the mound colours,
/// so the pool, the base wash and the drop-glow — all scaled by the same
/// number — breathe with it.
fn gIntensity() -> f32 {
  let tt = gAnimT();
  let pulse = 1.0 + 0.35 * clamp(u.glowPulse, 0.0, 1.0) * sin(tt * 0.8);
  return max(0.0, u.intensity) * max(pulse, 0.0);
}

/// A repeatable number per dot. The study hashes the (column, row) pair with
/// 64-bit integer mixing; SkSL has no bitwise operators, so all three languages
/// use this float hash instead. What matters is that they agree.
fn gDotHash(cell: vec2<f32>, salt: f32) -> f32 {
  return fract(sin(dot(cell + vec2<f32>(salt), vec2<f32>(127.1, 311.7))) * 43758.5453123);
}

// @gen-l2-paths
// ── Spike ridge tables — GENERATED by tools/gen-l2-ridges.mjs ──────────
// Design-space paths from the study, in a 300x300 viewBox, y down.
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

fn mfSpkPurple1(x: f32) -> vec2<f32> {
  let cx = clamp(x, -60.0, 360.0);
  var r = vec2<f32>(0.0);
  if (cx < 150.0) { r = mfRidgeSeg(cx, vec2<f32>(-60.0, 304.0), vec2<f32>(26.0, 288.0), vec2<f32>(104.0, 122.0), vec2<f32>(150.0, 122.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(150.0, 122.0), vec2<f32>(196.0, 122.0), vec2<f32>(274.0, 288.0), vec2<f32>(360.0, 304.0)); }
  return r;
}

fn mfSpkPurple2(x: f32) -> vec2<f32> {
  let cx = clamp(x, -60.0, 360.0);
  var r = vec2<f32>(0.0);
  if (cx < 150.0) { r = mfRidgeSeg(cx, vec2<f32>(-60.0, 306.0), vec2<f32>(34.0, 298.0), vec2<f32>(110.0, 168.0), vec2<f32>(150.0, 168.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(150.0, 168.0), vec2<f32>(190.0, 168.0), vec2<f32>(266.0, 298.0), vec2<f32>(360.0, 306.0)); }
  return r;
}

fn mfSpkAqua1(x: f32) -> vec2<f32> {
  let cx = clamp(x, -60.0, 360.0);
  var r = vec2<f32>(0.0);
  if (cx < 92.0) { r = mfRidgeSeg(cx, vec2<f32>(-60.0, 306.0), vec2<f32>(-30.0, 240.0), vec2<f32>(40.0, 86.0), vec2<f32>(92.0, 110.0)); }
  else if (cx < 300.0) { r = mfRidgeSeg(cx, vec2<f32>(92.0, 110.0), vec2<f32>(150.0, 136.0), vec2<f32>(214.0, 272.0), vec2<f32>(300.0, 300.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(300.0, 300.0), vec2<f32>(320.0, 306.6667), vec2<f32>(340.0, 313.3333), vec2<f32>(360.0, 320.0)); }
  return r;
}

fn mfSpkAqua2(x: f32) -> vec2<f32> {
  let cx = clamp(x, -60.0, 360.0);
  var r = vec2<f32>(0.0);
  if (cx < 92.0) { r = mfRidgeSeg(cx, vec2<f32>(-60.0, 308.0), vec2<f32>(-26.0, 262.0), vec2<f32>(44.0, 150.0), vec2<f32>(92.0, 168.0)); }
  else if (cx < 300.0) { r = mfRidgeSeg(cx, vec2<f32>(92.0, 168.0), vec2<f32>(146.0, 188.0), vec2<f32>(208.0, 282.0), vec2<f32>(300.0, 304.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(300.0, 304.0), vec2<f32>(320.0, 309.3333), vec2<f32>(340.0, 314.6667), vec2<f32>(360.0, 320.0)); }
  return r;
}

fn mfSpkLime1(x: f32) -> vec2<f32> {
  let cx = clamp(x, -60.0, 360.0);
  var r = vec2<f32>(0.0);
  if (cx < 88.0) { r = mfRidgeSeg(cx, vec2<f32>(-60.0, 304.0), vec2<f32>(-14.0, 286.0), vec2<f32>(44.0, 150.0), vec2<f32>(88.0, 150.0)); }
  else if (cx < 168.0) { r = mfRidgeSeg(cx, vec2<f32>(88.0, 150.0), vec2<f32>(130.0, 150.0), vec2<f32>(148.0, 262.0), vec2<f32>(168.0, 262.0)); }
  else if (cx < 246.0) { r = mfRidgeSeg(cx, vec2<f32>(168.0, 262.0), vec2<f32>(190.0, 262.0), vec2<f32>(208.0, 168.0), vec2<f32>(246.0, 168.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(246.0, 168.0), vec2<f32>(292.0, 168.0), vec2<f32>(336.0, 286.0), vec2<f32>(360.0, 304.0)); }
  return r;
}

fn mfSpkLime2(x: f32) -> vec2<f32> {
  let cx = clamp(x, -60.0, 360.0);
  var r = vec2<f32>(0.0);
  if (cx < 90.0) { r = mfRidgeSeg(cx, vec2<f32>(-60.0, 308.0), vec2<f32>(-8.0, 296.0), vec2<f32>(48.0, 196.0), vec2<f32>(90.0, 196.0)); }
  else if (cx < 170.0) { r = mfRidgeSeg(cx, vec2<f32>(90.0, 196.0), vec2<f32>(130.0, 196.0), vec2<f32>(150.0, 278.0), vec2<f32>(170.0, 278.0)); }
  else if (cx < 246.0) { r = mfRidgeSeg(cx, vec2<f32>(170.0, 278.0), vec2<f32>(192.0, 278.0), vec2<f32>(210.0, 212.0), vec2<f32>(246.0, 212.0)); }
  else { r = mfRidgeSeg(cx, vec2<f32>(246.0, 212.0), vec2<f32>(290.0, 212.0), vec2<f32>(338.0, 296.0), vec2<f32>(360.0, 308.0)); }
  return r;
}

fn mfRidge(styleIdx: i32, layerIdx: i32, x: f32) -> vec2<f32> {
  var r = vec2<f32>(0.0);
  if (styleIdx == 0) {
    if (layerIdx == 0) { r = mfSpkPurple1(x); }
    else { r = mfSpkPurple2(x); }
  }
  else if (styleIdx == 1) {
    if (layerIdx == 0) { r = mfSpkAqua1(x); }
    else { r = mfSpkAqua2(x); }
  }
  else {
    if (layerIdx == 0) { r = mfSpkLime1(x); }
    else { r = mfSpkLime2(x); }
  }
  return r;
}
// @end-l2-paths

/// Coverage of one blurred mound at a point.
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
fn gMoundAt(styleIdx: i32, layerIdx: i32, x: f32, py: f32, sigma: f32, sy: f32,
            tt: f32) -> f32 {
  let o = gAnimOffset(layerIdx, x, tt);
  let r = mfRidge(styleIdx, layerIdx, x + o.x);
  return gCoverage((r.x + o.y - py) * sy, sigma);
}

fn gMoundCoverage(p: vec2<f32>, styleIdx: i32, layerIdx: i32, sigma: f32,
                  sx: f32, sy: f32, tt: f32) -> f32 {
  let sdx = sigma / max(sx, 0.0001);
  let n1 = GQN1 * sdx;
  let n2 = GQN2 * sdx;
  return GQW0 * gMoundAt(styleIdx, layerIdx, p.x, p.y, sigma, sy, tt)
       + GQW1 * (gMoundAt(styleIdx, layerIdx, p.x + n1, p.y, sigma, sy, tt)
               + gMoundAt(styleIdx, layerIdx, p.x - n1, p.y, sigma, sy, tt))
       + GQW2 * (gMoundAt(styleIdx, layerIdx, p.x + n2, p.y, sigma, sy, tt)
               + gMoundAt(styleIdx, layerIdx, p.x - n2, p.y, sigma, sy, tt));
}

/// The elliptical pool's box, as fractions of the card: (left, width, bottom,
/// height). `L2Pool` measures `bottom` up from the card's bottom edge, so a
/// negative value hangs the pool below it.
fn gPoolBox(styleIdx: i32) -> vec4<f32> {
  var b = vec4<f32>(-0.14, 1.28, -0.18, 0.44);
  if (styleIdx == 1) { b = vec4<f32>(-0.24, 0.70, -0.20, 0.38); }
  else if (styleIdx == 2) { b = vec4<f32>(0.02, 0.96, -0.22, 0.40); }
  return b;
}

/// The pool's two middle stops: (location1, location2, alpha1, alpha2). The
/// first stop is always white at alpha 1 and the last is always the tint at
/// alpha 0, located at 0.90.
fn gPoolStops(styleIdx: i32) -> vec4<f32> {
  var s = vec4<f32>(0.46, 0.72, 0.92, 0.50);
  if (styleIdx == 1) { s = vec4<f32>(0.40, 0.70, 0.90, 0.45); }
  else if (styleIdx == 2) { s = vec4<f32>(0.42, 0.72, 0.82, 0.40); }
  return s;
}

// ── entry ────────────────────────────────────────────────────────────────────

/// One background pattern, evaluated at `gp` (the sample already rotated into
/// grid space). Returns `vec3(coverage, cell.x, cell.y)` — the cell travels back
/// out because the motion and Variance terms hash off it, and every style has
/// its own idea of what a cell is (Hex offsets alternate rows, Waves counts
/// bands of a sine, Rain phase-shifts each column).
///
/// Every branch is closed form and costs one norm or one hash. `aa` is the
/// feather in design units; `rad` is `Size`, read as a radius by the solid
/// styles, a half-width by the line ones and a density threshold by Noise.
/// Signed distance to an equilateral triangle of "radius" `r`, pointing up.
/// iq's formula. The parameter is copied into a `var` because WGSL function
/// parameters are immutable — the other two languages mutate theirs in place.
fn gSdTri(p0: vec2<f32>, r: f32) -> f32 {
  let k = 1.7320508;
  var p = vec2<f32>(abs(p0.x) - r, p0.y + r / k);
  if (p.x + k * p.y > 0.0) {
    p = vec2<f32>(p.x - k * p.y, -k * p.x - p.y) * 0.5;
  }
  p.x = p.x - clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

fn gPattern(gp: vec2<f32>, pitch: f32, rad: f32, aa: f32, style: i32) -> vec3<f32> {
  // The lattice the regular styles share. The study starts its grid half a
  // pitch in from the top-left corner, which is what the +0.5 is.
  let baseCell = floor(gp / pitch);
  let off = gp - (baseCell + vec2<f32>(0.5)) * pitch;

  if (style == 1) {
    // Dots — the Euclidean norm, i.e. the study's `Circle()`.
    return vec3<f32>(1.0 - smoothstep(rad - aa, rad + aa, length(off)), baseCell);
  }
  if (style == 2) {
    // Rings — the mark's OUTLINE rather than its fill, and not always a circle:
    // each cell draws a circle, a square or a triangle off its own hash. Three
    // outlines on one lattice read as a set of marks; a field of identical rings
    // reads as one more texture, which this card already has.
    //
    // The hash is the ONLY thing that picks — no knob, because a slider that
    // chose between three shapes would be a fourth style wearing a float.
    let w = max(rad * 0.38, 0.22);
    let pick = gDotHash(baseCell, 53.9) * 3.0;
    var d: f32;
    if (pick < 1.0) {
      d = abs(length(off) - rad);
    } else if (pick < 2.0) {
      d = abs(max(abs(off.x), abs(off.y)) - rad);
    } else {
      // y is flipped because design space is y-DOWN: the SDF's point-up
      // triangle would otherwise render point-down.
      d = abs(gSdTri(vec2<f32>(off.x, -off.y), rad));
    }
    return vec3<f32>(1.0 - smoothstep(w - aa, w + aa, d), baseCell);
  }
  if (style == 3) {
    // Grid — lines through the cell centres on both axes, so the pitch reads as
    // the cell size rather than as half of it.
    let w = max(rad * 0.38, 0.15);
    return vec3<f32>(1.0 - smoothstep(w - aa, w + aa, min(abs(off.x), abs(off.y))), baseCell);
  }
  if (style == 4) {
    // Plus — the SDF union of a wide-flat box and a tall-thin one.
    let w = max(rad * 0.34, 0.18);
    let d = min(max(abs(off.x) - rad, abs(off.y) - w),
                max(abs(off.y) - rad, abs(off.x) - w));
    return vec3<f32>(1.0 - smoothstep(-aa, aa, d), baseCell);
  }
  // Mosaic — a lattice of square marks, each cell on its own brightness. An
  // evenly lit field of them would read as a flat tint; lit unevenly, the same
  // marks read as data. The level is folded into the COVERAGE rather than left
  // to Variance for two reasons: the look has to hold at Variance 0, and Twinkle
  // (which this style presets on) should modulate a field that is already
  // uneven. Squared, so most cells sit dim and a few are lit.
  let lit = 0.1 + 0.9 * gDotHash(baseCell, 41.7);
  // The Chebyshev norm — a square mark, the only place this card still draws one.
  let cov = 1.0 - smoothstep(rad - aa, rad + aa, max(abs(off.x), abs(off.y)));
  return vec3<f32>(cov * lit * lit, baseCell);
}

/// The background screen, in DESIGN units. Returns the alpha of the pattern
/// under `dp` — the pattern's coverage, dimmed by the motion and by Variance.
fn gDots(dp: vec2<f32>, t: f32, aa: f32) -> f32 {
  let style = i32(u.dotStyle + 0.5);
  if (style <= 0) { return 0.0; }
  let pitch = max(u.dotSpacing, 0.5);
  // The LATTICE rotates, the marks do not: `gp` is the sample in grid space, and
  // everything in gPattern — cell, centre, offset — lives there, so a square
  // stays axis-aligned to the grid rather than the card. `dp` itself is left
  // alone for the Wave sweep below, which keeps the study's own 45 degrees.
  let ang = radians(u.dotAngle);
  let ca = cos(ang);
  let sa = sin(ang);
  let gp = vec2<f32>(dp.x * ca - dp.y * sa, dp.x * sa + dp.y * ca);
  let rad = max(u.dotSize, 0.05);

  let hit = gPattern(gp, pitch, rad, aa, style);
  let cov = hit.x;
  let cell = hit.yz;
  if (cov <= 0.0) { return 0.0; }

  // `DotGridView.brightness` — 1 is fully lit, 0 is off.
  let mode = i32(u.dotMotion + 0.5);
  let amount = clamp(u.dotDepth, 0.0, 1.0);
  var level = 1.0;
  if (mode == 1) {
    // Twinkle: each dot blinks on its own clock. Squaring the positive half
    // makes it read as on/off rather than a slow fade.
    let jitter = 0.5 + gDotHash(cell, 0.0) * 1.3;
    let phase = gDotHash(cell, 61.7) * 6.2831853;
    let wv = sin(t * u.dotSpeed * jitter + phase);
    let pulse = pow(max(0.0, wv), 1.6);
    level = 1.0 - amount * (1.0 - pulse);
  } else if (mode == 2) {
    // Wave: a band of light sweeps across the grid. The study normalises by the
    // longer side of the card; in design units that is the board itself.
    let along = (dp.x * cos(GWAVE_ANGLE) + dp.y * sin(GWAVE_ANGLE)) / (2.0 * max(GREFX, GREFY));
    let wv = sin(along * 6.2831853 * GWAVE_COUNT - t * u.dotSpeed * 2.0);
    level = 1.0 - amount * (1.0 - (0.5 + 0.5 * wv));
  } else if (mode == 3) {
    let wv = sin(t * u.dotSpeed);
    level = 1.0 - amount * (1.0 - (0.5 + 0.5 * wv));
  }
  // Static texture, on its own salt so it does not correlate with Twinkle's
  // phase. Multiplied, not mixed, so a dim dot stays dim as the screen animates.
  level = level * (1.0 - clamp(u.dotVary, 0.0, 1.0) * gDotHash(cell, 19.3));
  return cov * clamp(level, 0.0, 1.0);
}

/// The card's CONTENTS — the dark fill, the two mounds and the light pools, and
/// the background pattern IF `Layer = Background`. No canvas and no dither.
///
/// `Layer` is the one thing that decides where the pattern is drawn. On
/// `Overlay` (the study's) it is the card's film: painted over the FILTERED
/// result in the entry, beside the grain in the other cards, so it stays crisp
/// whatever the filter does. On `Background` it is painted HERE — on the fill,
/// under both mounds and under the pool — so the light washes over it and the
/// filter blurs it along with everything else. Same pattern, two looks.
///
/// Defined outside 0..1 on purpose and CLAMP-EXTENDED at the edge; the filter
/// bank taps this through `mfTap`, which clamps its uv before calling in.
fn mfSrc(cuv: vec2<f32>) -> vec3<f32> {
  let res = u.size;
  let frame = gCardFrame(res);
  let halfExt = 0.5 * clamp(u.card, vec2<f32>(0.02), vec2<f32>(1.0)) * frame;

  let sx = max(halfExt.x / GREFX, 0.0001);
  let sy = max(halfExt.y / GREFY, 0.0001);
  let gs = max(min(sx, sy), 0.0001);

  let ldir = gLightDir();
  let inten = gIntensity();
  let sIdx = i32(u.style + 0.5);
  let tt = gAnimT();

  // `cuv` is CARD space, 0..1. Design space is the same box in the study's
  // 300x300 units, so the paths read as written.
  let dp = cuv * vec2<f32>(2.0 * GREFX, 2.0 * GREFY);

  var cardCol = u.bgColor.rgb;

  // ── the background pattern, when it belongs under the light ──
  // Straight onto the fill, before a single mound. `aa` matches the overlay
  // branch's exactly, so switching Layer moves the pattern without resizing it.
  if (u.dotLayer > 0.5 && u.dotAmt > 0.0) {
    cardCol = gOver(cardCol, u.dotColor.rgb,
                    gDots(dp, u.time, max(0.35, 0.8 / gs)) * u.dotAmt);
  }

  // ── the two mounds. Darkest first, brightest last — `layers` order. ──
  let o1 = gParallax(ldir, GPAR1);
  cardCol = gOver(cardCol, u.mound1Color.rgb,
                  gMoundCoverage(dp - o1, sIdx, 0, u.mound1Blur * gs, sx, sy, tt) * inten);

  let o2 = gParallax(ldir, GPAR2);
  cardCol = gOver(cardCol, u.mound2Color.rgb,
                  gMoundCoverage(dp - o2, sIdx, 1, u.mound2Blur * gs, sx, sy, tt) * inten);

  // ── the white-hot elliptical pool ──
  // `radial-gradient(closest-side)` on the box below: t is the distance from the
  // box centre in units of its half-extent, so t = 1 at the edge midpoints.
  let box = gPoolBox(sIdx);
  let st = gPoolStops(sIdx);
  var bx = vec2<f32>(box.x + box.y * 0.5, 1.0 - box.z - box.w * 0.5);
  let bh = max(vec2<f32>(box.y, box.w) * 0.5, vec2<f32>(0.0001));
  // The pool travels with the FRONT mound, sampled at the pool's own centre and
  // converted from design units to card fractions. Leaving it pinned would slide
  // the mounds out from under a fixed hotspot, which is the one thing that reads
  // as a bug rather than as motion.
  let po = gAnimOffset(1, bx.x * 2.0 * GREFX, tt) / vec2<f32>(2.0 * GREFX, 2.0 * GREFY);
  bx = bx + po;
  let t = length((cuv - bx) / bh);
  let white = vec3<f32>(1.0);
  var g = vec4<f32>(0.0);
  if (t < st.x) {
    g = gMixStop(white, 1.0, white, st.z, t / max(st.x, 0.0001));
  } else if (t < st.y) {
    g = gMixStop(white, st.z, u.poolTint.rgb, st.w, (t - st.x) / max(st.y - st.x, 0.0001));
  } else {
    g = gMixStop(u.poolTint.rgb, st.w, u.poolTint.rgb, 0.0, (t - st.y) / max(0.90 - st.y, 0.0001));
  }
  cardCol = gOver(cardCol, g.rgb, g.a * max(0.0, u.glowAmt) * inten);

  // ── the base wash: the purple tile's second, LINEAR pool ──
  // Its horizontal edges are the only ones in the card that a blur has to
  // soften, so this is the one pool that keeps a coverage term.
  if (u.baseGlow > 0.0) {
    // Rises and falls with the pool, for the same reason.
    let top = 1.0 - GBASE_BOTTOM - GBASE_HEIGHT + po.y;
    let v = clamp((cuv.y - top) / max(GBASE_HEIGHT * GBASE_MID, 0.0001), 0.0, 1.0);
    // Full width, so the coverage is the blurred card-width slab.
    let ex = abs(cuv.x - 0.5) * 2.0 * GREFX - GREFX;
    let cov = gCoverage(ex * gs, GBASE_BLUR * gs);
    cardCol = gOver(cardCol, white, v * cov * max(0.0, u.baseGlow) * inten);
  }

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


fn spike(uv01: vec2<f32>) -> vec4<f32> {
  let res = u.size;
  let p = uv01 * res;
  let frame = gCardFrame(res);
  let halfExt = 0.5 * clamp(u.card, vec2<f32>(0.02), vec2<f32>(1.0)) * frame;
  let q = p - 0.5 * res;
  let gs = max(min(halfExt.x / GREFX, halfExt.y / GREFY), 0.0001);
  let r = clamp(u.radius * gs, 0.0, min(halfExt.x, halfExt.y));

  var col = GCANVAS;

  // The SAME light and the SAME intensity mfSrc uses — both through the
  // animated accessors, so the glow under the card drifts and breathes with the
  // spike on it instead of sitting still beneath a moving picture.
  let ldirC = gLightDir();
  col = mfsCardShadow(col, q, halfExt, r, gs, ldirC, u.shadowAmt,
                      gIntensity(), u.shadowColor.rgb);

  let cres = 2.0 * halfExt;
  let cuv = (q + halfExt) / max(cres, vec2<f32>(1.0));
  var cardCol = mfFilter(cuv, cres, u.filterId, frame.x / 393.0,
                         u.fAmount, u.fScale, u.fBlur, u.fFade, u.fSoft, u.fAngle, u.fGrain, u.fBrightness, u.fContrast, u.fSaturation, u.fRound, u.fBevel, u.fInset);

  // ── the film: the background pattern, when it belongs OVER the light ──
  // Design units, so the screen scales with the card exactly as the study's
  // `spacing * scale` does — and so the preview (device pixels), iOS (points)
  // and Skia (dp) agree.
  let dp = cuv * vec2<f32>(2.0 * GREFX, 2.0 * GREFY);
  // A gs-aware feather: at sidebar-tile size a 1-unit mark goes sub-pixel, and
  // widening it fades the pattern into an even wash instead of aliasing into
  // moire.
  let aaDot = max(0.35, 0.8 / gs);
  if (u.dotLayer < 0.5 && u.dotAmt > 0.0) {
    cardCol = gOver(cardCol, u.dotColor.rgb, gDots(dp, u.time, aaDot) * u.dotAmt);
  }

  // Clip to the card's own distance field, on the unwarped position.
  let dCard = gSdRoundBox(q, halfExt, r);
  col = gOver(col, cardCol, 1.0 - smoothstep(-1.0, 1.0, dCard));

  // ── the two hairlines, OUTSIDE the clip and outside the filter ──
  // `strokeBorder` draws a 1-unit band INSIDE the edge: the difference of two
  // coverages. The second is the study's `topHighlight`, the same band faded out
  // by the middle of the card.
  if (u.borderAmt > 0.0) {
    let w = max(1.0 * gs, 0.5);
    let band = gCoverage(dCard, 0.6) - gCoverage(dCard + w, 0.6);
    col = gOver(col, u.borderColor.rgb, band * u.borderAmt);
    let topMask = clamp(1.0 - cuv.y * 2.0, 0.0, 1.0);
    col = gOver(col, u.borderColor.rgb, band * topMask * u.borderAmt * 1.27);
  }

  // Dither: this card lives almost entirely in the bottom stop of an 8-bit ramp.
  let dth = (fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  return vec4<f32>(clamp(col + vec3<f32>(dth), vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
