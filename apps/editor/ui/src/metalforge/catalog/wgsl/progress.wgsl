// Progress — ten transfer bars, ported from the "Agent Migration Bar Set"
// design sheet (nine numbered bars) plus "Agent Migration Bar" (the original
// blue one the set was derived from, here style ten, "Liquid").
//
// This file, progress.metal and progress.sksl are three implementations of the
// same maths. Change one, change all three.
//
// ── The three numbers the host feeds it ────────────────────────────────────
//
// The sheet is ten WebGL fragment shaders driven by one JavaScript host, and
// this file is the shaders. The SHADERS are transcribed constant for constant —
// every magic number below is the sheet's, and each param's default IS the
// constant it replaced, so the default render is the sheet's render.
// tools/_progress-extract.mjs evaluates the checked-in .dc.html and emits those
// ten GLSL sources, and tools/_progress-check.mjs renders them beside this file
// and diffs the pixels.
//
// The HOST is the other half and it is not a shader: nine stateful behaviours
// that hold state between frames, so each bar fills in its own way — Bands
// clicks an exact 10% on a metronome, Slosh sweeps a quarter on a cosine,
// Spring overshoots and settles, Hex sits dead still and then fires three
// shocks. That is `effects/progress/sim.ts`, generated from the sheet's own
// class and checked against it frame for frame, and it hands this file exactly
// what the sheet handed its own: `progress` (the fill), `alive` (the sheet's
// `uA` — how alive the front is) and `warp` (the sheet's `uT`, a clock that
// runs faster while something is moving). Nothing here decides any of them.
//
// ── Orientation ────────────────────────────────────────────────────────────
//
// The sheet reads gl_FragCoord, which is BOTTOM-left. The preview runner hands
// us a top-left uv and stitchable MSL's `position` is top-left too, so both
// ports flip once, up front, and everything downstream is the sheet's own
// expression untouched. Get this wrong and the bar still looks plausible — the
// vignette is symmetric — but every wave, every honeycomb row and every grain
// cell lands somewhere else.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering: fourteen scalars, then eight colours
// (align 16), which leaves 12 bytes of implicit padding before `background`.
struct Uniforms {
  size:       vec2<f32>,
  time:       f32,
  style:      f32,
  progress:   f32,
  // `alive` and not `active`: the latter is a RESERVED KEYWORD in WGSL, and the
  // second one this shader has hit. Both are legal in MSL and SkSL, so both of
  // those compile and only the browser goes black, with the reason in a
  // compilation-info warning that nothing throws on.
  alive:      f32,
  warp:       f32,
  scale:      f32,
  amount:     f32,
  lag:        f32,
  echo:       f32,
  bloom:      f32,
  jitter:     f32,
  grain:      f32,
  // The eighteen below are the sheet's own constants, lifted out one by
  // one. Every default IS the constant it replaced — per style, through
  // that style's `presets` where the sheet used a different number for
  // each — so the untouched render is still the sheet's render and
  // tools/_progress-check.mjs still measures 0.
  frontIn:    f32,
  frontOut:   f32,
  feather:    f32,
  churn:      f32,
  ripple:     f32,
  falloff:    f32,
  trails:     f32,
  trailGlow:  f32,
  haze:       f32,
  vignette:   f32,
  pulse:      f32,
  pulseRate:  f32,
  stagger:    f32,
  cellSize:   f32,
  fill:       f32,
  density:    f32,
  turbulence: f32,
  sparkle:    f32,
  background: vec4<f32>,
  color1:     vec4<f32>,
  color2:     vec4<f32>,
  color3:     vec4<f32>,
  color4:     vec4<f32>,
  color5:     vec4<f32>,
  color6:     vec4<f32>,
  color7:     vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

// The sheet's three noise helpers, verbatim.
fn mfp_h21(p0: vec2<f32>) -> f32 {
  var p = fract(p0 * vec2<f32>(123.34, 345.45));
  p = p + vec2<f32>(dot(p, p + vec2<f32>(34.345, 34.345)));
  return fract(p.x * p.y);
}

fn mfp_vn(p0: vec2<f32>) -> f32 {
  let i = floor(p0);
  let f = fract(p0);
  let w = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mfp_h21(i), mfp_h21(i + vec2<f32>(1.0, 0.0)), w.x),
    mix(mfp_h21(i + vec2<f32>(0.0, 1.0)), mfp_h21(i + vec2<f32>(1.0, 1.0)), w.x),
    w.y,
  );
}

fn mfp_fbm(p0: vec2<f32>) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var p = p0;
  for (var i: i32 = 0; i < 4; i = i + 1) {
    v = v + a * mfp_vn(p);
    p = p * 2.03 + vec2<f32>(11.7, 11.7);
    a = a * 0.5;
  }
  return v;
}

// GLSL's `mod`, spelled out. WGSL has no `mod`, MSL's `fmod` truncates toward
// zero and SkSL's `mod` floors — so all three files carry this one expression
// rather than three builtins that agree only for positive operands.
fn mfp_mod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}

// `smoothstep` with the edges the sheet's way round. Half the calls below pass
// edge0 > edge1 to run the ramp backwards; that is well defined in GLSL only by
// convention and explicitly undefined in WGSL and MSL, so the port spells out
// the formula every implementation actually uses instead of relying on it.
fn mfp_sstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// ── The wavy front, shared by Slosh / Spring / Bands / Liquid ──────────────
// The sheet built those four from one template whose only hole was `wave()`.
fn mfp_wave(sid: i32, y: f32, tt: f32, amp: f32) -> f32 {
  if (sid == 1) {
    var slosh = sin(y * 3.0 * u.ripple + tt * 0.50 * u.churn) * 0.95;
    slosh = slosh + (y - 0.5) * sin(tt * 0.38 * u.churn) * 1.30;
    return slosh * amp;
  }
  if (sid == 3) {
    let env = sin(y * 3.14159);
    let w = sin(y * 24.0 * u.ripple + tt * 1.70 * u.churn) * 0.70 + sin(y * 11.0 * u.ripple - tt * 0.95 * u.churn) * 0.45;
    return w * env * env * amp;
  }
  if (sid == 5) {
    let q = floor(y * u.scale);
    let s1 = sin(q * 2.10 * u.ripple + tt * 1.50 * u.churn);
    let s2 = sin(q * 0.90 * u.ripple - tt * 0.85 * u.churn);
    return (s1 * 0.72 + s2 * 0.34) * amp;
  }
  var w = sin(y * 19.0 * u.ripple + tt * 1.55 * u.churn) * 0.55
        + sin(y * 31.0 * u.ripple - tt * 1.05 * u.churn + 1.3) * 0.24
        + sin(y * 8.5 * u.ripple + tt * 0.62 * u.churn) * 0.46;
  w = w + (mfp_fbm(vec2<f32>(y * 2.6 * u.ripple, tt * 0.42 * u.churn)) - 0.5) * 1.15;
  return w * amp;
}

fn mfp_liquid(sid: i32, p: vec2<f32>, uv: vec2<f32>, asp: f32, t: f32,
              uP: f32, uA: f32, res: vec2<f32>) -> vec3<f32> {
  let amp = u.amount * uA;
  let ex = mix(u.frontIn, asp + u.frontOut, uP);
  let off = mfp_wave(sid, uv.y, t, amp);
  let d = p.x - (ex + off);
  let px = 1.6 * u.feather / res.y;
  let inside = 1.0 - smoothstep(-px, px, d);
  let dl = max(0.0, -d);
  let prot = clamp(off / max(amp, 0.0001) * 0.5 + 0.5, 0.0, 1.0);
  let lum = u.bloom;

  var col = u.color1.rgb;
  col = mix(col, u.color2.rgb, exp(-dl * 2.1 * u.falloff));
  col = mix(col, u.color3.rgb, exp(-dl * 5.2 * u.falloff) * 0.9);
  col = mix(col, u.color4.rgb, exp(-dl * 9.0 * u.falloff) * (0.72 + 0.28 * prot) * lum);
  col = mix(col, u.color5.rgb, exp(-dl * 17.0 * u.falloff) * (0.55 + 0.45 * prot) * lum);

  // A fixed trip count plus a break, not a runtime bound: SkSL wants a
  // count the compiler can see, and the three files have to say the same
  // thing. At the default `trails` of 3 the loop runs 1, 2, 3 exactly as
  // the sheet's did. The two falloffs are clamped because they were
  // written for three echoes — `40.0 - fk * 7.0` goes negative at six,
  // and a negative rate in an exp() is a white bar.
  for (var k: i32 = 1; k < 7; k = k + 1) {
    if (k > i32(u.trails + 0.5)) { break; }
    let fk = f32(k);
    let ok = mfp_wave(sid, uv.y, t - fk * u.lag, amp * (1.0 + fk * 0.22));
    let dk = p.x - (ex + ok - fk * (u.echo + 0.030 * uA));
    col = col + u.color6.rgb * exp(-abs(dk) * max(0.5, 15.0 - fk * 3.2) * u.falloff) * (0.34 / fk) * u.trailGlow;
    col = col + u.color7.rgb * exp(-abs(dk) * max(0.5, 40.0 - fk * 7.0) * u.falloff) * (0.16 / fk) * lum * u.trailGlow;
  }

  let hz = mfp_fbm(vec2<f32>(p.x * 1.6 - t * 0.06 * uA * u.churn, uv.y * 1.9 + t * 0.05 * uA * u.churn));
  col = col * mix(1.0, 0.86 + 0.28 * hz, u.haze);
  let vig = smoothstep(0.0, 0.42, uv.y) * mfp_sstep(1.0, 0.58, uv.y);
  col = col * mix(1.0, mix(0.78, 1.06, vig), u.vignette);
  return mix(u.background.rgb, col, inside);
}

// ── The six that own their whole frame ────────────────────────────────────

fn mfp_hex(p: vec2<f32>, uv: vec2<f32>, asp: f32, t: f32, uP: f32, uA: f32) -> vec3<f32> {
  let sc = u.scale;
  var q = vec2<f32>(p.x * sc, uv.y * sc * 1.15);
  q.x = q.x + mfp_mod(floor(q.y), 2.0) * 0.5;
  let ci = floor(q);
  let cf = fract(q) - vec2<f32>(0.5);
  let cell = max(abs(cf.x) * 1.15 + abs(cf.y) * 0.66, abs(cf.y) * 1.32);
  let body = 1.0 - smoothstep(0.46 - 0.04 * u.feather, 0.46 + 0.04 * u.feather, cell / u.cellSize);
  let inner = 1.0 - smoothstep(0.35 - 0.05 * u.feather, 0.35 + 0.05 * u.feather, cell / u.cellSize);
  let cx = (ci.x + 0.5) / sc;
  let front = mix(u.frontIn, asp + u.frontOut, uP);
  let lit = smoothstep(0.0, 0.12, front - cx - (mfp_h21(ci) - 0.5) * u.stagger);
  let puls = (1.0 - u.pulse) + u.pulse * sin(t * u.pulseRate * uA * u.churn + mfp_h21(ci) * 30.0);
  var col = u.background.rgb;
  col = col + u.color1.rgb * body * 0.85;
  col = col + u.color3.rgb * body * lit * puls;
  col = col + u.color2.rgb * inner * lit * 0.45;
  return col;
}

fn mfp_smoke(p: vec2<f32>, uv: vec2<f32>, asp: f32, t: f32, uP: f32, uA: f32) -> vec3<f32> {
  let front = mix(u.frontIn, asp + u.frontOut, uP);
  let w = vec2<f32>(p.x * u.scale - t * 0.12 * uA * u.churn, uv.y * 2.00 + t * 0.05 * uA * u.churn);
  let n = mfp_fbm(w + vec2<f32>(mfp_fbm(w * 1.70) * 1.60 * u.turbulence));
  let dens = mfp_sstep(0.62, 0.05, (p.x - front) * 1.40 * u.density + (0.5 - n) * 1.50 * u.turbulence);
  var col = u.background.rgb;
  col = col + u.color1.rgb * dens;
  col = col + u.color2.rgb * pow(dens, 2.20) * 0.80;
  col = col + u.color3.rgb * pow(dens, 7.00) * 0.65;
  return col;
}

fn mfp_drops(p: vec2<f32>, uv: vec2<f32>, asp: f32, t: f32, uP: f32, uA: f32) -> vec3<f32> {
  let front = mix(u.frontIn, asp + u.frontOut, uP);
  let grade = mfp_sstep(front + 0.34, front - 0.30, p.x);
  let g = u.scale;
  let cell = floor(vec2<f32>(p.x, uv.y) * g);
  let cf = fract(vec2<f32>(p.x, uv.y) * g) - vec2<f32>(0.5);
  let rnd = mfp_h21(cell);
  let rnd2 = mfp_h21(cell + vec2<f32>(13.0, 13.0));
  let jit = uA * u.jitter;
  let off = vec2<f32>(sin(t * 4.0 * u.churn + rnd * 40.0), cos(t * 3.1 * u.churn + rnd2 * 40.0)) * jit;
  let on = step(1.0 - grade * u.fill, rnd);
  let rad = (0.16 + 0.26 * grade) * u.cellSize;
  let disc = 1.0 - mfp_sstep(rad - 0.12 * u.feather, rad + 0.04 * u.feather, length(cf - off));
  var col = u.background.rgb;
  col = col + u.color1.rgb * grade * 0.55;
  col = col + mix(u.color2.rgb, u.color3.rgb, grade) * disc * on;
  return col;
}

fn mfp_threads(p: vec2<f32>, uv: vec2<f32>, asp: f32, t: f32, uP: f32, uA: f32,
               res: vec2<f32>) -> vec3<f32> {
  let n = u.scale;
  let ti = floor(uv.y * n);
  let tf = fract(uv.y * n) - 0.5;
  let strand = 1.0 - smoothstep(0.18 * u.cellSize, 0.42 * u.cellSize, abs(tf));
  let len = mix(u.frontIn, asp + u.frontOut, uP)
          + (mfp_h21(vec2<f32>(ti, 5.0)) - 0.5) * u.stagger
          + sin(t * 2.20 * u.churn + ti * 0.70) * 0.055 * uA;
  let d = p.x - len;
  let px = 1.6 * u.feather / res.y;
  let on = 1.0 - smoothstep(-px * 2.0, px * 2.0, d);
  let dd = max(0.0, -d);
  var col = u.background.rgb;
  col = col + u.color1.rgb * on * strand;
  col = col + u.color2.rgb * exp(-dd * 3.00 * u.falloff) * on * strand;
  col = col + u.color3.rgb * exp(-dd * 14.0 * u.falloff) * on * strand;
  return col;
}

fn mfp_diamond(p: vec2<f32>, uv: vec2<f32>, asp: f32, t: f32, uP: f32, uA: f32) -> vec3<f32> {
  let sc = u.scale;
  let q = vec2<f32>((p.x + uv.y) * 0.7071, (uv.y - p.x) * 0.7071) * sc;
  let ci = floor(q);
  let cf = fract(q) - vec2<f32>(0.5);
  let dia = abs(cf.x) + abs(cf.y);
  let cxw = (ci.x - ci.y) * 0.7071 / sc;
  let front = mix(u.frontIn, asp + u.frontOut, uP);
  let rnd = mfp_h21(ci);
  let appear = smoothstep(0.02, 0.14, front - cxw - (rnd - 0.5) * u.stagger);
  let size = mix(0.06, 0.44, appear) * u.cellSize;
  let tile = 1.0 - mfp_sstep(size - 0.05 * u.feather, size + 0.02 * u.feather, dia);
  let puls = (1.0 - u.pulse) + u.pulse * sin(t * u.pulseRate * uA * u.churn + rnd * 30.0);
  var col = u.background.rgb;
  col = col + u.color1.rgb * mfp_sstep(front + 0.10, front - 0.20, p.x);
  let tint = mix(u.color2.rgb, u.color3.rgb, rnd);
  col = col + tint * tile * appear * puls;
  let rim = (1.0 - smoothstep(0.0, 0.06 * u.feather, abs(dia - size))) * appear;
  col = col + u.color4.rgb * rim * 0.40;
  return col;
}

fn mfp_grain(p: vec2<f32>, uv: vec2<f32>, asp: f32, t: f32, uP: f32, uA: f32) -> vec3<f32> {
  let front = mix(u.frontIn, asp + u.frontOut, uP);
  let grade = mfp_sstep(front + 0.30, front - 0.35, p.x);
  let g = u.scale;
  let cell = floor(vec2<f32>(p.x, uv.y) * g);
  let rnd = mfp_h21(cell);
  let rnd2 = mfp_h21(cell + vec2<f32>(9.0, 9.0));
  let flick = mfp_h21(cell + vec2<f32>(floor(t * 7.0 * uA * u.churn) * 3.0));
  let on = step(1.0 - grade * u.fill, rnd * 0.85 + flick * 0.15);
  let tint = mix(u.color1.rgb, u.color2.rgb, rnd2);
  var col = u.background.rgb + tint * on * (0.30 + 0.70 * grade);
  col = col + u.color3.rgb * on * step(1.0 - 0.015 * u.sparkle, rnd2) * grade * 0.85;
  return col;
}

fn progressBar(uv01: vec2<f32>) -> vec4<f32> {
  let res = max(u.size, vec2<f32>(1.0, 1.0));
  // The sheet's coordinates: gl_FragCoord is bottom-left, the runner's uv is
  // top-left. Flip once here and every expression below is the sheet's own.
  //
  // Snapped to the pixel CENTRE rather than left as `uv * res`. The two are the
  // same number to within a rounding error, and the dither on the last line
  // cannot survive one: `mfp_h21` multiplies its argument by 345.45 before the
  // first `fract`, so a 1e-4 drift in the coordinate is a completely different
  // hash. Snapping makes it exactly gl_FragCoord.xy, which is what lets the
  // grain of the port and the grain of the sheet be the same grain.
  let fc = floor(vec2<f32>(uv01.x, 1.0 - uv01.y) * res) + vec2<f32>(0.5, 0.5);
  let uv = fc / res;
  let asp = res.x / res.y;
  let p = vec2<f32>(uv.x * asp, uv.y);

  // The three the host hands over, unchanged. `time` is still in the struct
  // because the runner writes it every frame for every effect; this one does
  // not read it, because its clock is the sheet's warped one.
  let uP = clamp(u.progress * 0.01, 0.0, 1.0);
  let uA = clamp(u.alive, 0.0, 1.0);
  let t = u.warp;
  let sid = i32(u.style + 0.5);

  var col: vec3<f32>;
  if (sid == 0) { col = mfp_hex(p, uv, asp, t, uP, uA); }
  else if (sid == 2) { col = mfp_smoke(p, uv, asp, t, uP, uA); }
  else if (sid == 4) { col = mfp_drops(p, uv, asp, t, uP, uA); }
  else if (sid == 6) { col = mfp_threads(p, uv, asp, t, uP, uA, res); }
  else if (sid == 7) { col = mfp_diamond(p, uv, asp, t, uP, uA); }
  else if (sid == 8) { col = mfp_grain(p, uv, asp, t, uP, uA); }
  else { col = mfp_liquid(sid, p, uv, asp, t, uP, uA, res); }

  // The sheet's dither, last and outside every branch.
  col = col + vec3<f32>(mfp_h21(fc) - 0.5) * u.grain;
  return vec4<f32>(max(col, vec3<f32>(0.0)), 1.0);
}
