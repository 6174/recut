// Thinking Orbs — one antialiased circle per instance, drawn in the design
// sheet's own emission order with plain source-over alpha.
//
// There is no field to evaluate here and nothing to raymarch: the CPU already
// knows where all ~150 dots are (effects/thinking-orbs/sheet.ts, a verbatim
// transcription of the Claude Design sheet), so the GPU's whole job is to put a
// soft-edged disc at each one. That is six vertices and a couple of dozen fragment
// pixels per dot — a rounding error next to a full-screen fragment effect, which
// is exactly why a tile can afford to be a real render (PERFORMANCE.md).
//
// Two things here are load-bearing and easy to get wrong:
//
//  1. **Source-over, in order, never additive.** The sheet's `P3` sorts every
//     point by depth and then draws with Canvas2D's default compositing, so a
//     near dot PAINTS OVER the far one behind it. Blending these additively —
//     the tempting reading of "a ball of glowing dots" — makes the crowded limb
//     of the ball, where twenty dots stack into a few pixels, blow out to solid
//     white, and the ball stops reading as a volume. The pipeline's blend state
//     and the instance order are the whole of the 3D.
//
//  2. **The edge is a one-pixel coverage ramp, NORMALISED so the disc carries
//     the ink it should.** These discs are small — a dot is 1 to 4 px across, and
//     the far side of the ball is under a pixel — so the antialiasing IS most of
//     the picture rather than a polish on it, and the thing that has to come out
//     right is not the edge profile but the TOTAL ink each dot lays down, because
//     that is the depth cue.
//
//     A bare `clamp(r - d + 0.5, 0, 1)` gets that badly wrong at small radii: the
//     half-pixel of slack each side adds a ring of area that does not shrink with
//     the disc, so a sub-pixel dot comes out 78% too bright (measured, over four
//     sub-pixel centre offsets, in tools/_thinking-orbs-coverage-study.mjs). The whole back of the
//     ball lifts and the volume flattens — and it flattens smoothly, so it reads
//     as "a bit washed out" rather than as a bug.
//
//     `coverageScale` below is the fix: the analytic integral of that ramp,
//     divided into the disc's true area, so the ramp is rescaled to carry exactly
//     pi*r*r. It costs one reciprocal per instance and takes the ink error from
//     28% RMS to 2%. For reference, Chrome's own Canvas2D measures 12% RMS
//     against true area on the same sweep — it under-inks sub-pixel circles — so
//     this is deliberately truer than the oracle rather than bug-compatible with
//     it, which is what keeps the four platforms agreeing with each other.
//
//     A `smoothstep(r - k, r + k, d)` with k in normalised units is the other
//     tempting answer and is worse than either: it spreads the ramp in proportion
//     to each dot's size, so it dims the small far dots and fattens the big near
//     ones, and the depth cue inverts.

struct Uniforms {
  // xy: canvas size in device px. zw: the ball box's top-left, device px.
  canvasAndOrigin: vec4f,
  // x: device pixels per CSS pixel. The dot list is authored in CSS px because
  // the sheet draws through a `ctx.scale(dpr, dpr)` canvas, so every radius and
  // every gap in it is a CSS-pixel length.
  scale: vec4f,
};

// x, y, r, a — CSS-pixel centre and radius inside the ball box, and the dot's
// own alpha, already clamped to 0..1 by the sheet's cull.
// Then rgb + one pad word: the colour is resolved on the CPU, so the shader
// never has to know which of the two inks a dot asked for.
struct Dot {
  geom: vec4f,
  color: vec4f,
};

@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> dots: array<Dot>;

struct VSOut {
  @builtin(position) pos: vec4f,
  // Offset from the dot's centre, in device px — the fragment's whole input.
  @location(0) offset: vec2f,
  @location(1) radius: f32,
  @location(2) color: vec4f,
  // Constant across the instance; computed once in the vertex stage rather than
  // per fragment. See coverageScale.
  @location(3) covScale: f32,
};

/**
 * How much to rescale the one-pixel coverage ramp so a disc of this radius lays
 * down exactly pi*r*r of ink.
 *
 * The ramp runs from full coverage at `d = r - 0.5` to none at `d = r + 0.5`.
 * Integrating it over the plane in polar coordinates gives, with a = r - 0.5 and
 * b = r + 0.5:
 *
 *   r >= 0.5   I/pi = a^2 * (0.5 - r) + (b^3 + 2a^3) / 3
 *   r <  0.5   I/pi = b^3 / 3            (no saturated core to add)
 *
 * so `r*r / (I/pi)` is the factor that turns the ramp's ink into the disc's own.
 * Both branches are evaluated and selected between rather than branched on: this
 * runs once per instance, and a `select` keeps the basic block intact.
 */
fn coverageScale(r: f32) -> f32 {
  let a = r - 0.5;
  let b = r + 0.5;
  let core = a * a * (0.5 - r) + (b * b * b + 2.0 * a * a * a) / 3.0;
  let sub = (b * b * b) / 3.0;
  let integral = select(core, sub, r < 0.5);
  return (r * r) / max(integral, 1e-6);
}

@vertex
fn orb_vertex(
  @builtin(vertex_index) vi: u32,
  @builtin(instance_index) ii: u32,
) -> VSOut {
  let d = dots[ii];
  let canvas = U.canvasAndOrigin.xy;
  let origin = U.canvasAndOrigin.zw;
  let dpr = U.scale.x;

  let centre = origin + d.geom.xy * dpr;
  let radius = d.geom.z * dpr;
  // One pixel of slack each side so the coverage ramp is never clipped by the
  // quad it lives in.
  let half = radius + 1.0;

  // Two triangles as a 6-vertex strip-in-a-list: (-1,-1) (1,-1) (-1,1) / (-1,1) (1,-1) (1,1).
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let offset = corners[vi] * half;
  let device = centre + offset;

  var out: VSOut;
  // Device px -> clip space. y flips: the sheet's y grows downward, like every
  // 2D canvas, and clip space's does not.
  out.pos = vec4f(
    (device.x / canvas.x) * 2.0 - 1.0,
    1.0 - (device.y / canvas.y) * 2.0,
    0.0,
    1.0,
  );
  out.offset = offset;
  out.radius = radius;
  // The dot's alpha rides in `geom.w`, not in the colour's alpha channel: the
  // colour is one of two inks the CPU already chose between, while the alpha is
  // per-dot depth. Keeping them in separate words is what lets the colour pair
  // be uploaded as-is rather than re-multiplied per dot.
  out.color = vec4f(d.color.rgb, d.geom.w);
  out.covScale = coverageScale(radius);
  return out;
}

@fragment
fn orb_fragment(in: VSOut) -> @location(0) vec4f {
  let dist = length(in.offset);
  let coverage = min(1.0, clamp(in.radius - dist + 0.5, 0.0, 1.0) * in.covScale);
  let a = coverage * in.color.a;
  // Premultiplied — the pipeline blends with `one, one-minus-src-alpha`, which
  // is source-over for premultiplied colour and is what keeps a stack of
  // half-transparent dots resolving the way Canvas2D resolves it.
  return vec4f(in.color.rgb * a, a);
}
