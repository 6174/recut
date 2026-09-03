// Ember — three solid-colour waves, blurred until they are only glow, pooling at
// the foot of a black well. This is the preview half.
//
// THE STUDY'S BEZEL IS NOT PORTED. The CSS sank the well into a #212127 rounded
// rect inset 9px around it; at any inset that frame read as a second grey card
// sitting behind the gradient, so the card here is the well alone — one rounded
// rect, one `radius`, no `bezelInset`/`wellRadius`/`bezelColor`.
//
// Ported from the "Gradient Card Styles" design study (card 5a, "Ember"). Its
// siblings — Glow, Halo, Wave and Peaks — are separate effects in effects/glow,
// effects/halo, effects/wave and effects/peaks, each with its own config and its
// own three shaders. They share nothing but the banks in effects/_shared.
//
// The CSS this came from:
//
//   .card  { background:#212127; border-radius:48px;
//            box-shadow: 0 24px 60px -30px rgba(0,0,0,.8); }
//   .well  { position:absolute; inset:9px; background:#0A0A0E;
//            border-radius:40px; overflow:hidden; }
//
//   /* each wave is <svg viewBox="0 0 282 366" preserveAspectRatio="none">
//      absolutely positioned inside the well */
//   .wave  { position:absolute; left:-14px; top:-14px; width:310px; height:394px; }
//   .wave1 { fill:#FF3636; filter: blur(56px); }
//     d="M-30 180 C40 152 110 150 170 182 C220 208 262 222 312 232
//        L312 396 L-30 396 Z"
//   .wave2 { fill:#FFE436; filter: blur(42px); }
//     d="M-30 284 C30 290 80 286 140 264 C200 242 256 228 312 226
//        L312 396 L-30 396 Z"
//   .wave3 { top:16px; fill:#FFFFFF; opacity:.9; filter: blur(24px);
//            mix-blend-mode: plus-lighter; }
//     d="M-30 295 C30 278 110 278 160 306 C200 328 260 322 312 314
//        L312 396 L-30 396 Z"
//
// Four things the port changes on purpose:
//
// 1. THE CARD IS RESIZED INTO THE CATALOG'S REFERENCE SPACE. The study drew this
//    one at 300x384; every other card here — and effects/_shared/statcard.ts, and
//    the shared `gs` — is expressed against 320x420. So each of the study's
//    numbers is multiplied by 320/300 = 1.0667 on x and 420/384 = 1.09375 on y:
//    radius 48 -> 51, inset 9 -> 10, well radius 40 -> 42, and the three blur
//    sigmas 56/42/24 -> 60/45/26. The 2.5% the two factors disagree by is
//    invisible; a second reference size would not be.
//
// 2. Nothing is actually blurred. A Gaussian-blurred step edge is the normal CDF
//    of the signed distance, and `smoothstep(-K*sigma, K*sigma, d)` matches that
//    CDF to well under a level. So each wave is one Bézier solve instead of a
//    blurred offscreen plate — which is what lets the card be a single pass, and
//    what kills the banding three stacked blurs accumulate over a #0A0A0E well.
//    `filter: blur(N)` is sigma = N; a `box-shadow` blur is sigma = N/2.
//
// 3. The three waves PARALLAX along the light instead of sitting still. The
//    displacement is written against (0,1) rather than against `ldir` itself, so
//    it is exactly zero at the default light and the card reproduces the
//    reference render pixel for pixel at rest. The front crest travels 48
//    reference pixels per unit of light against the middle wave's 34 and the back
//    wave's 20 — that spread is the whole depth cue.
//
// 4. Two layers of the study are deliberately absent: the content overlay (a text
//    layout) and the bloom layer, which is gated on a `bloomBoost` whose design
//    default is 0 and therefore paints nothing in the reference render. This card
//    has no grain layer in the study either, so there is no Grain knob.
//
// EVERY distance is in reference pixels against the 320x420 design and scaled by
// `gs` at use, so resizing the card preserves the look.
//
// The one thing here that is NOT a port is the Animation group: three ways to
// move the waves (Wave / Swell / Drift), a light that wanders and an intensity
// that breathes. Every one of them is a DISPLACEMENT of the same baked Béziers,
// in `u` and in `v`, so the geometry, the colours and the blur are untouched —
// and `Animation = Off` returns the reference still exactly.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic uniform
// packer can walk one ordering. `card`/`light` are vec2 (align 8) and the colours
// are vec4 (align 16). Fourteen scalars land `card` on 64 and the colours on 80,
// so the struct needs no implicit padding at all — the seven animation keys
// closed the 4-byte gap the six-scalar layout used to carry.
//
// ember.metal and ember.sksl are the other two implementations of this same
// maths. Change one, change all three.
//
// KNOWN APPROXIMATION. Each wave's coverage is the Gaussian CDF of the VERTICAL
// signed distance to its curve, not the perpendicular one. The two differ by
// cos(slope): the steepest stretch of any of the three paths runs at dy/dx ~
// 0.56, so the transition there is ~13% wider than it should be — against sigmas
// of 60/45/26 reference pixels, i.e. a fraction of a level over a glow that is
// already three quarters blur. What the same simplification also drops is the
// paths' own vertical side edges at x = -30 and x = 312, which land 47 well-units
// outside the well and so bleed a little of their blur back in: measured, the
// left and right rims of the well read up to ~20% hotter here than in the
// reference. Both are the price of a closed form; the alternative is convolving a
// Bézier, which is not a fragment.
//
struct Uniforms {
  size:        vec2<f32>,
  time:        f32,
  // The 0-based index of the Animation option: 0 wave, 1 swell, 2 drift, 3 off.
  // `off` is the study's still.
  anim:        f32,
  radius:      f32,
  wave1Blur:   f32,
  wave2Blur:   f32,
  wave3Blur:   f32,
  intensity:   f32,
  // The shadow bank's strength knob. Its TINT is a colour and so sits with the
  // other vec4s below — the bank's two keys are the one pair in the catalog that
  // does not travel together in `mslArgOrder`.
  shadowAmt:   f32,
  // The animation knobs. SEVEN of them, which is also what makes this struct
  // padding-free: fourteen scalars land `card` on 64 and the colours on 80.
  animSpeed:   f32,
  animAmount:  f32,
  animSpread:  f32,
  waveFreq:    f32,
  lightSway:   f32,
  glowPulse:   f32,
  card:        vec2<f32>,
  light:       vec2<f32>,
  wellColor:   vec4<f32>,
  wave1Color:  vec4<f32>,
  wave2Color:  vec4<f32>,
  wave3Color:  vec4<f32>,
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

// Half the reference card, 320x420.
const EREFX: f32 = 160.0;
const EREFY: f32 = 210.0;

// smoothstep half-width, in sigmas, that best matches a Gaussian CDF.
// Phi has a 10-90 width of 2*1.2816*sigma; smoothstep(-a,a,x) has 1.218*a.
// Equating gives a = 2.104*sigma.
const EK: f32 = 2.104;

// The DC canvas the study was rendered on (body background #07070B).
const ECANVAS: vec3<f32> = vec3<f32>(0.02745098, 0.02745098, 0.04313725);

// ── the wave geometry ────────────────────────────────────────────────────────
//
// Each wave is an SVG path whose viewBox is the WELL (282x366 in the study's own
// units) drawn into a frame rect placed inside that same 282x366 container, with
// preserveAspectRatio="none" — so viewBox units stretch independently on each
// axis. A path point (px, py) lands in well units at
//
//     wx = rectX + px * (310/282)      wy = rectY + py * (394/366)
//
// and everything below works in NORMALISED well space (0..1 across the well) so
// the maths is resolution independent and identical in all three files. The
// viewBox size survives only as the unit the path is quoted in.
const EVBW: f32 = 282.0;
const EVBH: f32 = 366.0;
const ESX: f32 = 310.0 / 282.0;
const ESY: f32 = 394.0 / 366.0;
// All three rects share x = -14; the front wave alone is dropped 30 units.
const ERX: f32 = -14.0;
const ERYBACK: f32 = -14.0;
const ERYFRONT: f32 = 16.0;

// Back wave — #FF3636, blur 56 -> 60 reference px, normal blend.
const EW1P0: vec2<f32> = vec2<f32>(-30.0, 180.0);
const EW1C1: vec2<f32> = vec2<f32>(40.0, 152.0);
const EW1C2: vec2<f32> = vec2<f32>(110.0, 150.0);
const EW1P1: vec2<f32> = vec2<f32>(170.0, 182.0);
const EW1C3: vec2<f32> = vec2<f32>(220.0, 208.0);
const EW1C4: vec2<f32> = vec2<f32>(262.0, 222.0);
const EW1P2: vec2<f32> = vec2<f32>(312.0, 232.0);

// Middle wave — #FFE436, blur 42 -> 45, normal blend.
const EW2P0: vec2<f32> = vec2<f32>(-30.0, 284.0);
const EW2C1: vec2<f32> = vec2<f32>(30.0, 290.0);
const EW2C2: vec2<f32> = vec2<f32>(80.0, 286.0);
const EW2P1: vec2<f32> = vec2<f32>(140.0, 264.0);
const EW2C3: vec2<f32> = vec2<f32>(200.0, 242.0);
const EW2C4: vec2<f32> = vec2<f32>(256.0, 228.0);
const EW2P2: vec2<f32> = vec2<f32>(312.0, 226.0);

// Front wave — #FFFFFF at .9, blur 24 -> 26, mix-blend-mode: plus-lighter.
const EW3P0: vec2<f32> = vec2<f32>(-30.0, 295.0);
const EW3C1: vec2<f32> = vec2<f32>(30.0, 278.0);
const EW3C2: vec2<f32> = vec2<f32>(110.0, 278.0);
const EW3P1: vec2<f32> = vec2<f32>(160.0, 306.0);
const EW3C3: vec2<f32> = vec2<f32>(200.0, 328.0);
const EW3C4: vec2<f32> = vec2<f32>(260.0, 322.0);
const EW3P2: vec2<f32> = vec2<f32>(312.0, 314.0);

// The study's `.opacity(0.9)` on the front wave, carried into the additive term.
const EW3ALPHA: f32 = 0.9;

// Parallax, in reference pixels of travel per unit of light displacement. Front
// furthest, back least — the spread is what reads as depth when you drag.
const EW1PAR: f32 = 20.0;
const EW2PAR: f32 = 34.0;
const EW3PAR: f32 = 48.0;

// ── animation ────────────────────────────────────────────────────────────────
// How far each wave moves at Depth = 1, as a fraction of the FRONT crest's
// travel. Same ordering as the parallax constants below and for the same reason:
// the difference between the layers is the depth cue. The waves are stored back
// to front (0 back, 2 front), the opposite of Ridge's layers, so the depth rank
// is derived rather than being the layer index.
const EAW_MID: f32 = 0.62;
const EAW_BACK: f32 = 0.38;

// Peak travel at Motion = 1, in REFERENCE PIXELS against the 320x420 design —
// the same units the three blur sigmas are quoted in, converted through `gs` and
// the well's own size at use, so the motion scales with the card. Wave is the
// smallest because it is a shape change rather than a move.
const EAMP_WAVE: f32 = 15.0;
const EAMP_SWELL: f32 = 24.0;
const EAMP_DRIFT: f32 = 36.0;

const ETAU: f32 = 6.28318530718;


// ── helpers ──────────────────────────────────────────────────────────────────

/// The frame the card is measured in: the 393x851 reference iPhone, fitted
/// inside whatever view we are handed. `card` is a fraction of THIS, never of
/// the view — `card * res` stretched the rounded rect into a letterbox the
/// moment the canvas stopped being phone-shaped (a sidebar row, a square gallery
/// tile, an iPad), which is the one thing a card must never do. At the 9:19.5
/// aspect every preview in the app uses, the frame IS the view, so the look the
/// defaults were drawn for does not move.
fn eCardFrame(res: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(393.0, 851.0) * max(min(res.x / 393.0, res.y / 851.0), 0.0001);
}

/// Signed distance to a rounded rectangle — negative inside.
fn eSdRoundBox(p: vec2<f32>, ext: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - ext + vec2<f32>(r);
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

/// A blurred step across a signed distance: 1 inside, 0 outside, `sigma` wide.
/// The one primitive every soft edge in this card is built from.
fn eCoverage(d: f32, sigma: f32) -> f32 {
  let s = max(sigma, 0.000001);
  return 1.0 - smoothstep(-EK * s, EK * s, d);
}

/// One coordinate of a cubic Bézier at `t`.
fn eBez1(a: f32, b: f32, c: f32, d: f32, t: f32) -> f32 {
  let m = 1.0 - t;
  return m * m * m * a + 3.0 * m * m * t * b + 3.0 * m * t * t * c + t * t * t * d;
}

/// y on one cubic segment at a given x.
///
/// x(t) is strictly increasing on every segment of all three paths (their x
/// control values are sorted), so x -> t is single-valued and BISECTION solves
/// it: sixteen halvings resolve t to 2^-17, far below a pixel. A literal
/// iteration count on purpose — SkSL is strict ES2 and will not take a loop
/// bound that is not a compile-time constant, so this is the one form the three
/// files can share.
fn eSegY(x: f32, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, d: vec2<f32>) -> f32 {
  var lo = 0.0;
  var hi = 1.0;
  for (var i = 0; i < 16; i = i + 1) {
    let mid = 0.5 * (lo + hi);
    if (eBez1(a.x, b.x, c.x, d.x, mid) < x) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  let t = 0.5 * (lo + hi);
  return eBez1(a.y, b.y, c.y, d.y, t);
}

/// The wave's boundary in normalised well space: given `u` (0..1 across the
/// well), the `v` the curve sits at.
///
/// Inverts the viewBox placement to get the path's own x, picks the segment by
/// its x range, solves for y, then maps back through the rect. Clamping x to the
/// path's span is not a fudge — the path closes with a straight run down x = -30
/// and up x = 312, so holding the endpoint y outside the span describes the
/// filled region exactly.
fn eWaveV(uu: f32, ry: f32,
          p0: vec2<f32>, c1: vec2<f32>, c2: vec2<f32>, p1: vec2<f32>,
          c3: vec2<f32>, c4: vec2<f32>, p2: vec2<f32>) -> f32 {
  let px = clamp((uu * EVBW - ERX) / ESX, p0.x, p2.x);
  var py: f32;
  if (px < p1.x) {
    py = eSegY(px, p0, c1, c2, p1);
  } else {
    py = eSegY(px, p1, c3, c4, p2);
  }
  return (ry + py * ESY) / EVBH;
}

/// Parallax for a layer with no offset shadow to carry the light.
///
/// EXACTLY ZERO at the default light (0.5, 1.0) — which is what guarantees this
/// card reproduces its SwiftUI reference pixel for pixel at rest, and is why the
/// term is written as a displacement from (0,1) rather than as `ldir` itself.
fn eParallax(ldir: vec2<f32>, k: f32, gs: f32) -> vec2<f32> {
  return (ldir - vec2<f32>(0.0, 1.0)) * k * gs;
}

/// Source-over with a straight (non-premultiplied) source.
fn eOver(dst: vec3<f32>, src: vec3<f32>, a: f32) -> vec3<f32> {
  return mix(dst, src, clamp(a, 0.0, 1.0));
}

/// The animation clock. ONE gate for the whole feature: `Animation = Off`
/// returns zero here, and every moving term below is written to vanish at t=0,
/// so the card falls back to the reference render exactly rather than nearly.
/// Speed 0 freezes the pose instead — the ripple stays, the clock stops.
fn eAnimT() -> f32 {
  if (i32(u.anim + 0.5) > 2) { return 0.0; }
  return u.time * max(u.animSpeed, 0.0);
}

/// Depth rank of a wave: 0 is the front crest. The waves are stored back to
/// front (0 back, 1 mid, 2 front), so this is the layer index reversed — and it
/// is what every per-layer term below keys off.
fn eAnimDepth(layerIdx: i32) -> i32 {
  return 2 - layerIdx;
}

/// How far a wave travels, relative to the front crest. Depth = 0 moves all
/// three as one sheet; 1 is the study's own depth ordering.
fn eAnimWeight(layerIdx: i32) -> f32 {
  let d = eAnimDepth(layerIdx);
  var w = 1.0;
  if (d == 1) { w = EAW_MID; }
  else if (d == 2) { w = EAW_BACK; }
  return mix(1.0, w, clamp(u.animSpread, 0.0, 2.0));
}

/// Where wave `layerIdx` has moved to at normalised well-x `uu`, in REFERENCE
/// PIXELS. The caller converts to well space with the same `gs / wellRes` the
/// blur sigmas use, so the motion scales with the card.
///
/// A DISPLACEMENT of the baked curve, never a new curve: `.x` shifts which part
/// of the crest is sampled and `.y` moves that height. The coverage here is a
/// function of the vertical distance alone, so evaluating the curve at the
/// displaced x is exactly the blurred moving wave rather than an approximation
/// of one.
fn eAnimOffset(layerIdx: i32, uu: f32, tt: f32) -> vec2<f32> {
  let mode = i32(u.anim + 0.5);
  var o = vec2<f32>(0.0);
  if (mode <= 2) {
    let d = f32(eAnimDepth(layerIdx));
    let w = eAnimWeight(layerIdx) * max(u.animAmount, 0.0);
    // The front crest is the fastest as well as the furthest, and each wave
    // behind it starts a fixed phase back — without that they move as one body
    // and the depth reads as a single sheet sliding.
    let rate = 1.0 - 0.22 * d;
    let ph = d * 0.9;
    if (mode == 0) {
      // Wave — a ripple travelling ALONG the crest. `uu` is 0..1 across the
      // well, so Ripples is a count across the card's own width.
      o.y = EAMP_WAVE * w * sin(ETAU * max(u.waveFreq, 0.0) * uu - tt * 1.1 * rate + ph);
    } else if (mode == 1) {
      // Swell — uniform in u, so the whole glow rises and falls. The lateral
      // term is a third of the vertical and much slower: enough that the wave
      // leans into the rise instead of riding an elevator.
      o.y = EAMP_SWELL * w * sin(tt * 0.75 * rate + ph);
      o.x = 0.45 * EAMP_SWELL * w * sin(tt * 0.38 * rate + ph + 1.7);
    } else {
      // Drift — the waves slide past one another. Mostly lateral, with a slow
      // bob so the horizon is not on rails.
      o.x = EAMP_DRIFT * w * sin(tt * 0.55 * rate + ph);
      o.y = 0.30 * EAMP_DRIFT * w * sin(tt * 0.37 * rate + ph + 2.1);
    }
  }
  return o;
}

/// The light, wandering around wherever it was dropped.
///
/// BOTH sine terms — not sin/cos — because a cosine is 1 at t=0 and would
/// teleport the light the instant the animation was switched on. As written the
/// drift starts from the posed direction, which is also what keeps the drag
/// handle honest. One source for the whole card: the per-wave parallax and the
/// drop shadow read this, so they can never disagree about where the light is.
fn eLightDir() -> vec2<f32> {
  let tt = eAnimT();
  let s = 0.5 * clamp(u.lightSway, 0.0, 1.0);
  return (u.light - vec2<f32>(0.5)) * 2.0
       + vec2<f32>(sin(tt * 0.31), sin(tt * 0.23)) * s;
}

/// Intensity, breathing. Rides on `intensity` rather than on the wave colours,
/// so the plus-lighter crest and the drop shadow — both scaled by the same
/// number — breathe with it.
fn eIntensity() -> f32 {
  let tt = eAnimT();
  let pulse = 1.0 + 0.35 * clamp(u.glowPulse, 0.0, 1.0) * sin(tt * 0.8);
  return max(0.0, u.intensity) * max(pulse, 0.0);
}

// ── entry ────────────────────────────────────────────────────────────────────

/// The card's CONTENTS — the three waves glowing over the well fill, with no
/// canvas, no drop shadow and no dither.
///
/// The card's rounded-rect clip is the CALLER's, applied to the unwarped position
/// after the filter. The study's graphite bezel is gone: the card is one rounded
/// rect — the well — so there is one silhouette and one radius.
///
/// Defined outside 0..1 on purpose, and CLAMP-EXTENDED at the edge. The filter
/// bank taps this through `mfTap`, which clamps its uv to 0..1 before calling in
/// (effects/_shared/filters.wgsl) — so a blur near the rim re-reads the edge of
/// the card rather than reaching past it. Returning something sensible outside
/// 0..1 still matters: it is what keeps the maths total and branch-free, and it
/// is what the clamp falls back on. What must NOT appear here is the canvas; the
/// caller applies the card's SDF mask AFTER filtering, so the silhouette stays
/// razor sharp however hard the contents are warped.
fn mfSrc(cuv: vec2<f32>) -> vec3<f32> {
  let res = u.size;

  // Card box, centred in the view but measured against the fitted design frame,
  // not the view: `card` is a fraction of THAT on each axis, so the size and the
  // aspect stay the user's to set and nobody else's.
  let frame = eCardFrame(res);
  let halfExt = 0.5 * clamp(u.card, vec2<f32>(0.02), vec2<f32>(1.0)) * frame;
  // `cuv` is CARD space: 0..1 across the card, so 0.5 is the card's centre and
  // the filter bank never has to know where on screen the card sits.
  let q = (cuv - vec2<f32>(0.5)) * 2.0 * halfExt;

  // One uniform scale for every reference-pixel distance. Taking the min keeps
  // the card's corners round when it is stretched off the design aspect, instead
  // of shearing them.
  let gs = max(min(halfExt.x / EREFX, halfExt.y / EREFY), 0.0001);

  // Light direction and brightness. The pose is recentred from unit space to a
  // direction in -1..1, then drifted and pulsed — both zero at t=0, so the
  // handle you drag is where the motion starts.
  let ldir = eLightDir();
  let inten = eIntensity();
  let tt = eAnimT();

  // ── the well: the whole card, now that the study's bezel is gone ──
  // Still named `wellExt` because the waves are placed in WELL space, which is
  // the space the SVG's viewBox was quoted against. Only the EXTENT is needed
  // here; the rounded rect is not applied in this function at all — see the
  // return.
  let wellExt = halfExt;

  // Normalised well space, y down: 0..1 across the well on each axis. The SVG
  // was placed with preserveAspectRatio="none", so it stretches with the card
  // rather than keeping the study's 282:366.
  let wellRes = 2.0 * wellExt;

  // Named cardCol, not card: `u.card` is the SIZE uniform, and a later edit that
  // dropped the `u.` would otherwise compile into the wrong variable in silence.
  // The other two files use the same name.
  var cardCol = u.wellColor.rgb;

  // ── back wave — #FF3636, normal blend ──
  // Each wave is sampled at its OWN parallaxed point, so the three slide over
  // one another as the light moves.
  let w1 = (q - eParallax(ldir, EW1PAR, gs) + wellExt) / wellRes;
  // Reference pixels -> normalised well space, per axis, exactly as the sigma
  // below is converted. The curve is displaced, not the sample point.
  let a1 = eAnimOffset(0, w1.x, tt) * gs / wellRes;
  let v1 = eWaveV(w1.x + a1.x, ERYBACK, EW1P0, EW1C1, EW1C2, EW1P1, EW1C3, EW1C4, EW1P2) + a1.y;
  // Sigma converted into normalised well space: reference pixels -> device
  // pixels via `gs`, then over the well's own height. Only the vertical sigma
  // matters, because the coverage is a function of the vertical distance alone —
  // see the KNOWN APPROXIMATION note at the top.
  let s1 = u.wave1Blur * gs / wellRes.y;
  // Inside the filled region means BELOW the curve, i.e. the sample's v is
  // greater than the curve's — so the signed distance, negative inside, is
  // `v1 - w1.y`.
  let cov1 = eCoverage(v1 - w1.y, s1);
  cardCol = eOver(cardCol, u.wave1Color.rgb, cov1 * inten);

  // ── middle wave — #FFE436, normal blend ──
  let w2 = (q - eParallax(ldir, EW2PAR, gs) + wellExt) / wellRes;
  let a2 = eAnimOffset(1, w2.x, tt) * gs / wellRes;
  let v2 = eWaveV(w2.x + a2.x, ERYBACK, EW2P0, EW2C1, EW2C2, EW2P1, EW2C3, EW2C4, EW2P2) + a2.y;
  let s2 = u.wave2Blur * gs / wellRes.y;
  let cov2 = eCoverage(v2 - w2.y, s2);
  cardCol = eOver(cardCol, u.wave2Color.rgb, cov2 * inten);

  // ── front wave — #FFFFFF at .9, mix-blend-mode: plus-lighter ──
  // plusLighter is ADDITIVE in premultiplied space, not source-over: it is what
  // lets the white crest bloom past the yellow underneath it instead of
  // replacing it. Travels furthest of the three.
  let w3 = (q - eParallax(ldir, EW3PAR, gs) + wellExt) / wellRes;
  let a3 = eAnimOffset(2, w3.x, tt) * gs / wellRes;
  let v3 = eWaveV(w3.x + a3.x, ERYFRONT, EW3P0, EW3C1, EW3C2, EW3P1, EW3C3, EW3C4, EW3P2) + a3.y;
  let s3 = u.wave3Blur * gs / wellRes.y;
  let cov3 = eCoverage(v3 - w3.y, s3);
  cardCol = cardCol + u.wave3Color.rgb * (EW3ALPHA * cov3 * inten);

  // ── the well group, UNBOUNDED ──
  //
  // No mask. §15.2 rule 1: `mfSrc` returns the CONTENT only, and the caller masks
  // with an unwarped SDF AFTER filtering.
  //
  // Nothing is needed to make the group extend past the well: `eWaveV` clamps
  // its x to the path's own span, so a sample off the edge re-reads the well's
  // edge rather than reaching into something else — which is the clamp-extension
  // the rule asks for.
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


fn ember(uv01: vec2<f32>) -> vec4<f32> {
  let res = u.size;
  let p = uv01 * res;
  let frame = eCardFrame(res);
  let halfExt = 0.5 * clamp(u.card, vec2<f32>(0.02), vec2<f32>(1.0)) * frame;
  let q = p - 0.5 * res;
  let gs = max(min(halfExt.x / EREFX, halfExt.y / EREFY), 0.0001);
  let r = clamp(u.radius * gs, 0.0, min(halfExt.x, halfExt.y));

  // ── the canvas — DELIBERATELY OUTSIDE mfSrc ──
  // The filter must only touch the CARD. Warping or blurring the composite would
  // drag the distortion across the whole screen and chew the card's rounded
  // silhouette into a rectangle — the filtered image no longer knows where the
  // card ends. So: filter the card CONTENTS, then mask with the card's own SDF,
  // and leave the background alone.
  var col = ECANVAS;

  // The card's drop shadow — the study's `0 24px 60px -30px rgba(0,0,0,.8)` —
  // from the shared bank, which bakes the family's `0 34px 70px -24px` geometry
  // and leaves strength and tint editable. Painted BEFORE the card: the card is
  // opaque over its own footprint, so only the spill past the silhouette ever
  // shows. Same light the card is lit by, recentred to a direction exactly as
  // mfSrc does it.
  // The SAME light and the SAME intensity mfSrc uses — both through the animated
  // accessors, so the shadow under the card drifts and breathes with the glow on
  // it instead of sitting still beneath a moving picture.
  let ldirC = eLightDir();
  col = mfsCardShadow(col, q, halfExt, r, gs, ldirC, u.shadowAmt,
                      eIntensity(), u.shadowColor.rgb);

  // CARD SPACE, not frame space. `cuv` runs 0..1 across the card and `cres` is
  // the card in pixels, so every filter is expressed relative to the thing it is
  // filtering: Vignette centres on the card instead of the phone, Crystal's
  // facets count across the card, and every warp stays round on the card's
  // aspect rather than the screen's.
  //
  // `ppp` rides the FITTED FRAME, for the same reason the card does. It converts
  // points to device pixels, so "Radius 10" means ten design points ON THE CARD
  // whether the card is filling a phone or a sidebar tile. `393` is the
  // reference iPhone width in points, so a radius given in points lands the same
  // in the preview (device px), on iOS (points) and on Skia (dp).
  let cres = 2.0 * halfExt;
  let cuv = (q + halfExt) / max(cres, vec2<f32>(1.0));
  let cardCol = mfFilter(cuv, cres, u.filterId, frame.x / 393.0,
                         u.fAmount, u.fScale, u.fBlur, u.fFade, u.fSoft, u.fAngle, u.fGrain, u.fBrightness, u.fContrast, u.fSaturation, u.fRound, u.fBevel, u.fInset);

  // Now clip — ONE mask, on the unwarped position, so the silhouette survives any
  // distortion inside it. One pixel of feather so the corners read clean. There
  // is no bezel behind the card any more: the card IS the well, one rounded rect
  // at `radius`.
  let dCard = eSdRoundBox(q, halfExt, r);
  col = eOver(col, cardCol, 1.0 - smoothstep(-1.0, 1.0, dCard));

  // Dither. Three overlapping blurs over a #0A0A0E well live in the bottom two
  // stops of an 8-bit ramp, where banding is not just visible but CRAWLS once
  // the light moves.
  let dth = (fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  return vec4<f32>(clamp(col + vec3<f32>(dth), vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
