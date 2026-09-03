// Duotone — a magenta-to-midnight sky raked at 138 degrees, one long blurred
// black band cutting across it and a rose blush leaning in from the top left.
// This is the preview half.
//
// Ported from the "Gradient Card Styles" design study (card 8, "Diagonal
// Duotone"), whose native size already IS the family's 320x420. Its siblings —
// Glow, Halo, Wave and Peaks — are separate effects in effects/glow,
// effects/halo, effects/wave and effects/peaks, each with its own config and its
// own three shaders. They share nothing but the banks in effects/_shared.
//
// The CSS this came from:
//
//   background: linear-gradient(138deg,#FF2D55 0%,#B32A8B 28%,#5B1FA2 50%,
//                               #1B1E6B 72%,#05060F 100%)
//   border-radius: 22px
//   box-shadow: 0 30px 70px -28px rgba(255,45,85,.38)
//
//   .band  { left:-96px; top:142.8px; width:512px; height:126px;
//            transform: rotate(-42deg);
//            background: linear-gradient(90deg, transparent 0%,
//                                        rgba(0,0,0,.9) 45%, transparent 100%);
//            filter: blur(26px); }
//   .blush { left:-64px; top:-58.8px; width:224px; height:184.8px;
//            background: radial-gradient(ellipse closest-side,
//                                        rgba(255,120,150,.6) 0%,
//                                        rgba(255,120,150,0) 72%);
//            filter: blur(28px); }
//   .foot  { left:0; top:243.6px; width:320px; height:176.4px;
//            background: linear-gradient(180deg, rgba(4,5,14,0) 0%,
//                                        rgba(4,5,14,.92) 76%,
//                                        rgba(4,5,14,.92) 100%); }
//
//   <feTurbulence baseFrequency="0.82" numOctaves="3"/>  opacity .17, overlay
//
// Four things the port changes on purpose:
//
// 1. Nothing is actually blurred. A Gaussian-blurred step edge is the normal
//    CDF of the signed distance, and `smoothstep(-K*sigma, K*sigma, d)` matches
//    that CDF to well under a level — so the band's long edges and the blush's
//    outer rim are each one SDF evaluation instead of an offscreen plate.
//    `filter: blur(N)` is sigma = N; a `box-shadow` blur is sigma = N/2. Both
//    blurred layers here are RAMPS inside their rect rather than flat fills, and
//    a Gaussian leaves a linear ramp alone — it only rounds the ramp's kinks —
//    so the ramps are evaluated analytically and only the rect boundary gets the
//    smoothstep.
//
// 2. The band and the blush PARALLAX along the light. The displacement is
//    written against (0,1) rather than against `ldir` itself, so it is exactly
//    zero at the default light (0.5, 1.0) and the card reproduces the reference
//    render pixel for pixel at rest. The blush is the near element and travels
//    42 reference pixels per unit of light displacement against the band's 18.
//
// 3. Every overlay layer here fades ONE colour, so the premultiplied
//    interpolation CSS does collapses to a constant RGB and an alpha ramp
//    (`cssTransparent(0xFF7896)` is the same hue at alpha 0 — that is the whole
//    point of premultiplied stops). Peaks needs a `gCssMix` helper because its
//    domes change hue *and* alpha across a segment; this card does not.
//
// 4. Two layers of the study are deliberately absent: the content overlay (a
//    text layout) and the bloom layer, which is gated on a `bloomBoost` whose
//    design default is 0 and therefore paints nothing in the reference render.
//
// EVERY distance is in reference pixels against the 320x420 design and scaled by
// `gs` at use, so resizing the card preserves the look.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic uniform
// packer can walk one ordering. `card`/`light` are vec2 (align 8) and the
// colours are vec4 (align 16). With the shadow bank's `shadowAmt` making twelve
// scalars in front of them, `card` lands on a multiple of 8 and `light` ends on
// a multiple of 16, so the struct needs no implicit padding at all.
//
// duotone.metal and duotone.sksl are the other two implementations of this same
// maths. Change one, change all three.
//
// APPROXIMATIONS, stated plainly:
//
//  - The band's gradient kinks (its peak at 45% and its two transparent ends)
//    are left sharp. A 26px sigma across a 512-long ramp rounds them over about
//    5% of the band's length; the ramp itself is exact, because convolving a
//    linear function with a Gaussian returns the same linear function.
//  - The blush's outer end is feathered INWARD (the coverage term multiplies a
//    ramp that already reaches zero at t = 0.72) rather than spread outward.
//    That is Wave's hotspot treatment, adopted verbatim so the two soft radials
//    in this catalog behave the same way.
//  - The drop shadow comes from the shared bank, which bakes the family's
//    `0 34px 70px -24px` at peak alpha 0.55. The study asked this card for
//    `0 30px 70px -28px` at 0.38. The bank's geometry is deliberately not
//    per-card, so the difference is absorbed by the `Shadow` slider.
//
struct Uniforms {
  size:        vec2<f32>,
  // Unused — the card does not animate. The runner writes it either way.
  time:        f32,
  radius:      f32,
  bandAngle:   f32,
  bandBlur:    f32,
  bandAmt:     f32,
  blushBlur:   f32,
  footHeight:  f32,
  grainAmt:    f32,
  intensity:   f32,
  // The shadow bank's strength knob. Its TINT is a colour and so sits with
  // the other vec4s below — the bank's two keys are the one pair in the
  // catalog that does not travel together in `mslArgOrder`.
  shadowAmt:   f32,
  card:        vec2<f32>,
  light:       vec2<f32>,
  bg1:         vec4<f32>,
  bg2:         vec4<f32>,
  bg3:         vec4<f32>,
  bg4:         vec4<f32>,
  bg5:         vec4<f32>,
  bandColor:   vec4<f32>,
  blushColor:  vec4<f32>,
  footColor:   vec4<f32>,
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

// ── the sky ──
// `cssLinear(stops, angle: 138, in: 320x420)`, reproduced from
// CSSCompat.swift#cssLinear rather than from memory: CSS angles run CLOCKWISE
// FROM "TO TOP", and the study's y axis points down, so the gradient's unit
// direction is (sin a, -cos a) in the same down-positive space this shader works
// in. At 138 degrees that is (0.669, 0.743) — right and down.
//
// The gradient LINE is sized so its ends sit on the box's corner projections:
// L = |w*dx| + |h*dy| = 320*0.669 + 420*0.743 = 526.24. A point then lands at
// t = 0.5 + dot(p - centre, dir) / L. Verified against the Swift at 0 deg
// ("to top"), 90 deg ("to right") and 180 deg ("to bottom").
const GBGDIR: vec2<f32> = vec2<f32>(0.66913061, 0.74314483);
const GBGLEN: f32 = 526.24262;

// Only the stop POSITIONS are baked — they are geometry; the five colours are
// params (bg1..bg5). All five are opaque, so a straight four-segment lerp is the
// CSS result exactly.
const GBG1: f32 = 0.28;
const GBG2: f32 = 0.50;
const GBG3: f32 = 0.72;

// ── the band ──
// `CGRect(x: -96, y: 142.8, width: 512, height: 126)` in the 320x420 card
// resolves to mid (160, 205.8) — i.e. (0, -4.2) from the card's centre — with
// half-extent (256, 63).
const GBANDCTR: vec2<f32> = vec2<f32>(0.0, -4.2);
const GBANDEXT: vec2<f32> = vec2<f32>(256.0, 63.0);
// The band's own gradient is `angle: 90, in: 512x126` — straight across its
// LOCAL long axis, so L is the band's 512 width and t is just its local x.
const GBANDMID: f32 = 0.45;
// Parallax travel, in reference pixels per unit of light displacement. The band
// is the far element; see GBLUSHPAR.
const GBANDPAR: f32 = 18.0;

// ── the blush ──
// `CGRect(x: -64, y: -58.8, width: 224, height: 184.8)` → mid (48, 33.6), i.e.
// (-112, -176.4) from the card's centre, half-extent (112, 92.4). `cssEllipse`
// puts location 1.0 at HALF the rect's size, so the normalised elliptical radius
// is length((p - centre) / half) and a stop `at: 0.72` is read at that radius
// directly.
const GBLUSHCTR: vec2<f32> = vec2<f32>(-112.0, -176.4);
const GBLUSHEXT: vec2<f32> = vec2<f32>(112.0, 92.4);
const GBLUSHA0: f32 = 0.60;
const GBLUSHEND: f32 = 0.72;
// The near element, so it travels more than twice the band's distance. The two
// numbers are what reads as depth; equal numbers would read as one flat plate
// sliding under the light.
const GBLUSHPAR: f32 = 42.0;

// ── the foot ──
// `CGRect(x: 0, y: 243.6, width: 320, height: 176.4)` — full width, the bottom
// 42% of the card (176.4/420), which is `footHeight`'s default. `cssLinear180`
// runs top-to-bottom across the layer's own rect, and the last two stops are
// identical, so the alpha ramps to 0.92 by 76% and then holds.
const GFOOTMID: f32 = 0.76;
const GFOOTA: f32 = 0.92;

// feTurbulence baseFrequency="0.82" numOctaves="3", opacity .17, overlay.
// THREE octaves, like Glow's — Peaks is the one card with four.
const GBF: f32 = 0.82;
const GGAIN: f32 = 0.26;
const GSEED: f32 = 17.0;

// Degrees to radians, written out so the constant is byte-identical in all
// three languages rather than trusting three `radians()` builtins to agree.
const GDEG: f32 = 0.017453292519943295;

// ── helpers ──────────────────────────────────────────────────────────────────

/// The frame the card is measured in: the 393x851 reference iPhone, fitted
/// inside whatever view we are handed. `card` is a fraction of THIS, never of
/// the view — `card * res` stretched the rounded rect into a letterbox the
/// moment the canvas stopped being phone-shaped (a sidebar row, a square gallery
/// tile, an iPad), which is the one thing a card must never do. At the 9:19.5
/// aspect every preview in the app uses, the frame IS the view, so the look the
/// defaults were drawn for does not move.
fn gCardFrame(res: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(393.0, 851.0) * max(min(res.x / 393.0, res.y / 851.0), 0.0001);
}

/// Signed distance to a rounded rectangle — negative inside.
fn gSdRoundBox(p: vec2<f32>, ext: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - ext + vec2<f32>(r);
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

/// A blurred step across a signed distance: 1 inside, 0 outside, `sigma` wide.
/// The one primitive every soft edge on this card is built from.
fn gCoverage(d: f32, sigma: f32) -> f32 {
  let s = max(sigma, 0.0001);
  return 1.0 - smoothstep(-GK * s, GK * s, d);
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

/// THREE octaves — this card's grain, like Glow's, not Peaks' four.
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

/// The card's CONTENTS — the diagonal sky, the band, the blush and the foot,
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

  // Card box, centred in the view but measured against the fitted design frame,
  // not the view: `card` is a fraction of THAT on each axis, so the size and the
  // aspect stay the user's to set and nobody else's.
  let frame = gCardFrame(res);
  let halfExt = 0.5 * clamp(u.card, vec2<f32>(0.02), vec2<f32>(1.0)) * frame;
  // `cuv` is CARD space: 0..1 across the card, so 0.5 is the card's centre and
  // the filter bank never has to know where on screen the card sits.
  let q = (cuv - vec2<f32>(0.5)) * 2.0 * halfExt;

  // One uniform scale for every reference-pixel distance. Taking the min keeps
  // the band's width and the blush's roundness intact when the card is stretched
  // off the design aspect, instead of shearing them.
  let gs = max(min(halfExt.x / GREFX, halfExt.y / GREFY), 0.0001);

  // Light direction and brightness. The light is a static pose — recentre the
  // unit-space param to a direction in -1..1 and use the intensity as given.
  let ldir = (u.light - vec2<f32>(0.5)) * 2.0;
  let inten = max(0.0, u.intensity);

  // ── the sky ──
  // Measured in the REFERENCE card's own 320x420 pixels rather than through
  // `gs`, because the CSS sizes its gradient line off the box it fills: the sky
  // must always span the whole card, however the card is stretched, the same way
  // Peaks' six-stop sky rides `cuv.y`. The three layers below are objects ON the
  // card and do go through `gs`, so they stay unsheared.
  let bp = (cuv - vec2<f32>(0.5)) * vec2<f32>(2.0 * GREFX, 2.0 * GREFY);
  let t = clamp(0.5 + dot(bp, GBGDIR) / GBGLEN, 0.0, 1.0);
  // Named cardCol, not card: `u.card` is the SIZE uniform, and a later edit that
  // dropped the `u.` would otherwise compile into the wrong variable in silence.
  // The other two files use the same name.
  var cardCol: vec3<f32>;
  if (t < GBG1) {
    cardCol = mix(u.bg1.rgb, u.bg2.rgb, t / GBG1);
  } else if (t < GBG2) {
    cardCol = mix(u.bg2.rgb, u.bg3.rgb, (t - GBG1) / (GBG2 - GBG1));
  } else if (t < GBG3) {
    cardCol = mix(u.bg3.rgb, u.bg4.rgb, (t - GBG2) / (GBG3 - GBG2));
  } else {
    cardCol = mix(u.bg4.rgb, u.bg5.rgb, (t - GBG3) / (1.0 - GBG3));
  }

  // ── the band ──
  // `CSSLayer(rotation: -42deg)` rotates the layer's CONTENT about the rect's
  // centre, so a point is carried into band-local space by the INVERSE rotation.
  // SwiftUI's rotationEffect turns clockwise in this down-positive space, i.e.
  // local +x maps to world (cos, sin).
  let ba = u.bandAngle * GDEG;
  let bc = cos(ba);
  let bs = sin(ba);
  let bw = q - GBANDCTR * gs - gParallax(ldir, GBANDPAR, gs);
  let bl = vec2<f32>(bw.x * bc + bw.y * bs, -bw.x * bs + bw.y * bc);
  let bext = GBANDEXT * gs;

  // The band's gradient is `angle: 90` in a 512x126 box — straight along its
  // local long axis, gradient-line length 512, so t is local x over the band's
  // own width. A Gaussian leaves a linear ramp exactly alone, so the ramp is
  // evaluated sharp and only its two kinks (the peak at 45% and the transparent
  // ends) are left un-rounded; at sigma 26 over 512 that is ~5% of the length.
  let bt = clamp(0.5 + bl.x / max(2.0 * bext.x, 0.0001), 0.0, 1.0);
  var bramp = bt / GBANDMID;
  if (bt >= GBANDMID) { bramp = (1.0 - bt) / (1.0 - GBANDMID); }

  // The mask that MATTERS is the band's 126-tall local y. Its rect also ends at
  // |local x| = 256, but the gradient is already exactly zero there — the stops
  // run transparent -> black -> transparent across the full width — so an x term
  // would multiply zero by a softened zero. One edge, not four.
  let bcov = gCoverage(abs(bl.y) - bext.y, u.bandBlur * gs);
  // A DARKENING, so it is not multiplied by `inten`: turning the light up should
  // brighten the blush, not deepen the shadow it casts.
  cardCol = gOver(cardCol, u.bandColor.rgb, u.bandAmt * bramp * bcov);

  // ── the blush. The near element; moves further than the band. ──
  // Already a soft radial, so `filter: blur(28px)` widens its falloff rather
  // than convolving it: the elliptical ramp is evaluated analytically on the
  // normalised radius and only its outer end is feathered, by treating the
  // distance past the 0.72 stop as a signed distance in pixels. Same treatment
  // Wave gives its hotspot.
  let hp = q - GBLUSHCTR * gs - gParallax(ldir, GBLUSHPAR, gs);
  let hext = GBLUSHEXT * gs;
  let e = length(hp / max(hext, vec2<f32>(0.0001)));
  var ha = GBLUSHA0 * clamp(1.0 - e / GBLUSHEND, 0.0, 1.0);
  let minR = min(hext.x, hext.y);
  ha = ha * gCoverage((e - GBLUSHEND) * minR, u.blushBlur * gs) * inten;
  // Both stops are the same hue at different alphas, so CSS's premultiplied
  // interpolation leaves the straight RGB constant — one colour, one ramp.
  cardCol = gOver(cardCol, u.blushColor.rgb, ha);

  // ── the foot ──
  // `cssLinear180` over the layer's own rect, which is the bottom `footHeight`
  // of the card. A DARKENING, so no `inten`, and it does not parallax: it is
  // pinned to the card, not to the sky.
  let s = clamp((cuv.y - (1.0 - u.footHeight)) / max(u.footHeight, 0.0001), 0.0, 1.0);
  cardCol = gOver(cardCol, u.footColor.rgb, GFOOTA * min(s / GFOOTMID, 1.0));

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


fn duotone(uv01: vec2<f32>) -> vec4<f32> {
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

  // Dither. This card's lower half lives in the bottom two stops of an 8-bit
  // ramp, where banding is not just visible but CRAWLS once the light moves.
  let dth = (fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  return vec4<f32>(clamp(col + vec3<f32>(dth), vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
