// Sweep — a magenta light rising out of the card's lower-left corner through a
// violet field, a second lobe holding the right edge, and a dark scrim over the
// top. This is the preview half.
//
// Ported from the "Gradient Card Styles" design study (card 3d, "Magenta
// Sweep"). Its siblings — Glow, Halo, Wave and Peaks — are separate effects in
// effects/glow, effects/halo, effects/wave and effects/peaks, each with its own
// config and its own three shaders. They share nothing but the banks in
// effects/_shared.
//
// This is the ONE card in the study that was already a fragment shader
// (`MagentaSweep.metal`), so it is mostly a transcription rather than the
// collapse of a CSS stack. The layer stack around it was:
//
//   Rectangle().fill(#140518)                    // background, under the field
//   MagentaSweepField(size:)                     // the shader, over the card
//   CSSLayer(rect: 0, 0, 320, 184.8) {           // the scrim
//       linear-gradient(180deg, rgba(0,0,0,.5) 0%, rgba(0,0,0,0) 88%)
//   }
//   border-radius: 40px
//   box-shadow: 0 0 58px -10px rgba(#F032BE,.42),
//               0 34px 76px -32px rgba(#000,.9)
//
// Three things the port changes on purpose:
//
// 1. `uv` is CARD space, not view space. The study divided `position` by the
//    view's size, and that view WAS the card (320x420); here the field is the
//    card's `mfSrc`, which is handed `cuv` — 0..1 across the card — already. It
//    does mean the field is the one part of this card NOT measured in reference
//    pixels: it is parameterised in uv, so it stretches with the card exactly as
//    the original stretched with its view.
//
// 2. The `sweepTint` HSB block is gone. It served the study's `CardTint`; in
//    this catalog a palette is never baked into a shader, so each of the field's
//    five hard-coded float3s is an editable `color` param instead.
//
// 3. The dither is rekeyed and moved. `sweepHash(position * 0.71)` keys off RAW
//    DEVICE PIXELS — fine with one renderer, a lie with three. THIS file is the
//    one that would have lied: the WebGPU preview receives device pixels where
//    iOS receives points and Skia dp, so the preview's dither would have been
//    ~2x finer than either export's. Dividing by `gs` first puts it in the
//    card's reference pixels and all three agree.
//
// Two layers of the study are deliberately absent: the content overlay (a text
// layout) and the bloom layer, gated on a `bloomBoost` whose design default is 0
// and which therefore paints nothing in the reference render.
//
// sweep.metal and sweep.sksl are the other two implementations of this same
// maths. Change one, change all three.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic uniform
// packer can walk one ordering. `card`/`light` are vec2 (align 8) and the
// colours are vec4 (align 16). This card has SIX scalars where the other four
// have nine, which is the one place it differs from them structurally: six
// leaves the struct 4 bytes of implicit pad before `card` and 8 more before the
// colours. Both WGSL and `runner.ts#computeLayout` compute that padding from the
// same std140-ish rules, so it costs twelve bytes and nothing else — but do not
// "tidy" it by reordering, because the ORDER is the contract and the padding is
// not.
struct Uniforms {
  size:        vec2<f32>,
  // Unused — the card does not animate. The runner writes it either way.
  time:        f32,
  radius:      f32,
  spread:      f32,
  wobble:      f32,
  scrimAmt:    f32,
  intensity:   f32,
  // The shadow bank's strength knob. Its TINT is a colour and so sits with the
  // other vec4s below — the bank's two keys are the one pair in the catalog that
  // does not travel together in `mslArgOrder`.
  shadowAmt:   f32,
  card:        vec2<f32>,
  light:       vec2<f32>,
  bgColor:     vec4<f32>,
  coreColor:   vec4<f32>,
  midColor:    vec4<f32>,
  outerColor:  vec4<f32>,
  baseColor:   vec4<f32>,
  lobeColor:   vec4<f32>,
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

// Half the reference card, 320x420 — the size every card in this catalog is
// expressed against, and the study's native size for this one.
const GREFX: f32 = 160.0;
const GREFY: f32 = 210.0;

// The DC canvas the study was rendered on (body background #07070B).
const GCANVAS: vec3<f32> = vec3<f32>(0.02745098, 0.02745098, 0.04313725);

// ── the field, straight out of MagentaSweep.metal ────────────────────────────
// Only the GEOMETRY is baked. The five float3s the study hard-coded — core, mid,
// outer, base and the lobe — are params, so nothing in this block is a colour.

// `sweepWobble(uv, 0.045, 2.3)`: the amplitude is the `wobble` param, the
// frequency is structural and stays baked.
const GWOBBLEFR: f32 = 2.3;
// The second noise lookup's offset, so the two axes of the warp decorrelate.
const GWOBBLEOFF: vec2<f32> = vec2<f32>(4.7, 2.3);

// `rr` — the sweep's radii. The `spread` param multiplies these.
const GRR: vec2<f32> = vec2<f32>(0.68, 0.74);
// The three `smoothstep(a, b, r)` bands: core -> mid, then outer, then base.
const GRA0: f32 = 0.02;
const GRA1: f32 = 0.42;
const GRB0: f32 = 0.34;
const GRB1: f32 = 0.80;
const GRC0: f32 = 0.72;
const GRC1: f32 = 1.30;

// The second lobe: `length((p - (0.88, 0.64)) / (0.34, 0.44))`, faded in over
// 0.20..1.00 at 55% strength.
const GLOBEC: vec2<f32> = vec2<f32>(0.88, 0.64);
const GLOBERR: vec2<f32> = vec2<f32>(0.34, 0.44);
const GLOBEE0: f32 = 0.20;
const GLOBEE1: f32 = 1.00;
const GLOBEA: f32 = 0.55;

// The field's own top darkening: `col *= 1 - 0.35 * (1 - smoothstep(0, 0.52, p.y))`.
const GTOPAMT: f32 = 0.35;
const GTOPEND: f32 = 0.52;

// ── the scrim ────────────────────────────────────────────────────────────────
// `CSSLayer(rect: CGRect(0, 0, 320, 184.8))` filled with
// `cssLinear180([black .5 at 0, black 0 at .88])`. The height is in reference
// pixels; the stop is a fraction of the LAYER, not of the card.
const GSCRIMH: f32 = 184.8;
const GSCRIMEND: f32 = 0.88;

// The study's dither: `col += (sweepHash(position * 0.71) - 0.5) * 0.04`.
const GDITHERFR: f32 = 0.71;
const GDITHERAMP: f32 = 0.04;

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

/// Source-over with a straight (non-premultiplied) source.
fn gOver(dst: vec3<f32>, src: vec3<f32>, a: f32) -> vec3<f32> {
  return mix(dst, src, clamp(a, 0.0, 1.0));
}

/// `sweepHash` — the study's hash, unchanged. One function serves both the
/// domain warp's noise and the dither, exactly as it did there.
fn gHash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453123);
}

/// `sweepNoise` — smoothstep-interpolated value noise on the unit lattice.
fn gNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2<f32>(1.0, 0.0)), w.x),
             mix(gHash(i + vec2<f32>(0.0, 1.0)), gHash(i + vec2<f32>(1.0, 1.0)), w.x),
             w.y);
}

/// `sweepWobble` — the domain warp. Two noise lookups, one per axis, both
/// centred on zero so `amp = 0` is exactly the identity.
fn gWobble(uv: vec2<f32>, amp: f32, fr: f32) -> vec2<f32> {
  let a = gNoise(uv * fr) - 0.5;
  let b = gNoise(uv * fr + GWOBBLEOFF) - 0.5;
  return uv + amp * vec2<f32>(a, b);
}

// ── entry ────────────────────────────────────────────────────────────────────

/// The card's CONTENTS — the background fill, the sweep field and the scrim,
/// unclipped and unbounded, with no canvas, no shadow and no dither.
///
/// Defined outside 0..1 on purpose, and CLAMP-EXTENDED at the edge. The filter
/// bank taps this through `mfTap`, which clamps its uv to 0..1 before calling in
/// (effects/_shared/filters.wgsl) — so a blur near the rim re-reads the edge of
/// the card rather than reaching past it. Returning something sensible outside
/// 0..1 still matters: it is what keeps the maths total and branch-free, and it
/// is what the clamp falls back on. What must NOT appear here is the canvas; the
/// caller applies the card's SDF mask AFTER filtering, so the silhouette stays
/// razor sharp however hard the contents are warped.
///
/// Note what this function does NOT read: `u.size`, `u.card`, `u.radius`. The
/// other four cards measure their layers in reference pixels and need the card's
/// geometry here; the study's field is parameterised in uv, and the scrim's one
/// conversion goes through the constant reference card height.
fn mfSrc(cuv: vec2<f32>) -> vec3<f32> {
  // `cuv` is CARD space: 0..1 across the card. That is exactly what the study's
  // `position / size` produced, because its view was the card.
  let bg = u.bgColor.rgb;
  let inten = max(0.0, u.intensity);

  // ── the domain warp ──
  // Two value-noise lookups, i.e. eight hashes — the expensive part of this
  // mfSrc, and Blur / Frosted / Motion blur evaluate mfSrc seventeen times. It
  // is also the whole reason the field reads as a swept light rather than as two
  // concentric ellipses, so it stays, and everything cheaper to move out (the
  // dither) has been moved out.
  let p = gWobble(cuv, u.wobble, GWOBBLEFR);

  // ── the sweep ──
  // The centre IS the light. The study's `c = (0.30, 1.00)` is this card's
  // default `light`, so at rest the field reproduces the reference render
  // exactly, and dragging the handle walks the glow around the card instead of
  // tilting a lamp at it — which is the honest reading of this composition,
  // where the light is a place rather than a direction.
  let rr = max(GRR * u.spread, vec2<f32>(0.0001));
  let rd = length((p - u.light) / rr);
  var col = mix(u.coreColor.rgb, u.midColor.rgb, smoothstep(GRA0, GRA1, rd));
  col = mix(col, u.outerColor.rgb, smoothstep(GRB0, GRB1, rd));
  col = mix(col, u.baseColor.rgb, smoothstep(GRC0, GRC1, rd));

  // ── the second lobe ──
  // Pinned in card space, and deliberately NOT moved by `light` or scaled by
  // `spread`: it is a composition element — the counterweight on the right that
  // stops the card reading as one radial blob — not a second light.
  let rl = length((p - GLOBEC) / GLOBERR);
  col = mix(col, u.lobeColor.rgb, (1.0 - smoothstep(GLOBEE0, GLOBEE1, rl)) * GLOBEA);

  // ── the field's own top darkening ──
  // In the WARPED space, on `p.y` not `cuv.y`, so it wobbles with everything
  // else. This is the FIRST of this card's two darkenings; the scrim below is
  // the second, and the study applies both — the shader darkens its own output
  // and then a CSS layer darkens the shader. Keep both or the top of the card
  // lifts.
  col = col * (1.0 - GTOPAMT * (1.0 - smoothstep(0.0, GTOPEND, p.y)));

  // The study clamps here, before its tint. Kept.
  col = clamp(col, vec3<f32>(0.0), vec3<f32>(1.0));

  // ── intensity ──
  // The field is opaque, so the background fill beneath it never shows and
  // `bgColor` would be a param with no job. Reading `intensity` as "how far the
  // field departs from the unlit card" gives it one: 0 leaves the bare
  // background, 1 is the study exactly, 2 doubles the contrast about it. It is
  // the same role the other four cards' `intensity` plays — the strength of what
  // the light adds — said in the one form an opaque field allows.
  var cardCol = clamp(bg + (col - bg) * inten, vec3<f32>(0.0), vec3<f32>(1.0));

  // ── the scrim ──
  // Both stops are black, so the study's premultiplied stop interpolation
  // reduces to a plain alpha ramp and no `gCssMix` is needed. The alpha reaches
  // 0 at 88% of the layer, well above the layer's own bottom edge, so that hard
  // rect boundary is never visible and needs no blurred-step softening. A
  // DARKENING, so `intensity` does not touch it.
  let st = cuv.y * 2.0 * GREFY / GSCRIMH;
  let sa = u.scrimAmt * clamp(1.0 - st / GSCRIMEND, 0.0, 1.0);
  cardCol = gOver(cardCol, vec3<f32>(0.0), sa);

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


fn sweep(uv01: vec2<f32>) -> vec4<f32> {
  let res = u.size;
  let p = uv01 * res;
  let frame = gCardFrame(res);
  let halfExt = 0.5 * clamp(u.card, vec2<f32>(0.02), vec2<f32>(1.0)) * frame;
  let q = p - 0.5 * res;
  // One uniform scale for every reference-pixel distance on this card — the
  // corner radius, the shadow bank's geometry and the dither.
  let gs = max(min(halfExt.x / GREFX, halfExt.y / GREFY), 0.0001);
  let r = clamp(u.radius * gs, 0.0, min(halfExt.x, halfExt.y));

  // ── the canvas — DELIBERATELY OUTSIDE mfSrc ──
  // The filter must only touch the CARD. Warping or blurring the composite would
  // drag the distortion across the whole screen and chew the card's rounded
  // silhouette into a rectangle — the filtered image no longer knows where the
  // card ends. So: filter the card CONTENTS, then mask with the card's own SDF,
  // and leave the background alone.
  var col = GCANVAS;

  // The card's drop-glow, from the shared shadow bank. SIMPLIFICATION, stated
  // plainly: the study stacks TWO non-inset shadows here —
  // `0 0 58px -10px rgba(#F032BE,.42)` and `0 34px 76px -32px rgba(#000,.9)` —
  // and the bank paints one, at the family's baked `0 34px 70px -24px`. So the
  // geometry is the black drop's and the tint is the magenta glow's, which is
  // the one that reads on a near-black canvas; the pure black shadow under a
  // black background was never visible anyway. The bank wants a DIRECTION, so
  // the light is recentred here even though the field reads it as a position —
  // the glow then leans the way the sweep does and follows the drag handle.
  let ldirC = (u.light - vec2<f32>(0.5)) * 2.0;
  col = mfsCardShadow(col, q, halfExt, r, gs, ldirC, u.shadowAmt,
                      max(0.0, u.intensity), u.shadowColor.rgb);

  // CARD SPACE, not frame space. `cuv` runs 0..1 across the card and `cres` is
  // the card in pixels, so every filter is expressed relative to the thing it is
  // filtering: Vignette centres on the card instead of the phone, Crystal's
  // facets count across the card, and every warp stays round on the card's
  // aspect rather than the screen's.
  //
  // `ppp` rides the FITTED FRAME, for the same reason the card does. `393` is
  // the reference iPhone width in points, so a radius given in points lands the
  // same in the preview (device px), on iOS (points) and on Skia (dp).
  let cres = 2.0 * halfExt;
  let cuv = (q + halfExt) / max(cres, vec2<f32>(1.0));
  var cardCol = mfFilter(cuv, cres, u.filterId, frame.x / 393.0,
                         u.fAmount, u.fScale, u.fBlur, u.fFade, u.fSoft, u.fAngle, u.fGrain, u.fBrightness, u.fContrast, u.fSaturation, u.fRound, u.fBevel, u.fInset);

  // Dither — the study's own, `(sweepHash(position * 0.71) - 0.5) * 0.04`, with
  // the two changes the header lists. Keyed off `q / gs` (plus the half-card, so
  // the lattice lands where the study's top-left origin put it) rather than raw
  // `p`, which in THIS renderer is device pixels: keyed off `p` the preview
  // would show a ~2x finer grain than either export and the preview would lie.
  // And AFTER the filter, not inside mfSrc: it is the film over the finished
  // card, and under Blur it would be evaluated seventeen times only to be
  // smeared away.
  //
  // It rides `cardCol`, so it is clipped with the card. At +/-0.02 it is +/-5
  // levels of an 8-bit ramp — five times the 1/255 trailing dither the other
  // four cards add over the whole composite, so that one is subsumed here rather
  // than stacked on top of it.
  let dp = (q / gs + vec2<f32>(GREFX, GREFY)) * GDITHERFR;
  cardCol = clamp(cardCol + vec3<f32>((gHash(dp) - 0.5) * GDITHERAMP),
                  vec3<f32>(0.0), vec3<f32>(1.0));

  // Now clip. The mask is the card's OWN distance field, evaluated on the
  // unwarped position, so the silhouette survives any amount of distortion
  // inside it. One-pixel feather so the corner reads clean.
  let dCard = gSdRoundBox(q, halfExt, r);
  col = gOver(col, cardCol, 1.0 - smoothstep(-1.0, 1.0, dCard));

  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
