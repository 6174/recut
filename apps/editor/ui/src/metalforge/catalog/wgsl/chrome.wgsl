// Chrome — a black card with a white halo hanging over its top edge, a cool
// wash falling out of the halo, and a dark foot pulling the base back down.
// This is the preview half.
//
// Ported from the "Gradient Card Styles" design study (card 1f, "Chrome
// Bloom"). Its siblings — Glow, Halo, Wave and Peaks — are separate effects in
// effects/glow, effects/halo, effects/wave and effects/peaks, each with its own
// config and its own three shaders. They share nothing but the banks in
// effects/_shared.
//
// The CSS this came from:
//
//   background: #000000
//   border-radius: 40px
//   box-shadow: inset 0 1px 0 0 rgba(255,255,255,.5);   // the top hairline
//
//   .halo { left:-22%; right:-22%; top:-30%; height:62%;
//           background: radial-gradient(closest-side, #FFFFFF,
//                       rgba(214,226,242,.6) 44%, transparent 76%);
//           filter: blur(34px); }
//   .wash { inset:0;
//           background: linear-gradient(180deg, rgba(196,212,235,.3) 0%,
//                       rgba(120,136,160,.12) 22%, transparent 48%); }
//   .foot { left:0; right:0; bottom:0; height:56%;
//           background: linear-gradient(180deg, transparent, #000 62%); }
//
// plus the non-inset `0 30px 70px -30px rgba(210,225,255,.3)` drop-glow, which
// is the shared shadow bank.
//
// Four things the port changes on purpose:
//
// 1. The halo HANGS OFF THE TOP. Its rect is centred 4.2 reference pixels below
//    the card's top edge, so five sixths of it sits above the card and only the
//    lower lobe lands on it. That is the whole trick of the design.
//
// 2. `light` is the halo's POSITION, not a direction — the card has one light
//    and you can see where it is, so the drag handle moves the halo itself. The
//    offset is written as a departure from the default light (0.5, 0.0), which
//    makes it exactly zero at rest and is what guarantees this reproduces the
//    reference render pixel for pixel there.
//
// 3. Nothing is actually blurred. A Gaussian-blurred step edge is the normal CDF
//    of the signed distance, and `smoothstep(-K*sigma, K*sigma, d)` matches that
//    CDF to well under a level. `filter: blur(N)` is sigma = N; a `box-shadow`
//    blur is sigma = N/2.
//
// 4. Two layers of the study are deliberately absent: the content overlay (a
//    text layout) and the bloom layer, which is gated on a `bloomBoost` whose
//    design default is 0 and therefore paints nothing in the reference render.
//
// EVERY distance is in reference pixels against the 320x420 design and scaled by
// `gs` at use, so resizing the card preserves the look.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic uniform
// packer can walk one ordering. `card`/`light` are vec2 (align 8) and the colours
// are vec4 (align 16). With the shadow bank's `shadowAmt` making nine scalars
// after `time`, `card` lands on a multiple of 8 and `light` ends on a multiple of
// 16, so the struct needs no implicit padding at all.
//
// chrome.metal and chrome.sksl are the other two implementations of this same
// maths. Change one, change all three.
//
// TWO APPROXIMATIONS, stated plainly.
//
// The halo's `filter: blur(34px)` is a CLOSED FORM for the convolution, not a
// multi-tap one. `mfSrc` is what the filter bank re-reads seventeen times per
// pixel, so a real kernel is out of the question — but the layer being blurred
// is a radial ramp, and blurring a radial ramp is analytic enough to write down.
// Three things happen to it, and all three are here:
//
//   · The profile MOVES OUTWARD in t. At the cone tip that shift is the kernel's
//     own mean radius (a cone under a Gaussian becomes a dome); out on the ramp
//     it is the tangential curvature term, st^2/2t. Both are sqrt(t^2 + c*st^2)
//     with a different c, so the two c's are blended.
//   · Every KINK ROUNDS — the apex at 0 and the stops at 0.44 and 0.76. That is
//     what lowers the peak, and rounding the last stop is what lets light spread
//     PAST it, which the old outer-edge feather could not do at all. The ramp is
//     therefore written as a sum of ramp functions and each corner is rounded
//     over GK sigmas by `gSoftRamp`.
//   · It is ANISOTROPIC. A blur that is isotropic in PIXELS is not isotropic in
//     t: sigma 34 is 0.148 of the ellipse's half-width but 0.256 of its
//     half-height, so the blurred halo spreads half again as far down as it does
//     across. The radial and tangential halves of the kernel's variance are
//     carried separately rather than averaged, which is what keeps the sheen
//     reaching the card's left and right edges instead of pinching to a spot.
//
// The layer's COLOUR blurs with it, premultiplied, exactly as CSS composites:
// the only hue in the ramp is the white excess over #D6E2F2, itself a little
// cone, so it is softened by the same primitive and the centre cools the way the
// study's does.
//
// Checked against a numerically convolved halo: alpha is within 0.011 of the
// true convolution everywhere at the design blur, within 0.025 out to sigma 55,
// and within 0.06 at the slider's maximum of 80 — where the kernel is two thirds
// of the ellipse and no closed form is going to be exact. At Halo Blur = 0 the
// softened radius IS the radius and every corner half-width is zero, so the
// whole thing collapses to the sharp CSS ramp.
//
// The drop-glow is the shared bank's `0 34px 70px -24px`, not this card's own
// `0 30px 70px -30px`. Four points of offset and six of spread at the 320-wide
// design, under a 70px blur: the bank's geometry is baked so all five cards sit
// on the canvas the same way, and matching that was worth more than the fourth
// decimal place. The tint and the strength are this card's own.
struct Uniforms {
  size:         vec2<f32>,
  // Unused — the card does not animate. The runner writes it either way.
  time:         f32,
  radius:       f32,
  rimAmt:       f32,
  haloBlur:     f32,
  haloSize:     f32,
  washAmt:      f32,
  footHeight:   f32,
  grainAmt:     f32,
  intensity:    f32,
  // The shadow bank's strength knob. Its TINT is a colour and so sits with
  // the other vec4s below — the bank's two keys are the one pair in the
  // catalog that does not travel together in `mslArgOrder`.
  shadowAmt:    f32,
  card:         vec2<f32>,
  light:        vec2<f32>,
  bgColor:      vec4<f32>,
  rimColor:     vec4<f32>,
  haloColor:    vec4<f32>,
  haloMidColor: vec4<f32>,
  washTop:      vec4<f32>,
  washMid:      vec4<f32>,
  footColor:    vec4<f32>,
  shadowColor:  vec4<f32>,
  // The shared filter bank's fourteen. LAST, mirroring `mslArgOrder` in
  // config.ts — lib/preview/runner.ts packs this struct POSITIONALLY from that
  // list, so a field out of order silently writes every later value into the
  // wrong slot.
  //
  // `filterId`, not `filter`: the latter is a RESERVED KEYWORD in WGSL. It is
  // legal in MSL and SkSL, so only this file renames it, and the packer matches
  // by position rather than by name so nothing else cares.
  filterId:     f32,
  fAmount:      f32,
  fScale:       f32,
  fBlur:        f32,
  fFade:        f32,
  fSoft:        f32,
  fAngle:       f32,
  fGrain:       f32,
  fBrightness:  f32,
  fContrast:    f32,
  fSaturation:  f32,
  fRound:       f32,
  fBevel:       f32,
  fInset:       f32,
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

// The top hairline: `InsetShadowSpec(x: 0, y: 1, blur: 0, spread: 0,
// rgba(#FFFFFF,.5))`. One reference pixel of offset, no spread — and a blur of
// ZERO, which is the one number that cannot be taken literally. A step with no
// width shimmers as the card is resized, so it is given half a reference pixel
// of sigma: enough to antialias, far under the one-pixel band it edges.
const GRIMDIST: f32 = 1.0;
const GRIMSIGMA: f32 = 0.5;
const GRIMSPREAD: f32 = 0.0;

// The halo. `CSSLayer` rect (-70.4, -126, 460.8, 260.4) on the 320x420 card is
// half-extent (230.4, 130.2) centred at (160, 4.2) — i.e. (0, -205.8) from the
// card centre, which is 4.2 reference pixels BELOW the top edge. The card
// fraction is (0.5, 0.01), which is what the `light` default rounds to.
const GHALOEXT: vec2<f32> = vec2<f32>(230.4, 130.2);
const GHALOCTR: vec2<f32> = vec2<f32>(0.0, -205.8);
// `cssEllipse` stops: `#FFFFFF @1 at 0, #D6E2F2 @.6 at .44, #D6E2F2 @0 at .76`.
// `cssEllipse` puts location 1.0 at HALF the rect, so t = length(p / half).
const GHALOS1: f32 = 0.44;
const GHALOS2: f32 = 0.76;
const GHALOA1: f32 = 0.60;
// The same ramp read as SLOPES, which is what lets the blur round each kink on
// its own: -0.909 in to the first stop, -1.875 on to the second, flat after it.
const GHALOM0: f32 = -(1.0 - GHALOA1) / GHALOS1;
const GHALOM1: f32 = -GHALOA1 / (GHALOS2 - GHALOS1);
// How far out in t the blurred profile rides, in units of the blur's variance
// ACROSS the radius: GHALONEAR at the centre, where the shift is the kernel's
// own mean radius (pi/2 variances, rounded down a little by the fit), falling to
// GHALOFAR out on the ramp, where it is the curvature term st^2/2t. GHALOBLEND
// is how fast one becomes the other, in mean variances — and it is reused as the
// softening that keeps the radial/tangential split finite at the centre, where a
// radius has no direction. Fitted against a numerically convolved halo over the
// whole 0..80 range of Halo Blur.
const GHALONEAR: f32 = 1.45;
const GHALOFAR: f32 = 0.85;
const GHALOBLEND: f32 = 2.0;

// The wash: a `CSSLayer` over the whole card (rect 0,0,320,420) filled with
// `cssLinear180` — `#C4D4EB @.3 at 0, #7888A0 @.12 at .22, #7888A0 @0 at .48`.
// Its rect IS the card, so the card's own SDF mask is the only edge it has.
const GWASHS1: f32 = 0.22;
const GWASHS2: f32 = 0.48;
const GWASHA0: f32 = 0.30;
const GWASHA1: f32 = 0.12;

// The foot: rect (0, 184.8, 320, 235.2) — the bottom 56% of the card — filled
// with `#000 @0 at 0, #000 @1 at .62, #000 @1 at 1`. Black at both ends, so
// only the ALPHA ramps: transparent at the top of the rect, opaque from 62% down.
const GFOOTMID: f32 = 0.62;

// feTurbulence baseFrequency="0.75" numOctaves="4", opacity .2, overlay.
// FOUR octaves here, the same as Peaks and one more than Glow.
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

/// `max(x, 0)` with its corner rounded over a half-width `a` — the integral of
/// `smoothstep(-a, a, ·)`, and the primitive the blurred halo is built from.
///
/// A Gaussian-blurred RAMP is exactly this: R'(x) is the blurred step, so R is
/// the blurred corner. The smoothstep integral matches it to well under a level
/// at a = GK sigma (both are 0.19a at x = 0 against the Gaussian's 0.399 sigma)
/// and, unlike the hyperbolic softplus, it has COMPACT support — R is exactly 0
/// below -a and exactly x above +a, so the halo still ends, and its un-
/// premultiplied hue does not drift out in a tail that never quite reaches zero.
/// At a = 0 it is `max(x, 0)` exactly, which is what collapses the blurred halo
/// back to the CSS ramp at Halo Blur = 0.
fn gSoftRamp(x: f32, a: f32) -> f32 {
  let aa = max(a, 1e-6);
  let u = clamp((x + aa) / (2.0 * aa), 0.0, 1.0);
  return 2.0 * aa * (u * u * u - 0.5 * u * u * u * u) + max(x - aa, 0.0);
}

/// CSS `box-shadow ... inset` as a closed form — glow.wgsl's `gInsetBand`, with
/// the blur and the spread given straight in reference pixels instead of as
/// ratios of the offset. Glow drives four bands off one knob each and wants the
/// proportions locked; this card has ONE band whose CSS blur is 0, and a ratio
/// of zero would leave nothing to write the antialias sigma into.
///
/// The spec paints the shadow as if everything OUTSIDE the inner rectangle were
/// opaque: the source is the complement of that rect, blurred, then clipped to
/// the padding box. So coverage at a point is the blurred step across the inner
/// rect's edge — the normal CDF of its signed distance.
fn gInsetBand(q: vec2<f32>, ext: vec2<f32>, r: f32, ldir: vec2<f32>,
              dist: f32, sigmaRef: f32, spreadRef: f32, gs: f32) -> f32 {
  let spread = spreadRef * gs;
  // The inner rect moves AWAY from the light, which is what leaves the
  // complement showing on the lit edge. At this card's default light — up — the
  // rect drops by one pixel and the hairline lands on the TOP edge, which is
  // the study's `y: 1`.
  let off = -ldir * dist * gs;
  let d = gSdRoundBox(q - off, ext - vec2<f32>(spread), max(r - spread, 0.0));
  let sigma = max(sigmaRef * gs, 0.0001);
  // ...AND THEN CLIPPED TO THE PADDING BOX. That clip is the second half of the
  // spec above and it used to be left to the caller's mask, which is exactly
  // what broke under a filter: the complement alone is 1 everywhere outside the
  // card, so with spread 0 — the inner rect's sides then coinciding with the
  // card's — the ramp straddles the left, right and bottom edges and reads HALF
  // ON along all three. Unfiltered that is a sub-pixel sliver the caller's mask
  // hides. But every filter that displaces its sampling (Glass, Crystal,
  // Frosted, Blur, Fade blur, Motion blur) reads `mfSrc` through `mfTap`, which
  // CLAMPS each tap into the unit card box — landing a whole rim's worth of them
  // exactly on that boundary — and the half-on band floods the card's edge with
  // grey lobes. §15.2 rule 1: what `mfSrc` returns past its own edge has to be
  // the content, not a shape's complement.
  //
  // Clipping it is not a second smoothstep multiplied in. The two edges are the
  // SAME LINE wherever the offset runs along them, and a product of coverages
  // assumes they are independent — it leaves 0.25 where the true intersection is
  // empty, which is a 1px scratch tracing the rim under any warp. What the
  // shadow actually is, is the STRIP between the card's edge and the inner
  // rect's, and a blurred strip is the difference of the two edges' CDFs. Taking
  // it as one closed form is what makes it exactly zero where they coincide, and
  // exactly the hairline where they are a pixel apart.
  let sIn = smoothstep(-GK * sigma, GK * sigma, -gSdRoundBox(q, ext, r));
  let sOut = smoothstep(-GK * sigma, GK * sigma, -d);
  return max(sIn - sOut, 0.0);
}

/// Premultiplied CSS gradient interpolation, un-premultiplied on the way out.
///
/// CSS interpolates gradients with premultiplied alpha, so `#FFFFFF @1 ->
/// #D6E2F2 @.6` fades the alpha without dragging the hue, and `cssTransparent`
/// (the same RGB at alpha 0) fades to nothing while KEEPING its hue. Both of
/// this card's ramps end on one, so this is not optional. Returns (rgb, alpha).
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

/// Where the halo's centre sits, in card-centred pixels, given the light.
///
/// EXACTLY ZERO at the default light (0.5, 0.0) — which is what guarantees this
/// card reproduces its SwiftUI reference pixel for pixel at rest, and is why the
/// term is written as a displacement from the default rather than as `ldir`
/// itself. `ldir` is `light` recentred to -1..1, so `ldir - (0,-1)` is twice the
/// departure in unit card space; multiplying by `halfExt` (half the card)
/// converts it to pixels. The light therefore travels in CARD units: dragging it
/// to the card's left edge puts the halo's centre on the left edge.
fn gHaloOffset(ldir: vec2<f32>, halfExt: vec2<f32>) -> vec2<f32> {
  return (ldir - vec2<f32>(0.0, -1.0)) * halfExt;
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

/// The card's CONTENTS — the black fill, the top hairline, the halo, the wash
/// and the foot, unclipped and unbounded, with no canvas, no grain and no
/// dither.
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
  // the corners and the halo circular when the card is stretched off the design
  // aspect, instead of shearing them.
  let gs = max(min(halfExt.x / GREFX, halfExt.y / GREFY), 0.0001);
  // No corner radius here any more: the only layer that wanted it was the top
  // hairline, and that moved to the entry point. Nothing else in the card's
  // content knows where the silhouette is — which is the point of rule 1.

  // Light direction and brightness. The light is a static pose — recentre the
  // unit-space param to a direction in -1..1 and use the intensity as given.
  // The default (0.5, 0.0) lands on (0, -1): straight UP, which is the one real
  // difference from the sibling cards, whose light points down.
  let ldir = (u.light - vec2<f32>(0.5)) * 2.0;
  let inten = max(0.0, u.intensity);

  // ── background: flat #000000. The only card in the family with no gradient
  //    under everything else — all five of its stops are in the layers above.
  //    Named cardCol, not card: `u.card` is the SIZE uniform, and a later edit
  //    that dropped the `u.` would otherwise compile into the wrong variable in
  //    silence. The other two files use the same name.
  var cardCol = u.bgColor.rgb;

  // ── the top hairline is NOT here. It is an EDGE, and §15.2 rule 1 keeps
  //    edges out of `mfSrc`: it is painted in the entry point, on the unwarped
  //    position, after the filter. See the note there.

  // ── the halo ────────────────────────────────────────────────────────────
  // `cssEllipse` on a rect whose centre is 4.2 reference pixels below the card's
  // top edge, so most of it hangs off the top and only the lower lobe lands.
  // `t = length(p / half)` because location 1.0 sits at HALF the rect.
  let hext = GHALOEXT * gs * max(u.haloSize, 0.0001);
  let hp = q - (GHALOCTR * gs + gHaloOffset(ldir, halfExt));
  let hs = hp / max(hext, vec2<f32>(0.0001));   // ellipse space; length(hs) is t
  let t2 = dot(hs, hs);

  // `filter: blur(34px)`, in the ellipse's own units. The blur is isotropic in
  // PIXELS, so in t it is not: 34 is 0.148 of the half-width and 0.256 of the
  // half-height. Carrying the two axes separately is what makes the blurred halo
  // relatively wider than it is tall, the way the study's is.
  let hk = (u.haloBlur * gs) / max(hext, vec2<f32>(0.0001));
  let hk2 = hk * hk;
  let hq = 0.5 * (hk2.x + hk2.y);               // mean per-axis variance
  let he = GHALOBLEND * hq;
  let hInv = 1.0 / max(t2 + he, 1e-8);
  let hMix = he * hInv;                         // 1 at the centre, 0 far out

  // Split the kernel's variance into the part ALONG the radius and the part
  // ACROSS it. Along the radius the blur smooths the profile; across it, it
  // shifts the profile outward. At the centre a radius has no direction, so both
  // fall back to the mean — which is what `he` in the denominator buys.
  let sr2 = (hk2.x * hs.x * hs.x + hk2.y * hs.y * hs.y + hq * he) * hInv;
  let st2 = 2.0 * hq - sr2;

  // The shift: the cone tip becomes a dome near the centre and the ramp rides
  // out by the curvature term far from it, both as sqrt(t^2 + c * st2).
  let te = sqrt(t2 + mix(GHALOFAR, GHALONEAR, hMix) * st2);
  // The smoothing: `1 + m0 t` with the slope changing at each stop, written as a
  // sum of ramps so every corner can be rounded over GK radial sigmas. The
  // corner at GHALOS2 is the one that matters most — rounding it is how the halo
  // spreads PAST its last stop, which is what a feather can never do.
  let hw = GK * sqrt(sr2);
  let aHaloRamp = max(1.0
                      + GHALOM0 * te
                      + (GHALOM1 - GHALOM0) * gSoftRamp(te - GHALOS1, hw)
                      - GHALOM1 * gSoftRamp(te - GHALOS2, hw), 0.0);

  // CSS blurs and interpolates gradients PREMULTIPLIED, so the colour has to
  // travel with the alpha. The whole of this ramp is #D6E2F2 except for a white
  // excess near the middle — `1 - t/0.44`, itself a cone — so premultiply the mid
  // colour by the alpha, add the softened excess, and un-premultiply. This is
  // gCssMix's arithmetic rearranged; at Halo Blur = 0 it is identical.
  let wExcess = gSoftRamp(GHALOS1 - te, hw) / GHALOS1;
  let haloMid = u.haloMidColor.rgb;
  let haloPre = haloMid * aHaloRamp + (u.haloColor.rgb - haloMid) * wExcess;
  var haloRGB = haloMid;
  if (aHaloRamp > 1e-6) { haloRGB = haloPre / aHaloRamp; }
  cardCol = gOver(cardCol, haloRGB, aHaloRamp * inten);

  // ── the wash ────────────────────────────────────────────────────────────
  // `cssLinear180` over the card's own axis: the halo's colour continuing down
  // the card after the halo itself has run out. Unblurred in the study, and its
  // rect is the card, so `cuv.y` IS its gradient coordinate.
  let tw = clamp(cuv.y, 0.0, 1.0);
  var wash: vec4<f32>;
  if (tw < GWASHS1) {
    wash = gCssMix(u.washTop.rgb, GWASHA0, u.washMid.rgb, GWASHA1, tw / GWASHS1);
  } else {
    wash = gCssMix(u.washMid.rgb, GWASHA1, u.washMid.rgb, 0.0,
                   (tw - GWASHS1) / (GWASHS2 - GWASHS1));
  }
  cardCol = gOver(cardCol, wash.rgb, wash.a * u.washAmt * inten);

  // ── the foot ────────────────────────────────────────────────────────────
  // A DARKENING, so it is not multiplied by `inten` — turning the light up would
  // otherwise pump the base of the card as well as its halo. It does not follow
  // the light either; it is pinned to the card.
  let s = clamp((cuv.y - (1.0 - u.footHeight)) / max(u.footHeight, 0.0001), 0.0, 1.0);
  cardCol = gOver(cardCol, u.footColor.rgb, min(s / GFOOTMID, 1.0));

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


fn chrome(uv01: vec2<f32>) -> vec4<f32> {
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
  // footprint, so only the spill past the silhouette ever shows.
  //
  // NEGATED light, unlike Glow and Peaks. On those cards `light` is where the
  // glow LANDS and the shadow spills the same way; here it is where the light
  // IS, hanging above the card, so the shadow has to fall the other way. At the
  // default that is straight down, which is the study's `0 30px`.
  let ldirC = (u.light - vec2<f32>(0.5)) * 2.0;
  col = mfsCardShadow(col, q, halfExt, r, gs, -ldirC, u.shadowAmt,
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

  // The top hairline — the study's `inset 0 1px 0`. OUT HERE, not in `mfSrc`,
  // and on the unwarped `q`: it is a one-pixel EDGE, and a one-pixel edge is the
  // single worst thing to hand a filter that displaces its sampling. Inside
  // `mfSrc` every warped tap dragged it somewhere it does not belong — first as
  // grey lobes off the rim, then, once the band was clipped to the card, as a
  // wobble smeared along the top edge, because `mfTap` clamps taps that leave
  // the card back onto that very line. Painting it here instead means the
  // hairline is sampled exactly once, at the pixel it belongs to, and stays a
  // razor edge under every filter — the same standing the bezel has on Ember and
  // the canvas has on all eight cards.
  //
  // ONE DEPARTURE from the study, and it is deliberate: this puts the hairline
  // OVER the halo rather than under it, so the halo's bright lobe no longer
  // swallows its middle. At Rim 0.5 over a lobe that is already near-white the
  // top centre moves by a couple of levels; the top corners, where the hairline
  // actually reads, are unchanged. That is the price of it surviving a filter,
  // and it is worth paying.
  //
  // `gInsetBand` is the strip between the card's edge and the inner rect's, so
  // it is already zero outside the card and needs no mask of its own.
  let aRim = gInsetBand(q, halfExt, r, ldirC, GRIMDIST, GRIMSIGMA, GRIMSPREAD, gs)
             * u.rimAmt * max(0.0, u.intensity);
  col = gOver(col, u.rimColor.rgb, aRim);

  // Dither. A white halo dying into pure black spends most of the card in the
  // bottom two stops of an 8-bit ramp, where banding is not just visible but
  // CRAWLS once the light moves.
  let dth = (fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  return vec4<f32>(clamp(col + vec3<f32>(dth), vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
