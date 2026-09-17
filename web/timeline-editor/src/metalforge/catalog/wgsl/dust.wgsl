// MetalForge — Dust (kind:"dust"). Live WebGPU half of the effect.
//
// A transcription of the "Dust Shapes" Claude Design sheet, which draws its two
// scenes as thousands of short round-capped strokes in Canvas2D with
// `globalCompositeOperation = 'lighter'`. One dash = one instance of a 6-vertex
// quad; the quad is oriented along the dash and grown by its stroke radius at
// both ends so the fragment can carve a capsule out of it. Keep in lockstep
// with dust.metal — same constants, same branch indices, same tier table.
//
// TWO passes, because Canvas2D's batching is not additive within a tier. The
// sheet collects every dash into one of three `Path2D`s and strokes each ONCE,
// and stroking a path with 2,000 overlapping subpaths fills their UNION — two
// dashes on top of each other in the same tier are as bright as one. Summing
// them instead would blow out exactly the places the effect is about: the poles
// of an Onion shell, where a hundred dashes crowd into a few pixels, and the
// left and right limbs of a Twist ring, where the projection packs them.
//
// So pass 1 draws every dash into an off-screen RGBA target with MAX blending,
// one tier per channel — the union, resolved once for all three tiers in a
// single geometry pass. Pass 2 composites `0.16·R + 0.42·G + 0.92·B` over the
// background, which is the sheet's three successive `'lighter'` strokes, then
// the glow and the vignette.
//
//   pass 1  dash_vertex/dash_fragment        → tier coverage, MAX
//   pass 2  full_vertex/composite_fragment   → the dust,      additive
//           full_vertex/glow_fragment        → `_glow`,       additive (Onion)
//           full_vertex/vig_fragment         → `_vig`,        source-over

struct Uniforms {
  viewport   : vec2<f32>,  // device px
  center     : vec2<f32>,  // CSS px — A.cx, A.cy
  radius     : f32,        // CSS px — R
  phase      : f32,        // ph
  squash     : f32,        // sq
  twistK     : f32,        // the `f * 7` coefficient in Twist's `tw`
  rings      : u32,
  shells     : u32,
  segments   : u32,
  style      : u32,        // 0 = Twist, 1 = Onion
  dashScale  : f32,
  brightness : f32,
  glowAmt    : f32,
  vignetteAmt: f32,
  dpr        : f32,
  _pad0      : f32,
  _pad1      : f32,
  _pad2      : f32,
  dustColor  : vec4<f32>,
  glowColor  : vec4<f32>,
  vigColor   : vec4<f32>,
  bgColor    : vec4<f32>,
};

@group(0) @binding(0) var<uniform> U: Uniforms;
// (u, v, g, 0) per particle — `_seed(3600)`. Sequential generator, so it is
// built once on the CPU and read by index rather than hashed in the shader.
@group(0) @binding(1) var<storage, read> P: array<vec4<f32>>;
// Pass 1's target, read by pass 2. Its own group so it is simply not bound
// while it is the render target.
@group(1) @binding(0) var tiers: texture_2d<f32>;

const TAU = 6.283185307179586;
const PI  = 3.141592653589793;
const TABLE_LEN = 3600u;

// `AL` / `WD`. The dash's computed alpha only PICKS a tier; what is stroked is
// the tier's own alpha and width. This quantisation is the look.
const TIER_A = array<f32, 3>(0.16, 0.42, 0.92);
const TIER_W = array<f32, 3>(0.65, 0.95, 1.4);

const kQuad = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
  vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
);

struct DashOut {
  @builtin(position) position : vec4<f32>,
  @location(0)                   local  : vec2<f32>,
  @location(1) @interpolate(flat) segLen : f32,
  @location(2) @interpolate(flat) halfW  : f32,
  // Which tier's channel this dash writes into: (1,0,0), (0,1,0) or (0,0,1).
  @location(3) @interpolate(flat) chan   : vec3<f32>,
};

/** A dash that was culled or lies off screen: collapse it out of the clip volume. */
fn dropped() -> DashOut {
  var o: DashOut;
  o.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
  o.local = vec2<f32>(0.0, 0.0);
  o.segLen = 0.0;
  o.halfW = 0.0;
  o.chan = vec3<f32>(0.0, 0.0, 0.0);
  return o;
}

@vertex
fn dash_vertex(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> DashOut {
  let seg = max(U.segments, 1u);
  let rings = max(U.rings, 2u);
  let ph = U.phase;
  let cssW = U.viewport.x / U.dpr;
  let cssH = U.viewport.y / U.dpr;

  var pos: vec2<f32>;   // CSS px
  var dvec: vec2<f32>;  // CSS px
  var al: f32;

  if (U.style == 0u) {
    // ── Twist ──────────────────────────────────────────────────────────────
    // `_stack(A, { J: 46, seg: 130, k: 9, ws: 2, sq: 0.25, prof: … })`
    let j = iid / seg;
    let k = iid % seg;
    if (j >= rings) { return dropped(); }

    let f = f32(j) / f32(rings - 1u);
    // prof: r = R * (0.95 + 0.35 * sin(f * 5 - ph)), y = h*0.06 + f*h*0.88
    let r = U.radius * (0.95 + 0.35 * sin(f * 5.0 - ph));
    if (r <= 0.5) { return dropped(); }
    let ry = cssH * 0.06 + f * cssH * 0.88;
    let tw = f * U.twistK + ph;

    let band = 0.5 + 0.5 * sin(f * 9.0 - ph * 2.0);
    let amp = 0.35 + 0.85 * band;

    let p = P[(j * seg + k * 7u + j) % TABLE_LEN];
    // `o.spin` is undefined on this call, so the `ph * (o.spin || 0)` term is 0.
    let a = (f32(k) / f32(seg)) * TAU + tw;
    let rr = r * (1.0 + (p.x - 0.5) * 0.05);
    let sa = sin(a);
    let ca = cos(a);

    pos = vec2<f32>(U.center.x + ca * rr, ry + sa * rr * U.squash + (p.y - 0.5) * 3.2);
    // The sheet's own off-screen cull, kept: it is the cheap half of the budget.
    if (pos.x < -30.0 || pos.x > cssW + 30.0 || pos.y < -30.0 || pos.y > cssH + 30.0) {
      return dropped();
    }
    let front = 0.4 + 0.6 * (0.5 + 0.5 * sa);
    al = (0.06 + 0.9 * p.z) * front * amp;
    let len = (1.1 + 2.6 * p.y) * U.dashScale;
    dvec = vec2<f32>(-sa * len, ca * len * (U.squash + 0.35));
  } else {
    // ── Onion ──────────────────────────────────────────────────────────────
    // The sheet writes this one inline rather than through `_stack`, and it
    // reads only `p.g`: the dash vector is fixed, not length-randomised.
    let k = iid % seg;
    let rest = iid / seg;
    let j = rest % rings;
    let sh = rest / rings;
    if (sh >= max(U.shells, 1u)) { return dropped(); }

    let shf = f32(sh);
    let pulse = 1.0 + 0.12 * sin(ph * 2.0 - shf * 1.1);
    let RS = U.radius * (0.42 + 0.33 * shf) * pulse;
    let th = ((f32(j) + 0.5) / f32(rings)) * PI;
    let rr = sin(th) * RS;
    let yy = -cos(th) * RS;

    // The index literals (1500, 100, 3) are the sheet's, not derived from the
    // ring or segment counts — transcribed rather than generalised.
    let p = P[(sh * 1500u + j * 100u + k * 3u) % TABLE_LEN];
    let a = (f32(k) / f32(seg)) * TAU + ph * (1.0 + shf);
    let sa = sin(a);
    let ca = cos(a);

    pos = vec2<f32>(U.center.x + ca * rr, U.center.y + yy * 0.92 + sa * rr * U.squash);
    let front = 0.4 + 0.6 * (0.5 + 0.5 * sa);
    al = (0.05 + 0.8 * p.z) * front * (1.0 - shf * 0.13);
    dvec = vec2<f32>(-sa * 2.2, ca * 0.8) * U.dashScale;
  }

  al = al * U.brightness;
  if (al < 0.05) { return dropped(); }           // `_add`'s cull
  var tier = 0;
  if (al > 0.62) { tier = 2; } else if (al > 0.28) { tier = 1; }

  // Everything becomes device pixels here — the sheet's
  // `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`, which scales stroke widths too.
  let A = pos * U.dpr;
  let D = dvec * U.dpr;
  let halfW = TIER_W[tier] * 0.5 * U.dpr;

  let ln = length(D);
  var tan = vec2<f32>(1.0, 0.0);
  if (ln > 1e-5) { tan = D / ln; }
  let nrm = vec2<f32>(-tan.y, tan.x);

  // The quad has to be the capsule PLUS its antialiased fringe: `coverage()`
  // is still non-zero out to halfW + 0.5, so a quad grown by only halfW clips
  // the soft edge off every dash — which is most of a sub-pixel stroke's light.
  let pad = halfW + 1.0;
  let q = kQuad[vid];
  let s = (q.x * 0.5 + 0.5) * (ln + 2.0 * pad) - pad;
  let v = q.y * pad;
  let px = A + tan * s + nrm * v;

  var o: DashOut;
  o.position = vec4<f32>(
    px.x / U.viewport.x * 2.0 - 1.0,
    1.0 - px.y / U.viewport.y * 2.0,
    0.0,
    1.0,
  );
  o.local = vec2<f32>(s, v);
  o.segLen = ln;
  o.halfW = halfW;
  o.chan = vec3<f32>(f32(tier == 0), f32(tier == 1), f32(tier == 2));
  return o;
}

/**
 * Analytic capsule coverage.
 *
 * A tier-0 stroke is 0.65 device px wide at dpr 1 — narrower than a pixel — so
 * the antialiasing is not a nicety, it IS the brightness: a naive
 * `smoothstep`-to-1 mask would make every thin dash a full-intensity one and
 * the frame would blow out under additive blending. This is the exact covered
 * width of a strip of half-width `halfW` at distance `dist` from a pixel
 * centre, which is what Canvas2D's rasteriser computes.
 */
fn coverage(dist: f32, halfW: f32) -> f32 {
  return clamp(dist + halfW, -0.5, 0.5) - clamp(dist - halfW, -0.5, 0.5);
}

/**
 * Coverage into this dash's own tier channel. The blend state is MAX, so a
 * channel ends the pass holding the union of every dash in that tier — the
 * sheet's one-stroke-per-Path2D, resolved for all three tiers at once.
 */
@fragment
fn dash_fragment(in: DashOut) -> @location(0) vec4<f32> {
  let across = coverage(abs(in.local.y), in.halfW);
  // The cap, area-matched. Separating the two axes makes the round cap square,
  // which carries 4/π of the ink it should — and a dash is 1–4 px long, so its
  // two caps are a THIRD of it, not a rounding error. A square cap of half-extent
  // (π/4)·halfW has exactly the round cap's area, so the whole capsule integrates
  // to 2·halfW·segLen + π·halfW², which is the real thing.
  let capH = in.halfW * 0.7853981634;
  let e = min(in.local.x + capH, in.segLen + capH - in.local.x);
  let along = clamp(e + 0.5, 0.0, 1.0);
  let cov = across * along;
  return vec4<f32>(in.chan * cov, 0.0);
}

// ── The two full-screen composites ────────────────────────────────────────────

struct FullOut {
  @builtin(position) position : vec4<f32>,
};

@vertex
fn full_vertex(@builtin(vertex_index) vid: u32) -> FullOut {
  var o: FullOut;
  let x = f32(i32(vid) / 2) * 4.0 - 1.0;
  let y = f32(i32(vid) & 1) * 4.0 - 1.0;
  o.position = vec4<f32>(x, y, 0.0, 1.0);
  return o;
}

/**
 * The sheet's `_flush`: three `ctx.stroke()` calls at the three tier alphas,
 * one after another with `'lighter'`. Three successive adds of the same colour
 * is one add of their sum, so the whole flush is this single line.
 */
@fragment
fn composite_fragment(in: FullOut) -> @location(0) vec4<f32> {
  let c = textureLoad(tiers, vec2<i32>(in.position.xy), 0);
  let a = TIER_A[0] * c.r + TIER_A[1] * c.g + TIER_A[2] * c.b;
  return vec4<f32>(U.dustColor.rgb * a, a);   // premultiplied; the blend state adds it
}

/** `_glow(ctx, A.cx, A.cy, R * 0.4, 0.5)` — stops at 0 → a, 0.3 → a*0.3, 1 → 0. */
@fragment
fn glow_fragment(in: FullOut) -> @location(0) vec4<f32> {
  let p = in.position.xy / U.dpr;
  let r = max(U.radius * 0.4, 1e-4);
  let q = distance(p, U.center) / r;
  var a = 0.0;
  if (q < 0.3) {
    a = mix(U.glowAmt, U.glowAmt * 0.3, q / 0.3);
  } else if (q < 1.0) {
    a = mix(U.glowAmt * 0.3, 0.0, (q - 0.3) / 0.7);
  }
  return vec4<f32>(U.glowColor.rgb * a, a);
}

/** `_vig` — a radial ramp from `d*0.3` (clear) to `d*0.66` (0.5 black), then flat. */
@fragment
fn vig_fragment(in: FullOut) -> @location(0) vec4<f32> {
  let css = U.viewport / U.dpr;
  let p = in.position.xy / U.dpr;
  let d = length(css);
  let a = U.vignetteAmt * clamp((distance(p, U.center) - d * 0.3) / (d * 0.36), 0.0, 1.0);
  return vec4<f32>(U.vigColor.rgb * a, a);
}
