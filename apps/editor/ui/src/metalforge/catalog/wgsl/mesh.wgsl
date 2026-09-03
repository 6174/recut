// mesh.wgsl — WebGPU preview of the kind:"meshgradient" effect.
//
// The one effect that usually has no .metal counterpart: the export is native
// SwiftUI `MeshGradient` (iOS 18+). So this shader isn't mirroring MSL, it is
// approximating Apple's renderer — a grid of control points warping a
// tessellated patch, colours carried on the points. (The three shader-only
// filters in the post pass below are the exception; those DO mirror mesh.metal.)
//
// MeshSim (effects/mesh/preview.ts) owns the whole frame: it resolves the
// animated grid on the CPU (so the drift math has exactly ONE implementation,
// in effects/mesh/mesh.ts) and uploads it here. This shader only interpolates.
//
// Interpolation is clamped Catmull-Rom in both axes — C1-continuous, and it
// reproduces the boundary exactly (the surface at v=0 IS the top row's curve),
// which is what keeps the mesh flush to the frame with no seam. Colours use the
// same spline when `smooth` is on (SwiftUI's `smoothsColors: true`) and plain
// bilinear when it's off.

const SEG: u32 = 72u; // tessellation segments per axis — must match SEGMENTS in mesh.ts
const MAXP: u32 = 16u;

struct Uniforms {
  pts: array<vec4<f32>, 16>,  // xy = animated position, unit space, y DOWN
  cols: array<vec4<f32>, 16>, // rgb = colour
  dims: vec4<f32>,            // x = cols, y = rows, z = hue radians, w = smooth (0/1)
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec3<f32>,
};

fn cr(p0: vec4<f32>, p1: vec4<f32>, p2: vec4<f32>, p3: vec4<f32>, t: f32) -> vec4<f32> {
  let t2 = t * t;
  let t3 = t2 * t;
  return 0.5 * ((2.0 * p1)
    + (-p0 + p2) * t
    + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
    + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3);
}

fn slot(r: i32, c: i32) -> u32 {
  let rows = i32(u.dims.y);
  let cols = i32(u.dims.x);
  let rr = clamp(r, 0, rows - 1);
  let cc = clamp(c, 0, cols - 1);
  return min(u32(rr * cols + cc), MAXP - 1u);
}

fn pointAt(r: i32, c: i32) -> vec4<f32> {
  return vec4<f32>(u.pts[slot(r, c)].xy, 0.0, 0.0);
}

fn colorAt(r: i32, c: i32) -> vec4<f32> {
  return vec4<f32>(u.cols[slot(r, c)].rgb, 0.0);
}

/// Luminance-preserving hue rotation — the standard SVG/CSS matrix, which is
/// what SwiftUI's `.hueRotation` reads as on screen.
fn hueRotate(c: vec3<f32>, a: f32) -> vec3<f32> {
  if (abs(a) < 1e-6) { return c; }
  let cs = cos(a);
  let sn = sin(a);
  let r = dot(c, vec3<f32>(0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928));
  let g = dot(c, vec3<f32>(0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.140, 0.072 - cs * 0.072 - sn * 0.283));
  let b = dot(c, vec3<f32>(0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072));
  return clamp(vec3<f32>(r, g, b), vec3<f32>(0.0), vec3<f32>(1.0));
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VOut {
  // Two triangles per cell of a SEG x SEG tessellation of the unit square.
  // No vertex buffer — the (u,v) comes straight from the vertex index, and
  // shared edges land on identical values so there are no seams.
  let quad = vi / 6u;
  let k = vi % 6u;
  let qx = quad % SEG;
  let qy = quad / SEG;

  var fx: u32 = 0u;
  var fy: u32 = 0u;
  if (k == 1u) { fx = 1u; fy = 0u; }
  else if (k == 2u) { fx = 0u; fy = 1u; }
  else if (k == 3u) { fx = 1u; fy = 0u; }
  else if (k == 4u) { fx = 1u; fy = 1u; }
  else if (k == 5u) { fx = 0u; fy = 1u; }

  let uu = f32(qx + fx) / f32(SEG);
  let vv = f32(qy + fy) / f32(SEG);

  let cols = i32(u.dims.x);
  let rows = i32(u.dims.y);

  // Locate the cell and the local parameter within it.
  let fu = uu * f32(cols - 1);
  let fv = vv * f32(rows - 1);
  let ci = clamp(i32(floor(fu)), 0, cols - 2);
  let ri = clamp(i32(floor(fv)), 0, rows - 2);
  let tu = clamp(fu - f32(ci), 0.0, 1.0);
  let tv = clamp(fv - f32(ri), 0.0, 1.0);

  // Position — bicubic over the 4x4 neighbourhood (clamped at the boundary).
  var rowsP = array<vec4<f32>, 4>();
  for (var j = 0; j < 4; j = j + 1) {
    let rr = ri - 1 + j;
    rowsP[j] = cr(pointAt(rr, ci - 1), pointAt(rr, ci), pointAt(rr, ci + 1), pointAt(rr, ci + 2), tu);
  }
  let p = cr(rowsP[0], rowsP[1], rowsP[2], rowsP[3], tv).xy;

  // Colour — the same spline when smoothing, bilinear over the cell when not.
  var col: vec3<f32>;
  if (u.dims.w > 0.5) {
    var rowsC = array<vec4<f32>, 4>();
    for (var j = 0; j < 4; j = j + 1) {
      let rr = ri - 1 + j;
      rowsC[j] = cr(colorAt(rr, ci - 1), colorAt(rr, ci), colorAt(rr, ci + 1), colorAt(rr, ci + 2), tu);
    }
    col = clamp(cr(rowsC[0], rowsC[1], rowsC[2], rowsC[3], tv).rgb, vec3<f32>(0.0), vec3<f32>(1.0));
  } else {
    let top = mix(colorAt(ri, ci).rgb, colorAt(ri, ci + 1).rgb, tu);
    let bot = mix(colorAt(ri + 1, ci).rgb, colorAt(ri + 1, ci + 1).rgb, tu);
    col = mix(top, bot, tv);
  }

  var o: VOut;
  // Unit space is y-down; clip space is y-up.
  o.pos = vec4<f32>(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
  o.color = hueRotate(col, u.dims.z);
  return o;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  return vec4<f32>(in.color, 1.0);
}

// ---------------------------------------------------------------------------
// Post pass — one filter over the finished gradient.
//
// The mesh above renders into an offscreen texture; this full-screen pass reads
// it back and applies the selected filter, then presents. Filter indices match
// the FILTERS table order in mesh.ts. The six non-shader filters here are
// deliberately the same maths SwiftUI's view modifiers perform, so the preview
// and the exported `.blur` / `.contrast` agree; the eight after them mirror the
// companion mesh.metal instead.

struct Post {
  cfg: vec4<f32>,  // x = filter index, y = param a, z = param b, w = points→pixels
  dim: vec4<f32>,  // xy = resolution in px, zw = 1/resolution
  bg: vec4<f32>,   // background rgb (what a clipped corner reveals)
  cfg2: vec4<f32>, // x,y,z,w = knobs 3-6 (Fluted's rotation; Blocks' set)
};

@group(0) @binding(0) var<uniform> post: Post;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct POut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_post(@builtin(vertex_index) vi: u32) -> POut {
  // Full-screen triangle.
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(-1.0, 1.0), vec2<f32>(3.0, 1.0));
  var o: POut;
  let xy = p[vi];
  o.pos = vec4<f32>(xy, 0.0, 1.0);
  o.uv = vec2<f32>((xy.x + 1.0) * 0.5, (1.0 - xy.y) * 0.5);
  return o;
}

fn tap(uv: vec2<f32>) -> vec3<f32> {
  return textureSampleLevel(src, samp, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).rgb;
}

/// 17-tap two-ring disc blur. Cheap, and at these radii indistinguishable from
/// the Gaussian `.blur(radius:)` applies.
fn blurAt(uv: vec2<f32>, radiusPx: f32) -> vec3<f32> {
  if (radiusPx < 0.35) { return tap(uv); }
  let step = post.dim.zw * radiusPx;
  var sum = tap(uv) * 0.18;
  var wsum = 0.18;
  for (var i = 0; i < 8; i = i + 1) {
    let a = (f32(i) / 8.0) * 6.2831853;
    let d = vec2<f32>(cos(a), sin(a));
    sum = sum + tap(uv + d * step * 0.55) * 0.075;
    sum = sum + tap(uv + d * step) * 0.0275;
    wsum = wsum + 0.1025;
  }
  return sum / wsum;
}

fn luma(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// Film grain, ported verbatim from the Grain effect (effects/grain/grain.wgsl)
// so the two read identically: a wrapped product of the uv, landing in
// [-0.005, 0.005] before `grain` scales it. Unit-space rather than pixel-space,
// which is what keeps the density the same on the canvas and on the phone.
fn filmGrain(uv: vec2<f32>) -> f32 {
  let x = (uv.x + 4.0) * (uv.y + 4.0) * 10.0;
  return (((x % 13.0) + 1.0) * ((x % 123.0) + 1.0)) % 0.01 - 0.005;
}

fn hash21(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

/// Signed distance to a rounded rectangle — negative inside. One glass block.
fn sdRoundBox(p: vec2<f32>, ext: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - ext + vec2<f32>(r);
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

/// Smooth value noise in [0,1] — the texture behind frosted glass.
fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash21(i + vec2<f32>(0.0, 1.0)), hash21(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y,
  );
}

/// The frame's aspect, so a round distortion stays round on a tall phone
/// instead of stretching into an ellipse.
fn aspect(res: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(res.x / max(res.y, 1.0), 1.0);
}

// --- Film (Mesh01) helpers -------------------------------------------------
// Gradient noise, NOT the value-noise `vnoise` above: Film ports the Mesh01
// study app's field verbatim, and its character comes from gradient noise.
// Kept in lockstep with mesh.metal and mesh.sksl.

fn hash22(p: vec2<f32>) -> vec2<f32> {
  let q = vec2<f32>(dot(p, vec2<f32>(127.1, 311.7)), dot(p, vec2<f32>(269.5, 183.3)));
  return fract(sin(q) * 43758.5453) * 2.0 - 1.0;
}

fn gnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u2 = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dot(hash22(i), f),
        dot(hash22(i + vec2<f32>(1.0, 0.0)), f - vec2<f32>(1.0, 0.0)), u2.x),
    mix(dot(hash22(i + vec2<f32>(0.0, 1.0)), f - vec2<f32>(0.0, 1.0)),
        dot(hash22(i + vec2<f32>(1.0, 1.0)), f - vec2<f32>(1.0, 1.0)), u2.x),
    u2.y,
  );
}

/// Mesh01's fbm: 3 octaves, amplitude 0.6, lacunarity 2.1, gain 0.42.
fn fbm3(p0: vec2<f32>) -> f32 {
  var p = p0;
  var amp = 0.6;
  var s = 0.0;
  for (var i = 0; i < 3; i = i + 1) {
    s = s + amp * gnoise(p);
    p = p * 2.1;
    amp = amp * 0.42;
  }
  return s;
}

@fragment
fn fs_post(in: POut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let mode = i32(post.cfg.x + 0.5);
  let a = post.cfg.y;
  let b = post.cfg.z;
  let ppp = post.cfg.w;      // points → pixels
  let res = post.dim.xy;
  var col = tap(uv);

  if (mode == 1) {                                   // Blur
    col = blurAt(uv, a * ppp);
  } else if (mode == 2) {                            // Fade blur
    // Blur ramps in over the lower part of the frame, like a masked blur layer.
    let m = smoothstep(clamp(1.0 - b, 0.0, 0.999), 1.0, uv.y);
    col = mix(col, blurAt(uv, a * ppp), m);
  } else if (mode == 3) {                            // Vignette
    // Linear ramp between two radii, matching the RadialGradient the export
    // overlays (SwiftUI interpolates gradient stops linearly, not smoothly).
    let half = length(res) * 0.5;                    // 1.0 = the corner
    let r = length((uv - vec2<f32>(0.5)) * res) / max(half, 1.0);
    let inner = mix(0.95, 0.15, clamp(b, 0.0, 1.0));
    let k = clamp((r - inner) / max(1.05 - inner, 0.001), 0.0, 1.0);
    col = col * (1.0 - clamp(a, 0.0, 1.0) * k);
  } else if (mode == 4) {                            // Brightness
    col = clamp(col + vec3<f32>(a), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (mode == 5) {                            // Contrast
    col = clamp((col - vec3<f32>(0.5)) * a + vec3<f32>(0.5), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (mode == 6) {                            // Saturation
    col = clamp(mix(vec3<f32>(luma(col)), col, a), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (mode == 7) {                            // Grain
    col = clamp(col + vec3<f32>(filmGrain(uv) * a), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (mode == 8) {                            // Glass
    let s = max(b, 0.5);
    let w = vec2<f32>(
      sin(uv.y * s * 6.2831853 + 1.3) + 0.5 * sin(uv.y * s * 12.9 + 0.7),
      cos(uv.x * s * 6.2831853 + 2.1) + 0.5 * cos(uv.x * s * 11.3 + 1.9),
    );
    col = tap(uv + w * a * 0.02);
  } else if (mode == 9) {                            // Crystal
    // Diced glass: hard-edged facets, each offsetting what it shows and
    // catching the light a little differently.
    let asp = aspect(res);
    let cell = floor(uv * asp * max(b, 1.0));
    let h1 = hash21(cell);
    let h2 = hash21(cell + vec2<f32>(37.0, 17.0));
    let off = (vec2<f32>(h1, h2) - vec2<f32>(0.5)) * a * 0.06 / asp;
    col = clamp(tap(uv + off) * (1.0 + (h1 - 0.5) * a * 0.35), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (mode == 10) {                           // Frosted
    // Obscure glass: a soft noise displacement first, then the blur — the
    // scatter is what separates it from a plain blur.
    let asp = aspect(res);
    let p = uv * asp * 42.0;
    let n = vec2<f32>(vnoise(p), vnoise(p + vec2<f32>(7.3, 2.1))) - vec2<f32>(0.5);
    col = blurAt(uv + n * a * 0.05 / asp, b * ppp);
  } else if (mode == 11) {                           // Fluted
    // Reeded glass: vertical half-cylinders side by side. Each one squeezes the
    // strip behind it toward its own centre line, which is what breaks a
    // diagonal edge into the stair step this glass is known for.
    //
    // Nothing darkens the joins. A reeded pane is one continuous sheet — there
    // is no gap between flutes and no lead came, so a dark line there reads as
    // a window frame instead of as glass. What separates one flute from the
    // next is only the jump in what it shows, plus the soft sheen each cylinder
    // carries: broad, off-centre, and the one thing still visible where the
    // frame goes black.
    // The reeds run at whatever angle Rotation asks for. `t` is the coordinate
    // ACROSS them; normalising it by the frame's width along that direction is
    // what keeps Scale meaning "flutes across the frame" at every angle —
    // without it the reeds would crowd together as a tall frame turns sideways.
    // At 0° that reduces to uv.x exactly, at 90° to uv.y, so Ribbed is just this
    // filter turned a quarter-turn and shares its shader.
    let asp = aspect(res);
    let th = radians(post.cfg2.x);
    let dir = vec2<f32>(cos(th), sin(th));
    let q = (uv - vec2<f32>(0.5)) * asp;
    let span = max(abs(dir.x) * asp.x + abs(dir.y) * asp.y, 0.0001);
    let t = dot(q, dir) / span + 0.5;
    let n = max(b, 1.0) * 2.0;                       // flutes across the frame
    let centre = (floor(t * n) + 0.5) / n;
    let f = (t - centre) * n;                        // -0.5..0.5 within the flute
    // A cylinder doesn't squeeze evenly: the ray hits the crown head-on and the
    // rim at a glancing angle, so the outer part of each flute pinches far
    // harder than the middle. That falloff is the difference between glass and
    // a row of stripes.
    let e = abs(f) * 2.0;                            // 0 crown, 1 rim
    let k = (1.0 - clamp(a, 0.0, 1.0)) * (1.0 - 0.65 * e * e);
    let shift = (centre + (t - centre) * k - t) * span;
    let c = tap((q + dir * shift) / asp + vec2<f32>(0.5));
    let s = (f + 0.18) * 3.2;
    col = clamp(c + vec3<f32>(0.09 * a * exp(-s * s)), vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (mode == 12) {                           // Blocks
    // A wall of glass blocks covering the whole frame, laid edge to edge. There
    // is no mortar and nothing is drawn between them: the blocks are told apart
    // purely by what the glass does, which is the only way this reads as one
    // sheet of glass rather than as a grid painted over the picture.
    //
    // What separates one pane from the next is refraction and nothing else:
    //
    //  - REFRACTION. Each block is a lens: it squeezes what's behind it toward
    //    its own centre, so the picture arrives quantised — a mosaic of small
    //    self-contained gradients with a hard step at every joint. (The same
    //    compression Fluted does along one axis, here in two.)
    //  - THE BEVEL. The shoulder bends hardest at the rim and not at all through
    //    the middle, so each pane has flat glass in it and a rolled edge.
    //
    // Six knobs, because a piece of glass is a physical object and every one of
    // these is a property of it: how strongly it refracts, how many panes, how
    // far each is inset, how rounded, how wide the bevel, how obscure the glass.
    // See FILTERS in mesh.ts for which uniform each arrives in.
    let asp = aspect(res);
    // Whole panes only. Scale counts them per axis: 1 is a single sheet of glass
    // over the frame, 2 is four. A fractional count would slice a part-block off
    // at the edges, which is the one thing that stops a glass wall reading as
    // real glass.
    // Scale is panes ACROSS; the row count follows from the aspect so the cells
    // come out square. That's what lets square panes tile the whole frame with
    // nothing left over — a square pane in a tall cell can only ever leave a
    // band above and below it.
    let nx = max(round(b), 1.0);
    let ny = max(round(nx / max(asp.x, 0.0001)), 1.0);
    let cnt = vec2<f32>(nx, ny);
    // The GRID is not aspect-corrected — n panes per axis means exactly that, so
    // a 2 gives four rectangles filling the frame. (Correcting the grid instead
    // was the bug that produced one giant rounded shape on a tall phone: at
    // asp.x ≈ 0.46 the frame held less than one cell across.) The aspect goes on
    // the pane's LOCAL coordinates below, where it belongs — that's what keeps
    // the inset even on all four sides and the corners circular.
    let bs = uv * cnt;
    let cell = floor(bs);
    let f = fract(bs) - vec2<f32>(0.5);
    let ca = vec2<f32>(asp.x * ny / nx, 1.0);        // cell width : height (~1)
    // Inset shrinks each pane inside its cell. At 0 they touch edge to edge and
    // the wall is continuous; open it up and the untouched gradient shows around
    // each rectangle, which is how you see that it IS a rectangle.
    let inset = clamp(post.cfg2.w, 0.0, 0.45);
    // Square, not cell-shaped: the half-side is the SHORTER of the cell's two
    // half-sides, so the pane stays a square however tall the frame is. (Taking
    // the cell's own proportions instead gave a tall slab on a phone.)
    let half = max(min(0.5 * ca.x, 0.5) - inset, 0.02);
    let ext = vec2<f32>(half);
    let rad = clamp(post.cfg2.x, 0.0, 1.0) * min(ext.x, ext.y);
    let fp = f * ca;                                 // local, physical units
    let sd = sdRoundBox(fp, ext, rad);
    // Outward normal, by central difference on the same distance field.
    let st = vec2<f32>(0.004, 0.0);
    let grad = vec2<f32>(
      sdRoundBox(fp + st.xy, ext, rad) - sdRoundBox(fp - st.xy, ext, rad),
      sdRoundBox(fp + st.yx, ext, rad) - sdRoundBox(fp - st.yx, ext, rad),
    );
    let nrm = grad / max(length(grad), 0.0001);
    // Bevel is a FRACTION of the pane's short half-side, not an absolute
    // distance: on a tall thin pane an absolute band never reaches the middle,
    // so the whole rectangle stays shoulder and there's no flat glass to look
    // through.
    let band = max(post.cfg2.y, 0.01) * min(ext.x, ext.y);
    let t = clamp(-sd / band, 0.0, 1.0);             // 0 at the rim, 1 deep in
    let bend = (1.0 - t) * (1.0 - t);
    let k = 1.0 - 0.85 * clamp(a, 0.0, 1.0);
    // Outside a pane the picture passes through untouched — that gap is raw
    // gradient, never a drawn line.
    let inPane = step(sd, 0.0);
    let c = blurAt(
      (cell + vec2<f32>(0.5) + f * mix(1.0, k, inPane) + (nrm / ca) * bend * a * 0.06 * inPane) / cnt,
      post.cfg2.z * ppp * inPane,
    );
    // Nothing is added on top — no highlight, no tint, no line. The pane is
    // only the picture behind it, bent. Every earlier attempt to "help" it read
    // as glass (a lit rim, a bright mortar, a haze) turned out to be the thing
    // making it read as plastic instead.
    col = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (mode == 13) {                           // Film
    // The Mesh01 study app's grainy-wallpaper finish: a two-stage fbm domain
    // warp bends the sampling position (liquefying the gradient into marble),
    // then its film grain and elliptical vignette grade the result. All
    // sampling goes through tap(), which clamps — so the warp never reads
    // outside the frame and there is no rim artifact. Static by design: the
    // Post uniforms carry no time, and motion belongs to the drifting points.
    let asp = aspect(res);
    let amt = clamp(a, 0.0, 1.0);
    let soft = clamp(post.cfg2.y, 0.0, 1.0);
    let th = radians(post.cfg2.x);
    // Mesh01's centred, height-normalised coordinate.
    let qc = (uv - vec2<f32>(0.5)) * asp;
    let rq = vec2<f32>(cos(th) * qc.x + sin(th) * qc.y, -sin(th) * qc.x + cos(th) * qc.y);
    // Softness modulates zoom and warp exactly as Mesh01's Look does.
    let wp = rq * (max(b, 0.1) * (1.05 - soft * 0.55)) + vec2<f32>(7.3, 7.3);
    let w = amt * 4.0 * (0.35 + soft * 0.7);
    let q1 = vec2<f32>(fbm3(wp), fbm3(wp + vec2<f32>(3.7, 1.3)));
    let r1 = vec2<f32>(
      fbm3(wp + w * q1 + vec2<f32>(1.7, 9.2)),
      fbm3(wp + w * q1 + vec2<f32>(8.3, 2.8)),
    );
    var c = tap(uv + r1 * amt * 0.16 / asp);
    // Vignette on the UNWARPED position — Mesh01's ellipse, verbatim.
    let vd = length(qc * vec2<f32>(0.78, 0.52));
    c = c * mix(1.0, 1.0 - smoothstep(0.1, 1.25, vd), clamp(post.cfg2.w, 0.0, 1.0));
    // Mesh01's grain: 1500 cell-rows per frame height, luminance-weighted,
    // locked (no time term) like real film stock.
    let g = hash21(floor(uv * asp * 1500.0));
    c = c + vec3<f32>((g - 0.5) * clamp(post.cfg2.z, 0.0, 1.0) * 0.34 * (0.22 + dot(c, vec3<f32>(0.333, 0.333, 0.333))));
    col = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
  }
  return vec4<f32>(col, 1.0);
}
