// Peaks — a white-to-black sky with two blurred domes rising through it and a
// dark foot scrim holding the base. This is the preview half.
//
// Ported from the "Gradient Card Styles" design study (card 1d). Its four
// siblings — Glow, Halo, Wave and Tile — are separate effects in effects/glow,
// effects/halo, effects/wave and effects/tile, each with its own config and its
// own three shaders. They share nothing but the two banks in effects/_shared.
//
// The CSS this came from:
//
//   background: linear-gradient(180deg,#FAFBFF 0%,#E7EEFF 20%,#9DBBFF 38%,
//                               #2E5CFF 56%,#0A1030 76%,#000000 100%)
//   border-radius: 26px
//
//   .peak1 { left:-14%; right:-14%; top:14%; height:56%;
//            border-radius: 50% 50% 0 0 / 78% 78% 0 0;
//            background: linear-gradient(180deg, rgba(40,95,255,.1) 0%,
//                                        rgba(40,95,255,.85) 55%, #00030F 100%);
//            filter: blur(46px); }
//   .peak2 { left:2%; right:2%; top:28%; height:48%;
//            border-radius: 50% 50% 0 0 / 80% 80% 0 0;
//            background: linear-gradient(180deg, rgba(0,65,255,.4) 0%, #000208 78%);
//            filter: blur(34px); }
//   .foot  { left:0; right:0; bottom:0; height:34%;
//            background: linear-gradient(180deg, transparent, #000 62%); }
//
// Three things the port changes on purpose:
//
// 1. Nothing is actually blurred. A Gaussian-blurred step edge is the normal
//    CDF of the signed distance, and `smoothstep(-K*sigma, K*sigma, d)` matches
//    that CDF to well under a level. So each dome is one SDF evaluation instead
//    of a blurred offscreen plate — which is what lets the card animate in a
//    single pass, and what kills the banding a stack of blurred layers
//    accumulates in the near-black lower stops. `filter: blur(N)` is sigma = N;
//    a `box-shadow` blur is sigma = N/2.
//
// 2. The two domes PARALLAX along the light instead of sitting still. The
//    displacement is written against (0,1) rather than against `ldir` itself, so
//    it is exactly zero at the default light and the card reproduces the
//    reference render pixel for pixel at rest. The front peak moves further than
//    the back one — that difference is what reads as depth.
//
// 3. Two layers of the study are deliberately absent: the content overlay (a
//    text layout) and the bloom layer, which is gated on a `bloomBoost` whose
//    design default is 0 and therefore paints nothing in the reference render.
//
// EVERY distance is in reference pixels against the 320x420 design and scaled by
// `gs` at use, so resizing the card preserves the look.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic uniform
// packer can walk one ordering. `card`/`light` are vec2 (align 8) and the
// colours are vec4 (align 16). With the shadow bank's `shadowAmt` making twelve
// scalars, `card` lands on a multiple of 8 and `light` ends on a multiple of 16,
// so the struct needs no implicit padding at all.
//
// peaks.metal and peaks.sksl are the other two implementations of this same
// maths. Change one, change all three.
// KNOWN LIMITATION, measured. The dome layers blur their COVERAGE but not their
// FILL: the silhouette is a Gaussian-blurred step (exact), while the gradient
// inside it is sampled sharp. CSS blurs the composite, which near the top of a
// dome pulls in the more-opaque fill from further down. Both peaks ramp their
// alpha steeply (.10 -> .85 over 55%, .40 -> 1.0 over 78%) across a 46/34px
// blur, so this is where it shows: measured against the SwiftUI reference at
// rest, Peaks sits 6.8 mean 8-bit levels off (up to ~30 locally in the upper
// third), where the other four cards sit at 0.8-4.8. The sky reads slightly
// lighter than the study's. Fixing it properly means smoothing the fill's own
// ramp by the blur width; the closed form for a Gaussian-convolved clamped ramp
// is cheap, but every attempt so far traded this error for a worse one at the
// dome shoulder, so the sharp fill stands until that is worked out.
//
struct Uniforms {
  size:        vec2<f32>,
  // Unused — the card does not animate. The runner writes it either way.
  time:        f32,
  radius:      f32,
  peak1Blur:   f32,
  peak1Dome:   f32,
  peak2Blur:   f32,
  peak2Dome:   f32,
  footHeight:  f32,
  grainAmt:    f32,
  intensity:   f32,
  // The shadow bank's strength knob. Its TINT is a colour and so sits with
  // the other vec4s below — the bank's two keys are the one pair in the
  // catalog that does not travel together in `mslArgOrder`.
  shadowAmt:   f32,
  card:        vec2<f32>,
  light:       vec2<f32>,
  bgTop:       vec4<f32>,
  bgBottom:    vec4<f32>,
  bg3:         vec4<f32>,
  bg4:         vec4<f32>,
  bg5:         vec4<f32>,
  bg6:         vec4<f32>,
  rimColor:    vec4<f32>,
  midColor:    vec4<f32>,
  deepColor:   vec4<f32>,
  topColor:    vec4<f32>,
  accentColor: vec4<f32>,
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
const GREFX: f32 = 160.0;
const GREFY: f32 = 210.0;

// smoothstep half-width, in sigmas, that best matches a Gaussian CDF.
// Phi has a 10-90 width of 2*1.2816*sigma; smoothstep(-a,a,x) has 1.218*a.
// Equating gives a = 2.104*sigma.
const GK: f32 = 2.104;

// The DC canvas the study was rendered on (body background #07070B).
const GCANVAS: vec3<f32> = vec3<f32>(0.02745098, 0.02745098, 0.04313725);

// The six-stop sky. Only the POSITIONS are baked — they are geometry; the six
// colours are params (bgTop, bg3, bg4, bg5, bg6, bgBottom).
const GBG1: f32 = 0.20;
const GBG2: f32 = 0.38;
const GBG3: f32 = 0.56;
const GBG4: f32 = 0.76;

// Back peak. `left:-14%;right:-14%;top:14%;height:56%` on 320x420 resolves to
// the rect x -44.8, y 58.8, w 409.6, h 235.2 — half-extent (204.8, 117.6),
// centre (160, 176.4), i.e. (0, -33.6) from the card centre.
const GP1EXT: vec2<f32> = vec2<f32>(204.8, 117.6);
const GP1CTR: vec2<f32> = vec2<f32>(0.0, -33.6);
// `rgba(40,95,255,.1) 0%, rgba(40,95,255,.85) 55%, #00030F 100%`
const GP1MID: f32 = 0.55;
const GP1A0: f32 = 0.10;
const GP1A1: f32 = 0.85;
// Parallax, in reference pixels of travel per unit of light displacement.
const GP1PAR: f32 = 24.0;

// Front peak. `left:2%;right:2%;top:28%;height:48%` → rect x 6.4, y 117.6,
// w 307.2, h 201.6 — half-extent (153.6, 100.8), centre (160, 218.4).
const GP2EXT: vec2<f32> = vec2<f32>(153.6, 100.8);
const GP2CTR: vec2<f32> = vec2<f32>(0.0, 8.4);
// `rgba(0,65,255,.4) 0%, #000208 78%` — constant past the second stop.
const GP2MID: f32 = 0.78;
const GP2A0: f32 = 0.40;
const GP2PAR: f32 = 40.0;

// Foot scrim: `linear-gradient(180deg, transparent, #000 62%)`.
const GFOOTMID: f32 = 0.62;

// feTurbulence baseFrequency="0.75" numOctaves="4", opacity .2, overlay.
// FOUR octaves here, not the three Glow uses.
const GBF: f32 = 0.75;
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

/// A blurred step across a signed distance: 1 inside, 0 outside, `sigma` wide.
/// The one primitive every soft edge in this card is built from.
fn gCoverage(d: f32, sigma: f32) -> f32 {
  let s = max(sigma, 0.0001);
  return 1.0 - smoothstep(-GK * s, GK * s, d);
}

/// Cheap ellipse SDF. `(k - 1) * min(rad)` is the standard approximation; its
/// error is far under the blur sigma of either dome here, and it is what keeps
/// a blurred dome a closed form instead of a convolution.
fn gSdEllipse(p: vec2<f32>, rad: vec2<f32>) -> f32 {
  let k = length(p / max(rad, vec2<f32>(0.0001)));
  return (k - 1.0) * min(rad.x, rad.y);
}

/// CSS `border-radius: 50% 50% 0 0 / f% f% 0 0`.
///
/// NOT a rounded rect: the horizontal corner radius is half the width, so the
/// two top corner ellipses meet and the flat top edge vanishes. The result is a
/// half-ellipse cap of height `f * height` sitting on straight sides with square
/// bottom corners — DomeShape in the study's CardShapes.swift.
///
/// `p` is relative to the rect centre, y down. `ext` is the half-extent.
fn gSdDome(p: vec2<f32>, ext: vec2<f32>, domeFrac: f32) -> f32 {
  let ry = clamp(domeFrac, 0.0001, 1.0) * 2.0 * ext.y;
  // Cap centre, measured from the rect centre: ry down from the top edge.
  let cy = -ext.y + ry;
  // The shape is an INTERSECTION of three constraints, so max of the three —
  // not a branch between a cap function and a sides function.
  //
  // Branching was the first attempt and it is subtly broken: an ellipse SDF and
  // a box SDF disagree wildly about how deep INSIDE a point is (at the centre
  // line of the front dome, -153.6 against -40.3), so the two branches meet at a
  // 113-unit cliff along y = cy. Outside the shape both read ~0 and the seam is
  // invisible; inside, gCoverage maps that cliff onto a ~12% alpha step and
  // paints a hard horizontal line across the card.
  //
  // Clamping the ellipse y-offset to <= 0 keeps the arc governing above the cap
  // centre and freezes it to its widest chord below, which is what makes the
  // three terms agree at y = cy. Verified: continuous there, and exactly zero at
  // the apex, at the widest chord and along the bottom edge.
  let arc = gSdEllipse(vec2<f32>(p.x, min(p.y - cy, 0.0)), vec2<f32>(ext.x, ry));
  return max(max(abs(p.x) - ext.x, p.y - ext.y), arc);
}

/// Premultiplied CSS gradient interpolation, un-premultiplied on the way out.
///
/// CSS interpolates gradients with premultiplied alpha, so
/// `rgba(40,95,255,.1) -> rgba(40,95,255,.85)` fades the alpha without dragging
/// the hue. Both of this card's peak fills change RGB *and* alpha across a
/// segment, so this is not optional. Returns (rgb, alpha).
fn gCssMix(c1: vec3<f32>, a1: f32, c2: vec3<f32>, a2: f32, f: f32) -> vec4<f32> {
  let p1 = vec4<f32>(c1 * a1, a1);
  let p2 = vec4<f32>(c2 * a2, a2);
  let pm = mix(p1, p2, clamp(f, 0.0, 1.0));
  // At alpha 0 the straight colour is undefined in CSS too; carrying the far
  // stop forward keeps the hue and matches the premultiplied result exactly.
  var rgb = c2;
  if (pm.a > 1e-6) { rgb = pm.rgb / pm.a; }
  return vec4<f32>(rgb, pm.a);
}

/// Parallax for a layer with no offset shadow to carry the light.
///
/// EXACTLY ZERO at the default light (0.5, 1.0) — which is what guarantees this
/// card reproduces its SwiftUI reference pixel for pixel at rest, and is why the
/// term is written as a displacement from (0,1) rather than as `ldir` itself.
fn gParallax(ldir: vec2<f32>, k: f32, gs: f32) -> vec2<f32> {
  return (ldir - vec2<f32>(0.0, 1.0)) * k * gs;
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

/// FOUR octaves — this card's grain, not Glow's three.
fn gFractal(p: vec2<f32>, channel: f32) -> f32 {
  var sum = 0.0;
  var amp = 1.0;
  var freq = 1.0;
  for (var i = 0; i < 4; i = i + 1) {
    sum = sum + gValueNoise(p * freq, channel + f32(i) * 37.0) * amp;
    freq = freq * 2.0;
    amp = amp * 0.5;
  }
  return clamp(0.5 + GGAIN * sum, 0.0, 1.0);
}

/// SVG filters run in linearRGB and are converted to sRGB before compositing.
/// Skip this and the grain reads far too dark.
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

/// The card's CONTENTS — the six-stop sky, the two domes and the foot scrim,
/// unclipped and unbounded, with no canvas, no grain and no dither.
///
/// Defined outside 0..1 on purpose, and CLAMP-EXTENDED at the edge. The filter
/// bank taps this through `mfTap`, which clamps its uv to 0..1 before calling in
/// (effects/_shared/filters.wgsl) — so a blur near the rim re-reads the edge of
/// the card rather than reaching past it. Returning something sensible outside
/// 0..1 still matters: it is what keeps the maths total and branch-free, and it
/// is what the clamp falls back on. What must NOT appear here is the canvas;
/// the caller applies the card's SDF mask AFTER filtering, so the silhouette
/// stays razor sharp however hard the contents are warped.
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
  // the corners and the domes circular when the card is stretched off the
  // design aspect, instead of shearing them.
  let gs = max(min(halfExt.x / GREFX, halfExt.y / GREFY), 0.0001);

  // Light direction and brightness. The light is a static pose — recentre the
  // unit-space param to a direction in -1..1 and use the intensity as given.
  let ldir = (u.light - vec2<f32>(0.5)) * 2.0;
  let inten = max(0.0, u.intensity);

  // ── the sky: six opaque stops, so a straight five-segment lerp is the CSS
  //    result exactly. Named cardCol, not card: `u.card` is the SIZE uniform,
  //    and a later edit that dropped the `u.` would otherwise compile into the
  //    wrong variable in silence. The other two files use the same name.
  let t = clamp(cuv.y, 0.0, 1.0);
  var cardCol: vec3<f32>;
  if (t < GBG1) {
    cardCol = mix(u.bgTop.rgb, u.bg3.rgb, t / GBG1);
  } else if (t < GBG2) {
    cardCol = mix(u.bg3.rgb, u.bg4.rgb, (t - GBG1) / (GBG2 - GBG1));
  } else if (t < GBG3) {
    cardCol = mix(u.bg4.rgb, u.bg5.rgb, (t - GBG2) / (GBG3 - GBG2));
  } else if (t < GBG4) {
    cardCol = mix(u.bg5.rgb, u.bg6.rgb, (t - GBG3) / (GBG4 - GBG3));
  } else {
    cardCol = mix(u.bg6.rgb, u.bgBottom.rgb, (t - GBG4) / (1.0 - GBG4));
  }

  // ── back peak ──
  let e1 = GP1EXT * gs;
  let l1 = q - GP1CTR * gs - gParallax(ldir, GP1PAR, gs);
  let cov1 = gCoverage(gSdDome(l1, e1, u.peak1Dome), u.peak1Blur * gs);
  // The fill runs down the dome RECT's own axis, not the card's.
  let v1 = clamp((l1.y + e1.y) / max(2.0 * e1.y, 0.0001), 0.0, 1.0);
  var g1: vec4<f32>;
  if (v1 < GP1MID) {
    g1 = gCssMix(u.rimColor.rgb, GP1A0, u.rimColor.rgb, GP1A1, v1 / GP1MID);
  } else {
    g1 = gCssMix(u.rimColor.rgb, GP1A1, u.deepColor.rgb, 1.0, (v1 - GP1MID) / (1.0 - GP1MID));
  }
  cardCol = gOver(cardCol, g1.rgb, g1.a * cov1 * inten);

  // ── front peak. Moves further than the back one; that is the depth cue. ──
  let e2 = GP2EXT * gs;
  let l2 = q - GP2CTR * gs - gParallax(ldir, GP2PAR, gs);
  let cov2 = gCoverage(gSdDome(l2, e2, u.peak2Dome), u.peak2Blur * gs);
  let v2 = clamp((l2.y + e2.y) / max(2.0 * e2.y, 0.0001), 0.0, 1.0);
  // One segment: the CSS holds #000208 from 78% to the bottom, and gCssMix
  // clamps its own interpolant, so the tail is already flat.
  let g2 = gCssMix(u.midColor.rgb, GP2A0, u.topColor.rgb, 1.0, v2 / GP2MID);
  cardCol = gOver(cardCol, g2.rgb, g2.a * cov2 * inten);

  // ── foot scrim. A DARKENING, so it is not multiplied by `inten` — Breathe
  //    would otherwise pump the base of the card as well as its light. It does
  //    not parallax either; it is pinned to the card, not to the sky.
  let s = clamp((cuv.y - (1.0 - u.footHeight)) / max(u.footHeight, 0.0001), 0.0, 1.0);
  cardCol = gOver(cardCol, u.accentColor.rgb, min(s / GFOOTMID, 1.0));

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


fn peaks(uv01: vec2<f32>) -> vec4<f32> {
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
  // footprint, so only the spill past the silhouette ever shows. Same light the
  // card is lit by, recentred to a direction exactly as mfSrc does it.
  let ldirC = (u.light - vec2<f32>(0.5)) * 2.0;
  col = mfsCardShadow(col, q, halfExt, r, gs, ldirC, u.shadowAmt,
                      max(0.0, u.intensity), u.shadowColor.rgb);

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

  // Dither. These gradients live in the bottom two stops of an 8-bit ramp,
  // where banding is not just visible but CRAWLS once the light moves.
  let dth = (fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  return vec4<f32>(clamp(col + vec3<f32>(dth), vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
