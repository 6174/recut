// MetalForge — Dots (unified WebGPU preview).
//
// Drives the live editor preview for every style in the Dots effect:
//   0 wavy        — wave-displaced 3D dot field
//   1 mountains   — sharp jagged ridges (3D)
//   2 ocean       — long swells with cool tint (3D)
//   3 standing    — interference standing wave (3D)
//   4 flow        — flat curl-flow grid
//   5 plasma      — flat plasma sin-stack grid
//   6 snake       — flat phase-aligned trails
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering. The per-style .metal files the
// user downloads are standalone; this WGSL is preview-only.

struct Uniforms {
  size:         vec2<f32>,
  time:         f32,
  style:        f32,
  speed:        f32,
  brightness:   f32,
  tint:         vec4<f32>,
  background:   vec4<f32>,
  dotSize:      f32,
  gridDensity:  f32,
  patternScale: f32,
  vignette:     f32,
  horizon:      f32,
  amplitude:    f32,
  depthFade:    f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

// `round`, spelled out, because the three implementations do not agree on it.
// WGSL's `round` rounds a tie to the EVEN integer; MSL's rounds it away from
// zero; SkSL has no `round` at all. Writing MSL's rule here — and in
// dots.sksl — is what makes the preview, the .metal a user downloads and the
// React Native component land on the same cell for every input rather than for
// almost every input. It is a 0/255 change: a tie needs the product to land
// exactly on a half.
fn dtRound(x: f32) -> f32 {
  return sign(x) * floor(abs(x) + 0.5);
}

fn dtRound2(v: vec2<f32>) -> vec2<f32> {
  return sign(v) * floor(abs(v) + 0.5);
}

// ─── Per-style height functions (3D ground-plane variants) ────────────────

fn dotsWavyH(x: f32, z: f32, t: f32) -> f32 {
  let ps = u.patternScale;
  var base = (sin(x * 3.6 * ps + t * 0.85) * 0.45
            + sin(z * 2.2 * ps + t * 0.65) * 0.40
            + sin((x * 1.9 + z * 2.0) * ps + t * 1.10) * 0.30
            + sin((x * 2.8 - z * 1.3) * ps + t * 0.45) * 0.22) * 0.16;
  let damp = 1.0 - smoothstep(3.5, 9.0, z) * 0.85;
  return base * damp * u.amplitude;
}

fn dotsMountainsH(x: f32, z: f32, t: f32) -> f32 {
  let ps = u.patternScale;
  var h = sin(x * 1.0 * ps + t * 0.20) * 0.50
        + sin(z * 0.8 * ps + t * 0.15) * 0.50
        + sin((x * 2.3 + z * 1.7) * ps + t * 0.30) * 0.30
        + sin((x * 4.7 - z * 3.1) * ps + t * 0.40) * 0.18
        + sin((x * 9.0 + z * 7.0) * ps + t * 0.55) * 0.10;
  h = 1.0 - abs(h * 0.5);
  h = pow(max(h, 0.0), 2.5) - 0.4;
  h = h * 0.16;
  let damp = 1.0 - smoothstep(4.0, 10.0, z) * 0.85;
  return h * damp * u.amplitude;
}

fn dotsOceanH(x: f32, z: f32, t: f32) -> f32 {
  let ps = u.patternScale;
  var base = sin(x * 1.2 * ps + t * 0.55) * 0.55
           + sin(z * 0.9 * ps + t * 0.45) * 0.50
           + sin((x * 0.5 + z * 0.7) * ps + t * 0.70) * 0.40
           + sin((x * 1.5 - z * 0.6) * ps + t * 0.35) * 0.20;
  base = base * 0.20;
  let damp = 1.0 - smoothstep(3.5, 9.0, z) * 0.85;
  return base * damp * u.amplitude;
}

fn dotsStandingH(x: f32, z: f32, t: f32) -> f32 {
  let ps = u.patternScale;
  let a = sin(x * 4.5 * ps) * sin(z * 4.5 * ps);
  let b = sin(x * 7.0 * ps + 1.0) * sin(z * 7.0 * ps + 1.0);
  let env = sin(t * 1.4);
  var h = (a * 0.7 + b * 0.3) * env;
  h = h * 0.13;
  let damp = 1.0 - smoothstep(3.5, 9.0, z) * 0.85;
  return h * damp * u.amplitude;
}

// ─── 3D-perspective dot field renderer ────────────────────────────────────
//
// Style indices for the 3D family (used to select the height fn):
//   0 wavy, 1 mountains, 2 ocean, 3 standing

fn heightFor(styleI: i32, x: f32, z: f32, t: f32) -> f32 {
  if (styleI == 0) { return dotsWavyH(x, z, t); }
  if (styleI == 1) { return dotsMountainsH(x, z, t); }
  if (styleI == 2) { return dotsOceanH(x, z, t); }
  return dotsStandingH(x, z, t);
}

fn renderDots3D(styleI: i32, position: vec2<f32>) -> vec3<f32> {
  let size = u.size;
  let uv   = (position - 0.5 * size) / size.y;
  let t    = u.time * u.speed;
  let horizon = u.horizon;

  let yFromHorizon = uv.y - horizon;
  if (yFromHorizon < 0.002) {
    return vec3<f32>(0.0);
  }

  let gridSize     = 0.034 / max(u.gridDensity, 0.01);
  let cellZmax     = 9.1;
  let jMaxAbsolute = cellZmax / gridSize;

  // Wave-aware Z sweep — works for every 3D style. The set of cells that can
  // project to this pixel is bounded by the worst-case displacement
  // (`yampBound`) of the height function: a cell at depth Z with displacement
  // Y projects to screen-Y = (1 - Y) / Z, so for the current pixel we need
  // Z in [(1 - yampBound), (1 + yampBound)] / yFromHorizon. Per-style
  // `yampBase` captures each height fn's peak |Y| at amplitude=1. This
  // replaces the old Newton + fixed ±dj window, which dropped cells (visible
  // as black holes) once gridDensity or amplitude pushed displacement past
  // the hardcoded search radius.
  let yampBase = select(
    select(0.13, 0.33, styleI == 2),     // standing default, ocean = 0.33
    select(0.22, 0.12, styleI == 1),     // wavy = 0.22, mountains = 0.12
    styleI == 0 || styleI == 1);
  // dampEst is evaluated at Zmin (the smallest cell Z the wave can lift a
  // cell to), not at Z0 = 1/yFromHorizon. damp decreases with Z, so
  // damp(Zmin) is the tight upper bound on the actual damp for any cell that
  // can land on this pixel. Previously dampEst used `Z0 * 0.85` as a fudge
  // factor — that only covered amplitudes up to ~0.68 for wavy, so at higher
  // amplitudes the bound underestimated and crest cells fell outside the
  // search window, showing as an empty circle at the top of the wave peak.
  let yampMax   = yampBase * u.amplitude;
  let Zmin      = max(0.05, (1.0 - yampMax) / yFromHorizon);
  let dampEst   = 1.0 - smoothstep(3.5, 9.0, Zmin) * 0.85;
  let yampBound = max(yampBase * dampEst * u.amplitude, 0.03);
  let Zlo = max(0.05, (1.0 - yampBound) / yFromHorizon);
  let Zhi = (1.0 + yampBound) / yFromHorizon;
  let jMin = max(1, i32(floor(Zlo / gridSize)));
  let jMax = min(i32(jMaxAbsolute), i32(ceil(Zhi / gridSize)));
  let isWavy = styleI == 0;

  var accum: vec3<f32> = vec3<f32>(0.0);
  let halfSizeX = 0.5 * size.x;
  let halfSizeY = 0.5 * size.y;

  // depthFade exponent differs per style (matches source):
  //   wavy/ocean: 0.35 ; mountains/standing: 0.32
  let depthK = select(0.32, 0.35, styleI == 0 || styleI == 2);

  // crest reference per style.
  let crestRef = select(0.13, 0.16,
                  styleI == 1 || styleI == 0);
  // override for wavy (0.22) and ocean (0.28).
  let crestRefFinal = select(
    select(crestRef, 0.28, styleI == 2),
    0.22, styleI == 0);

  for (var j: i32 = jMin; j <= jMax; j = j + 1) {
    let jf    = f32(j);
    let cellZ = jf * gridSize;

    let rawR             = 4.4 / (1.0 + cellZ * 1.10);
    let pxR              = max(rawR, 0.85) * u.dotSize;
    let horizCullThresh  = pxR * 4.0 + 2.0;
    let baseHaloScale    = max(pxR * 1.7, 1.2);
    let subPxFade        = smoothstep(0.4, 1.0, rawR);
    let depth            = 1.0 / (1.0 + cellZ * depthK * u.depthFade);
    let invCellZ         = 1.0 / cellZ;
    let pitchScreenX     = gridSize * invCellZ * size.y;
    // Wavy at high amplitude lifts crests to cells close to the camera,
    // where the X-pitch grows past the dot's halo reach. Consecutive crest
    // dots then sit on widely-separated screen Ys with empty space between
    // them — the "black circle at the top of the wave" the user reports.
    // For wavy only, stretch the halo so it spans the pitch and the peak
    // reads as a continuous luminous ridge. Non-wavy styles never get close
    // enough for `pitchScreenX * 0.5 > baseHaloScale`, so they're untouched.
    let haloScale        = select(baseHaloScale, max(baseHaloScale, pitchScreenX * 0.5), styleI == 0);
    let iCenter          = dtRound(uv.x * jf);
    let iCenterScreenX   = iCenter * pitchScreenX + halfSizeX;
    let iCenterCellX     = iCenter * gridSize;

    for (var di: i32 = -1; di <= 1; di = di + 1) {
      let dotScreenX = iCenterScreenX + f32(di) * pitchScreenX;
      if (abs(position.x - dotScreenX) > horizCullThresh) { continue; }

      let cellX = iCenterCellX + f32(di) * gridSize;
      let Y     = heightFor(styleI, cellX, cellZ, t);
      let dotYFromH = (1.0 - Y) * invCellZ;
      if (dotYFromH < 0.01) { continue; }
      let dotScreenY = (horizon + dotYFromH) * size.y + halfSizeY;
      if (isWavy) {
        if (abs(position.y - dotScreenY) > horizCullThresh) { continue; }
      }

      let horizonFade = smoothstep(0.0, 0.05, dotYFromH);
      let d           = length(position - vec2<f32>(dotScreenX, dotScreenY));
      let mask        = smoothstep(pxR + 1.0, pxR - 1.0, d);
      let halo        = exp(-d / haloScale) * 0.25;
      let crest       = clamp(Y / (crestRefFinal * max(u.amplitude, 0.01)) * 0.5 + 0.5, 0.0, 1.0);

      // Per-style highlight curves.
      var highlight: f32;
      if (styleI == 0)      { highlight = 0.55 + 0.85 * crest; }                                 // wavy
      else if (styleI == 1) { highlight = 0.35 + 0.55 * crest + 0.6 * pow(crest, 3.0); }         // mountains
      else if (styleI == 2) { highlight = 0.45 + 1.0  * crest; }                                 // ocean
      else                  { highlight = 0.40 + 1.0  * crest; }                                 // standing

      let intensity = (mask + halo) * depth * highlight * horizonFade * subPxFade;
      accum = max(accum, vec3<f32>(intensity));
    }
  }

  // Per-style brightness boost.
  let boost = select(
    select(1.2, 1.15, styleI == 1),
    1.25, styleI == 0 || styleI == 2);
  accum = min(accum * boost, vec3<f32>(1.0));

  // Vignette strength varies per style.
  let vUV  = (position - 0.5 * size) / size;
  let vigK = select(0.5, 0.6, styleI == 0 || styleI == 2);
  let vig  = clamp(1.0 - dot(vUV, vUV) * vigK * u.vignette, 0.0, 1.0);
  accum = accum * vig;

  // Ocean adds a cool-water tint on top.
  if (styleI == 2) {
    accum = accum * vec3<f32>(0.92, 0.97, 1.0);
  }
  return accum;
}

// ─── Flat 2D dot-grid styles ──────────────────────────────────────────────

fn renderDotsFlow(position: vec2<f32>) -> f32 {
  let size = u.size;
  let uv   = (position - 0.5 * size) / size.y;
  let t    = u.time * u.speed;
  let ps   = u.patternScale;

  let grid       = 0.020 / max(u.gridDensity, 0.01);
  let cell       = dtRound2(uv / grid) * grid;
  let distToDot  = length(uv - cell);
  let pxR        = (1.4 / size.y) * u.dotSize;
  let mask       = smoothstep(pxR * 1.4, pxR * 0.6, distToDot);

  let n = sin(cell.x * 3.0 * ps + t * 0.4) * cos(cell.y * 3.0 * ps - t * 0.35)
        + 0.5 * sin(cell.x * 7.0 * ps - t * 0.6) * sin(cell.y * 7.0 * ps + t * 0.55);

  let fronts = sin(n * 6.0 + length(cell) * 8.0 * ps - t * 1.8);
  let bright = pow(max(fronts, 0.0), 1.8);

  let vUV = (position - 0.5 * size) / size;
  let vig = clamp(1.0 - dot(vUV, vUV) * 0.85 * u.vignette, 0.0, 1.0);
  return mask * (0.10 + 1.0 * bright) * vig;
}

fn renderDotsPlasma(position: vec2<f32>) -> f32 {
  let size = u.size;
  let uv   = (position - 0.5 * size) / size.y;
  let t    = u.time * u.speed;
  let ps   = u.patternScale;

  let grid       = 0.018 / max(u.gridDensity, 0.01);
  let cell       = dtRound2(uv / grid) * grid;
  let distToDot  = length(uv - cell);
  let pxR        = (1.6 / size.y) * u.dotSize;
  let mask       = smoothstep(pxR * 1.4, pxR * 0.6, distToDot);

  var v = sin(cell.x * 8.0 * ps + t * 1.3)
        + sin(cell.y * 8.0 * ps + t * 1.1)
        + sin((cell.x + cell.y) * 6.0 * ps + t * 1.5)
        + sin(length(cell) * 10.0 * ps - t * 1.8);
  v = v * 0.25;
  var bright = clamp(0.5 + 0.5 * v, 0.0, 1.0);
  bright = pow(bright, 2.5);

  let vUV = (position - 0.5 * size) / size;
  let vig = clamp(1.0 - dot(vUV, vUV) * 0.9 * u.vignette, 0.0, 1.0);
  return mask * bright * vig;
}

fn renderDotsSnake(position: vec2<f32>) -> f32 {
  let size = u.size;
  let uv   = (position - 0.5 * size) / size.y;
  let t    = u.time * u.speed;
  let ps   = u.patternScale;

  let grid       = 0.018 / max(u.gridDensity, 0.01);
  let cell       = dtRound2(uv / grid) * grid;
  let distToDot  = length(uv - cell);
  let pxR        = (1.5 / size.y) * u.dotSize;
  let mask       = smoothstep(pxR * 1.4, pxR * 0.6, distToDot);

  let angle = sin(cell.x * 4.0 * ps + t * 0.6) * 1.2
            + cos(cell.y * 4.0 * ps - t * 0.5) * 1.2
            + sin((cell.x + cell.y) * 3.0 * ps + t * 0.9);
  let flow = vec2<f32>(cos(angle), sin(angle));

  let phase  = dot(cell, flow) * 12.0 * ps - t * 4.0;
  var bright = 0.5 + 0.5 * sin(phase);
  bright = pow(bright, 4.0);

  let vUV = (position - 0.5 * size) / size;
  let vig = clamp(1.0 - dot(vUV, vUV) * 0.7 * u.vignette, 0.0, 1.0);
  return mask * (0.10 + 1.1 * bright) * vig;
}

// ─── Entry: dispatch on style index ───────────────────────────────────────

fn dotsField(uv01: vec2<f32>) -> vec4<f32> {
  let position = uv01 * u.size;
  let styleI   = i32(u.style);

  let fg = u.tint.rgb * u.brightness;
  let bg = u.background.rgb;

  if (styleI <= 3) {
    let accum = renderDots3D(styleI, position);
    let col   = mix(bg, fg, accum);
    return vec4<f32>(col, 1.0);
  }

  var intensity: f32 = 0.0;
  if (styleI == 4)      { intensity = renderDotsFlow(position); }
  else if (styleI == 5) { intensity = renderDotsPlasma(position); }
  else                  { intensity = renderDotsSnake(position); }
  let col = mix(bg, fg, vec3<f32>(intensity));
  return vec4<f32>(col, 1.0);
}
