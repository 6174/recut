// Glow — a lit card: dark fill, four inset light bands lifted off one edge, and
// static film grain.
//
// Ported from the "Gradient Card Styles" design study (card 1a, "Bottom
// Bloom"). Its four siblings — Halo, Wave, Peaks and Tile — are separate
// effects in effects/halo, effects/wave, effects/peaks and effects/tile, each
// with its own config and its own three shaders. They share nothing but the two
// banks in effects/_shared.
//
// The CSS this came from:
//
//   background: linear-gradient(180deg,#0A0909 0%,#09101F 100%)
//   border-radius: 40px
//   box-shadow: inset 0 -18px 18px  -6px rgba(255,255,255,.42),
//               inset 0 -34px 28px  -8px rgba(105,148,255,.55),
//               inset 0 -74px 56px -28px #144CCD,
//               inset 0   6px  6px  -2px rgba(35,101,255,.22);
//
// plus the non-inset `0 34px 70px -24px` drop-glow the card casts on the canvas
// behind it — the shared shadow bank (effects/_shared/shadow.*), painted before
// the card because the card is opaque over its own footprint.
//
// Two things the port changes on purpose:
//
// 1. The four inset shadows are ONE LIGHT. Every one of them offsets along the
//    same axis (three down, one up), so instead of four independent x/y pairs
//    this takes a single `light` direction and derives all four offsets from
//    it. That is what makes the card draggable and sweepable — and at
//    light = (0.5, 1.0) it reproduces the CSS exactly.
//
// 2. Nothing is actually blurred. A Gaussian-blurred step edge is the normal
//    CDF of the signed distance, and `smoothstep(-K*sigma, K*sigma, d)` matches
//    that CDF to well under a level (see GK below). So each shadow is one SDF
//    evaluation instead of a blurred offscreen plate — which is what lets the
//    whole card animate in a single pass.
//
// EVERY distance is in reference pixels against the 320x420 design and scaled
// by `gs` at use, so resizing the card preserves the look instead of
// stretching it.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering. `card`/`light` are vec2 (align 8) and
// the colours are vec4 (align 16), so WGSL inserts 4 bytes of implicit padding
// before `card` — the packer mirrors that gap.
struct Uniforms {
  size:        vec2<f32>,
  time:        f32,
  // The shared animation bank's four params come first, so an adopting effect
  // can write `mslArgOrder: [...ANIM_ARG_KEYS, ...ownKeys]`.
  anim:        f32,
  animAmount:  f32,
  animShape:   f32,
  speed:       f32,
  radius:      f32,
  rimSize:     f32,
  midSize:     f32,
  deepSize:    f32,
  topSize:     f32,
  grainAmt:    f32,
  intensity:   f32,
  // The shadow bank's strength knob. Its TINT is a colour and so sits with the
  // other vec4s below — the bank's two keys are the one pair in the catalog
  // that does not travel together in `mslArgOrder`.
  shadowAmt:   f32,
  card:        vec2<f32>,
  light:       vec2<f32>,
  bgTop:       vec4<f32>,
  bgBottom:    vec4<f32>,
  rimColor:    vec4<f32>,
  midColor:    vec4<f32>,
  deepColor:   vec4<f32>,
  topColor:    vec4<f32>,
  shadowColor: vec4<f32>,
  // The shared filter bank's fourteen. LAST, mirroring `mslArgOrder` in
  // config.ts — lib/preview/runner.ts packs this struct POSITIONALLY from
  // that list, so a field out of order silently writes every later value
  // into the wrong slot.
  //
  // `filterId`, not `filter`: the latter is a RESERVED KEYWORD in WGSL.
  // It is legal in MSL and SkSL, so only this file renames it, and the
  // packer matches by position rather than by name so nothing else cares.
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

// Shared animation bank — WGSL. See effects/_shared/anim.ts for the contract.
//
// FOUR implementations must agree: this file, anim.metal, anim.sksl, and the
// TypeScript in anim.ts (which the drag handle needs so it can be drawn on the
// animated position). Change one, change all four.

/// Rotate a direction.
fn mfaRot(d: vec2<f32>, a: f32) -> vec2<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec2<f32>(d.x * c - d.y * s, d.x * s + d.y * c);
}

/// Triangle wave in [-1, 1], period 1.
fn mfaTri(x: f32) -> f32 {
  return abs(fract(x) * 2.0 - 1.0) * 2.0 - 1.0;
}

/// The whole animation bank.
///
///   mode  0 Orbit · 1 Breathe · 2 Drift · 3 Beat · 4 Scan
///   ph    time already multiplied by speed
///   amt   depth, 0..1
///   shp   character, 0..1 (ignored by Breathe and Beat)
///   rest  the resting light, in unit space
///
/// Returns (direction.x, direction.y, intensity multiplier). Every branch is
/// analytically invertible so the drag handle can go the other way — see
/// animRestingLight in anim.ts.
fn mfaAnim(mode: f32, ph: f32, amt: f32, shp: f32, rest: vec2<f32>) -> vec3<f32> {
  var d = (rest - vec2<f32>(0.5)) * 2.0;
  var z = 1.0;

  if (mode < 0.5) {
    // Orbit — the light travels round the card. `shp` squashes the circle into
    // an ellipse, so it lingers on two edges instead of sweeping evenly.
    d = mfaRot(d, ph * 0.6 * amt);
    d.y = d.y * mix(1.0, 0.45, shp);
  } else if (mode < 1.5) {
    // Breathe — one slow swell. The light also leans in and out a little,
    // because a pure brightness ramp reads as a fade rather than as breathing.
    let w = sin(ph * 1.1);
    d = d * (1.0 + amt * 0.35 * w);
    z = 1.0 + amt * 0.8 * w;
  } else if (mode < 2.5) {
    // Drift — two detuned sines, so the light wanders instead of repeating on
    // an obvious loop. `shp` stretches the horizontal excursion.
    let ax = mix(1.0, 1.8, shp);
    d = d + amt * 0.5 * vec2<f32>(sin(ph * 0.7) * ax, sin(ph * 0.53 + 1.7));
  } else if (mode < 3.5) {
    // Beat — sharp attack, slow decay, twice per cycle. Two offset exponentials
    // make the second thump land inside the first one's tail, which is what
    // separates a heartbeat from a blink.
    let u = fract(ph * 0.45);
    let env = exp(-u * 6.0) + 0.6 * exp(-max(u - 0.18, 0.0) * 7.0);
    z = 1.0 + amt * 1.1 * (env - 0.42);
  } else {
    // Scan — the light slides edge to edge on a triangle wave and reverses,
    // rather than going round. Adding a perpendicular component is a complex
    // multiply by (1 + ik), which keeps it exactly invertible.
    let s = mfaTri(ph * 0.25);
    let k = s * amt * 1.2;
    d = vec2<f32>(d.x - d.y * k, d.y + d.x * k);
    d = d * mix(1.0, 1.0 - 0.4 * abs(s), shp);
  }

  return vec3<f32>(d.x, d.y, z);
}


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
const GREFX: f32 = 160.0;
const GREFY: f32 = 210.0;

// smoothstep half-width, in sigmas, that best matches a Gaussian CDF.
// Phi has a 10-90 width of 2*1.2816*sigma; smoothstep(-a,a,x) has 1.218*a.
// Equating gives a = 2.104*sigma.
const GK: f32 = 2.104;

// The DC canvas the study was rendered on (body background #07070B).
const GCANVAS: vec3<f32> = vec3<f32>(0.02745098, 0.02745098, 0.04313725);

// Per-band CSS ratios: blur/offset and spread/offset, so one knob per band
// drives all three numbers and the proportions survive scaling.
//   band1  y -18  blur 18  spread  -6
//   band2  y -34  blur 28  spread  -8
//   band3  y -74  blur 56  spread -28
//   band4  y  +6  blur  6  spread  -2
const GB1B: f32 = 1.0;       const GB1S: f32 = -0.3333333;
const GB2B: f32 = 0.8235294; const GB2S: f32 = -0.2352941;
const GB3B: f32 = 0.7567568; const GB3S: f32 = -0.3783784;
const GB4B: f32 = 1.0;       const GB4S: f32 = -0.3333333;

// CSS alphas of the four bands.
const GA1: f32 = 0.42;
const GA2: f32 = 0.55;
const GA3: f32 = 1.0;
const GA4: f32 = 0.22;

// feTurbulence baseFrequency="0.85" numOctaves="3", opacity .15, overlay.
// `gain` and `seed` are the calibration measured against Chrome.
const GBF: f32 = 0.85;
const GGAIN: f32 = 0.26;
const GSEED: f32 = 17.0;

// ── helpers ──────────────────────────────────────────────────────────────────

/// The frame the card is measured in: the 393x851 reference iPhone, fitted
/// inside whatever view we are handed. `card` is a fraction of THIS, never of
/// the view — `card * res` stretched the rounded rect into a letterbox the
/// moment the canvas stopped being phone-shaped (a sidebar row, a square
/// gallery tile, an iPad), which is the one thing a card must never do. At the
/// 9:19.5 aspect every preview in the app uses, the frame IS the view, so the
/// look the defaults were drawn for does not move.
fn gCardFrame(res: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(393.0, 851.0) * max(min(res.x / 393.0, res.y / 851.0), 0.0001);
}

/// Signed distance to a rounded rectangle — negative inside.
fn gSdRoundBox(p: vec2<f32>, ext: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - ext + vec2<f32>(r);
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

/// CSS `box-shadow ... inset` as a closed form.
///
/// The spec paints the shadow as if everything OUTSIDE the inner rectangle were
/// opaque: the source is the complement of that rect, blurred, then clipped to
/// the padding box. So the coverage at a point is just the blurred step across
/// the inner rect's edge, i.e. the normal CDF of its signed distance.
///
/// `dist` is the band's offset along the light axis, in reference pixels;
/// blur and spread come from it through the per-band ratios above.
fn gInsetBand(q: vec2<f32>, ext: vec2<f32>, r: f32, ldir: vec2<f32>,
              dist: f32, blurK: f32, spreadK: f32, gs: f32) -> f32 {
  let spread = dist * spreadK * gs;
  // The inner rect moves AWAY from the light, which is what leaves the
  // complement showing on the lit edge.
  let off = -ldir * dist * gs;
  let d = gSdRoundBox(q - off, ext - vec2<f32>(spread), max(r - spread, 0.0));
  // CSS blur radius is 2 sigma.
  let sigma = max(dist * blurK * gs * 0.5, 0.0001);
  return smoothstep(-GK * sigma, GK * sigma, d);
}

/// One channel of `feTurbulence type="fractalNoise"`.
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

fn gLinearToSRGB(c: f32) -> f32 {
  if (c <= 0.0031308) { return c * 12.92; }
  return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

/// Photoshop/CSS `overlay`.
fn gOverlay(base: f32, blend: f32) -> f32 {
  if (base < 0.5) { return 2.0 * base * blend; }
  return 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
}

/// Source-over with a straight (non-premultiplied) source.
fn gOver(dst: vec3<f32>, src: vec3<f32>, a: f32) -> vec3<f32> {
  return mix(dst, src, clamp(a, 0.0, 1.0));
}

// ── entry ────────────────────────────────────────────────────────────────────

/// The card's CONTENTS — the fill plus the four light bands, unclipped and
/// unbounded, with no canvas, no grain and no dither.
///
/// Defined outside 0..1 on purpose, and CLAMP-EXTENDED at the edge. The filter
/// bank taps this through `mfTap`, which clamps its uv to 0..1 before calling in
/// (effects/_shared/filters.wgsl) — so a blur near the rim re-reads the edge of
/// the card rather than reaching past it. Returning something sensible outside
/// 0..1 still matters: it is what keeps the maths total and branch-free, and it
/// is what the clamp falls back on. What must NOT appear here is the canvas;
/// the caller applies the card's SDF mask AFTER filtering, so the
/// silhouette stays razor sharp however hard the contents are warped.
fn mfSrc(cuv: vec2<f32>) -> vec3<f32> {
  let res = u.size;

  // Card box, centred in the view but measured against the fitted design
  // frame, not the view: `card` is a fraction of THAT on each axis, so the
  // size and the aspect stay the user's to set and nobody else's.
  let frame = gCardFrame(res);
  let halfExt = 0.5 * clamp(u.card, vec2<f32>(0.02), vec2<f32>(1.0)) * frame;
  // `cuv` is CARD space: 0..1 across the card, so 0.5 is the card's centre and
  // the filter bank never has to know where on screen the card sits.
  let q = (cuv - vec2<f32>(0.5)) * 2.0 * halfExt;

  // One uniform scale for every reference-pixel distance. Taking the min keeps
  // the corner radius and the light bands circular when the card is stretched
  // off the design aspect, instead of shearing them.
  let gs = max(min(halfExt.x / GREFX, halfExt.y / GREFY), 0.0001);

  let r = clamp(u.radius * gs, 0.0, min(halfExt.x, halfExt.y));

  // Light direction and brightness, both from the shared animation bank. The
  // card does not know or care which of the five is running — see
  // effects/_shared/anim.ts.
  let an = mfaAnim(u.anim, u.time * u.speed, u.animAmount, u.animShape, u.light);
  let ldir = an.xy;
  let inten = max(0.0, u.intensity * an.z);

  // Named cardCol, not card: `u.card` is the SIZE uniform, and a later edit
  // that dropped the `u.` would otherwise compile into the wrong variable in
  // silence. The other two files use the same name.
  var cardCol = mix(u.bgTop.rgb, u.bgBottom.rgb,
                 clamp((q.y + halfExt.y) / max(2.0 * halfExt.y, 0.0001), 0.0, 1.0));

  // CSS paints the first-listed shadow topmost, so composite back to front.
  let a4 = gInsetBand(q, halfExt, r, -ldir, u.topSize,  GB4B, GB4S, gs) * GA4 * inten;
  cardCol = gOver(cardCol, u.topColor.rgb, a4);
  let a3 = gInsetBand(q, halfExt, r,  ldir, u.deepSize, GB3B, GB3S, gs) * GA3 * inten;
  cardCol = gOver(cardCol, u.deepColor.rgb, a3);
  let a2 = gInsetBand(q, halfExt, r,  ldir, u.midSize,  GB2B, GB2S, gs) * GA2 * inten;
  cardCol = gOver(cardCol, u.midColor.rgb, a2);
  let a1 = gInsetBand(q, halfExt, r,  ldir, u.rimSize,  GB1B, GB1S, gs) * GA1 * inten;
  cardCol = gOver(cardCol, u.rimColor.rgb, a1);

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


fn glow(uv01: vec2<f32>) -> vec4<f32> {
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
  // rounded silhouette into a rectangle — the filtered image no longer knows
  // where the card ends. So: filter the card CONTENTS, then mask with the
  // card's own SDF, and leave the background alone.
  var col = GCANVAS;

  // The card's drop-glow, from the shared shadow bank — the study's one
  // NON-inset shadow. Painted BEFORE the card: the card is opaque over its own
  // footprint, so only the spill past the silhouette ever shows. `mfaAnim` is
  // evaluated a second time here (mfSrc has its own copy) rather than threaded
  // through a global — it is a handful of ALU and it keeps mfSrc self-contained.
  let anC = mfaAnim(u.anim, u.time * u.speed, u.animAmount, u.animShape, u.light);
  col = mfsCardShadow(col, q, halfExt, r, gs, anC.xy, u.shadowAmt,
                      max(0.0, u.intensity * anC.z), u.shadowColor.rgb);

  // CARD SPACE, not frame space. `cuv` runs 0..1 across the card and `cres` is
  // the card in pixels, so every filter is expressed relative to the thing it
  // is filtering: Vignette centres on the card instead of the phone, Crystal's
  // facets count across the card, and every warp stays round on
  // the card's aspect rather than the screen's.
  //
  // `ppp` rides the FITTED FRAME, for the same reason the card does. It
  // converts points to device pixels, and now that the card is sized off the
  // frame, "Radius 10" means ten design points ON THE CARD whether the card
  // is filling a phone or a sidebar tile. mfBlurAt then divides by `cres`,
  // landing it as the right fraction of the card.
  // `393` is the reference iPhone width in points, so a radius given in points
  // lands the same in the preview (device px), on iOS (points) and on Skia (dp).
  let cres = 2.0 * halfExt;
  let cuv = (q + halfExt) / max(cres, vec2<f32>(1.0));
  var cardCol = mfFilter(cuv, cres, u.filterId, frame.x / 393.0,
                         u.fAmount, u.fScale, u.fBlur, u.fFade, u.fSoft, u.fAngle, u.fGrain, u.fBrightness, u.fContrast, u.fSaturation, u.fRound, u.fBevel, u.fInset);

  // Grain. feTurbulence writes four independent channels — R, G, B AND A — in
  // linearRGB, which the browser converts to sRGB before compositing. Alpha as
  // noise is most of the look, so it is reproduced rather than simplified.
  // AFTER the filter on purpose: it is the film over the finished card, and
  // putting it inside mfSrc would cost 17 evaluations under a blur.
  if (u.grainAmt > 0.0) {
    // Card-relative, i.e. reference pixels — which is where the design put it
    // too (the grain <svg> was 100% of the card, so its baseFrequency was in
    // the card's own user units).
    //
    // Going through `gs` is ALSO what makes the three renderers agree: this
    // shader receives `p` in DEVICE pixels in the WebGPU preview but in POINTS
    // on iOS and dp on Skia. Anything keyed off raw `p` comes out ~2x finer in
    // the preview than in either export, which would make the preview lie.
    let np = q / gs * GBF;
    let nr = gLinearToSRGB(gFractal(np, 0.0));
    let ng = gLinearToSRGB(gFractal(np, 101.0));
    let nb = gLinearToSRGB(gFractal(np, 211.0));
    let na = gFractal(np, 307.0);
    let mixed = vec3<f32>(gOverlay(cardCol.r, nr), gOverlay(cardCol.g, ng), gOverlay(cardCol.b, nb));
    cardCol = mix(cardCol, mixed, clamp(u.grainAmt * na, 0.0, 1.0));
  }

  // Now clip. The mask is the card's OWN distance field, evaluated on the
  // unwarped position, so the silhouette survives any amount of distortion
  // inside it. One-pixel feather so the corner reads clean.
  let dCard = gSdRoundBox(q, halfExt, r);
  col = gOver(col, cardCol, 1.0 - smoothstep(-1.0, 1.0, dCard));

  // Dither. These gradients live in the bottom two stops of an 8-bit
  // ramp, where banding is not just visible but CRAWLS once the light sweeps.
  let dth = (fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  return vec4<f32>(clamp(col + vec3<f32>(dth), vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
