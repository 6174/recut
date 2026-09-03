struct Uniforms {
  size:         vec2<f32>,
  time:         f32,
  speed:        f32,
  cycle:        f32,
  tunnelTime:   f32,
  pause:        f32,
  start:        f32,
  repeats:      f32,
  stars:        f32,
  starDensity:  f32,
  starLayers:   f32,
  starSize:     f32,
  starLength:   f32,
  starSpeed:    f32,
  starSpread:   f32,
  twinkle:      f32,
  warpGlow:     f32,
  tunnelBright: f32,
  tunnelGlow:   f32,
  exposure:     f32,
  vignette:     f32,
  style:        f32,
  tint:         vec4<f32>,
  starTint:     vec4<f32>,
  core:         vec4<f32>,
  flare:        vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

const HS_TAU: f32 = 6.28318530718;

fn hs_sstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn hs_h1(n: f32) -> f32 {
  return fract(sin(n * 127.1) * 43758.5453);
}

fn hs_h13(p0: vec3<f32>) -> f32 {
  var p = fract(p0 * 0.1031);
  p = p + dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

fn hs_n3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = hs_h13(i);
  let b = hs_h13(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = hs_h13(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = hs_h13(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = hs_h13(i + vec3<f32>(0.0, 0.0, 1.0));
  let g = hs_h13(i + vec3<f32>(1.0, 0.0, 1.0));
  let h = hs_h13(i + vec3<f32>(0.0, 1.0, 1.0));
  let k = hs_h13(i + vec3<f32>(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
             mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}

fn hs_fbm(p0: vec3<f32>) -> f32 {
  var p = p0;
  var s = 0.0;
  var amp = 0.5;
  for (var i = 0; i < 4; i = i + 1) {
    s = s + amp * hs_n3(p);
    p = p * 2.03;
    amp = amp * 0.5;
  }
  return s;
}

fn hs_vn1(x: f32) -> f32 {
  let i = floor(x);
  var f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hs_h1(i), hs_h1(i + 1.0), f);
}

fn hs_ringNoise(a01: f32, L: f32, seed: f32) -> f32 {
  let x = a01 * L;
  let i = floor(x);
  var f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hs_h1((i % L) + seed), hs_h1(((i + 1.0) % L) + seed), f);
}

fn hs_colorize(lum: f32, tint: vec3<f32>, core: vec3<f32>) -> vec3<f32> {
  let deep = tint * 0.16;
  let col = mix(deep, tint * 0.9, clamp(lum, 0.0, 1.0));
  return mix(col, mix(tint, core, 0.75),
             clamp(pow(max(lum, 0.0), 3.0) * 0.65, 0.0, 1.0));
}

fn hs_tunnelTail(col0: vec3<f32>, r: f32, tint: vec3<f32>, core: vec3<f32>, glow: f32) -> vec3<f32> {
  var col = col0;
  col = col + (tint * 0.5 + 0.5) * exp(-r * 3.5) * 1.1 * glow;
  col = col + core * exp(-r * 10.0) * 1.3 * glow;
  return col * (0.8 + 0.5 * hs_sstep(1.6, 0.2, r));
}

fn hs_starField(r: f32, a01: f32, time: f32, stretch: f32, warpT: f32,
                tint: vec3<f32>, starTint: vec3<f32>, core: vec3<f32>,
                bright: f32, density: f32, layers: f32, size: f32,
                lengthK: f32, speedK: f32, spread: f32, twk: f32, glow: f32) -> vec3<f32> {
  var col = vec3<f32>(0.0);
  for (var i = 0; i < 3; i = i + 1) {
    let fi = f32(i);
    let lw = clamp(layers - fi, 0.0, 1.0);
    let L = max(floor((120.0 + fi * 70.0) * density + 0.5), 4.0);
    let x = a01 * L + fi * 0.37 * L;
    let id = floor(x) % L;
    let fa = fract(x) - 0.5;
    let rnd = hs_h1(id + fi * 57.7 + L * 1.3);
    let rnd2 = hs_h1(id * 2.3 + fi * 11.7 + 5.0);
    let spd = mix(0.04, 0.22, rnd2) * (1.0 + stretch * 6.0) * speedK;
    let ph = fract(rnd + warpT * spd);
    let rr = pow(ph, 1.8) * 1.7 * spread + 0.015;
    let head = 0.004 * size;
    let len = 0.006 * size + stretch * (0.05 + rr * 1.1) * lengthK;
    let dr = r - rr;
    var radial = hs_sstep(head, -head, dr) * hs_sstep(-len, -len * 0.1, dr);
    let along = clamp((dr + len) / len, 0.0, 1.0);
    radial = radial * along * along;
    let w = (0.003 + 0.004 * rnd2) * (0.35 + r * 0.8) * size;
    let lat = abs(fa) * (HS_TAU / L) * r;
    let lateral = hs_sstep(w, w * 0.2, lat);
    let tw = 1.0 - 0.25 * twk + 0.25 * twk * sin(time * (1.5 + rnd * 3.0) + rnd * 40.0);
    let b = radial * lateral * tw * hs_sstep(0.02, 0.12, r);
    let scol = mix(starTint, mix(tint, core, 0.6), rnd2);
    col = col + scol * b * (1.1 - 0.22 * fi) * bright * lw;
  }
  return col + tint * exp(-r * 4.5) * stretch * glow;
}

fn hs_tunnelKessel(r: f32, a: f32, a01: f32, warpT: f32, tint: vec3<f32>, core: vec3<f32>,
                   bright: f32, glow: f32) -> vec3<f32> {
  let z = 0.3 / (r + 0.07);
  let ca = a + z * 0.45 - warpT * 0.12;
  var q = vec3<f32>(cos(ca), sin(ca), 0.0) * 1.1;
  q.z = z * 0.8 - warpT * 1.35;
  var n = hs_fbm(q * 2.2);
  n = n + 0.5 * hs_fbm(q * 5.0 + vec3<f32>(n * 1.5));
  n = n * 0.72;
  var rays = pow(hs_ringNoise(a01, 110.0, 31.7), 3.0);
  rays = rays * (0.45 + 0.85 * hs_vn1(z * 2.5 - warpT * 3.0 + rays * 9.0));
  let lum = n * n * 1.9 + rays * 0.55 * hs_sstep(0.12, 0.5, r) * n;
  return hs_tunnelTail(hs_colorize(lum * bright, tint, core), r, tint, core, glow);
}

fn hs_tunnelRays(r: f32, a: f32, a01: f32, warpT: f32, tint: vec3<f32>, core: vec3<f32>,
                 bright: f32, glow: f32) -> vec3<f32> {
  let z = 0.3 / (r + 0.07);
  var wide = pow(hs_ringNoise(a01, 64.0, 4.1), 5.0);
  wide = wide * (0.25 + 1.1 * hs_vn1(z * 1.2 - warpT * 4.6 + wide * 5.0));
  var fine = pow(hs_ringNoise(a01, 300.0, 19.7), 9.0);
  fine = fine * (0.3 + 1.2 * hs_vn1(z * 2.6 - warpT * 8.5 + fine * 9.0));
  let lum = (wide * 2.6 + fine * 3.2) * hs_sstep(0.02, 0.35, r);
  return hs_tunnelTail(hs_colorize(lum * bright, tint, core), r, tint, core, glow);
}

fn hs_tunnelStorm(r: f32, a: f32, a01: f32, warpT: f32, tint: vec3<f32>, core: vec3<f32>,
                  bright: f32, glow: f32) -> vec3<f32> {
  let z = 0.3 / (r + 0.07);
  var q = vec3<f32>(cos(a), sin(a), 0.0) * 1.2;
  q.z = z * 1.1 - warpT * 2.6;

  let n = hs_fbm(q * 2.6);
  let arc = pow(1.0 - min(abs(n - 0.5) * 3.4, 1.0), 8.0);
  let flick = 0.55 + 0.45 * hs_vn1(warpT * 24.0 + floor(a01 * 20.0) * 3.7);

  let lum = arc * 3.2 * flick * hs_sstep(0.02, 0.32, r) + exp(-r * 2.2) * 0.45;
  return hs_tunnelTail(hs_colorize(lum * bright, tint, core), r, tint, core, glow);
}

fn hs_tunnelShards(r: f32, a: f32, a01: f32, warpT: f32, tint: vec3<f32>, core: vec3<f32>,
                   bright: f32, glow: f32) -> vec3<f32> {
  let z = 0.3 / (r + 0.07);
  var lum = 0.0;
  for (var i = 0; i < 3; i = i + 1) {
    let fi = f32(i);
    let L = 42.0 + fi * 30.0;
    let x = a01 * L + fi * 0.41 * L;
    let lat = abs(fract(x) - 0.5) * 2.0;
    let rnd = hs_h1((floor(x) % L) + fi * 23.1);

    let travel = fract(z * 0.45 - warpT * (1.5 + rnd * 1.2) + rnd);
    let dash = hs_sstep(0.22, 0.02, travel) * hs_sstep(0.0, 0.05, travel);
    let thin = hs_sstep(0.45 + 0.3 * rnd, 0.05, lat);
    lum = lum + dash * thin * (1.5 - 0.3 * fi);
  }
  lum = lum * 1.5 * hs_sstep(0.03, 0.30, r) + exp(-r * 3.0) * 0.25;
  return hs_tunnelTail(hs_colorize(lum * bright, tint, core), r, tint, core, glow);
}

fn hs_pickTunnel(style: i32, r: f32, a: f32, a01: f32, warpT: f32,
                 tint: vec3<f32>, core: vec3<f32>, bright: f32, glow: f32) -> vec3<f32> {
  if (style == 1) { return hs_tunnelRays(r, a, a01, warpT, tint, core, bright, glow); }
  if (style == 2) { return hs_tunnelStorm(r, a, a01, warpT, tint, core, bright, glow); }
  if (style == 3) { return hs_tunnelShards(r, a, a01, warpT, tint, core, bright, glow); }
  return hs_tunnelKessel(r, a, a01, warpT, tint, core, bright, glow);
}

fn hyperspace(uv01: vec2<f32>) -> vec4<f32> {
  let size = max(u.size, vec2<f32>(1.0));
  let position = uv01 * size;

  let tunnelLen = clamp(u.tunnelTime, 0.0, max(u.cycle - 0.2, 0.0));
  let rest = max(u.cycle - tunnelLen, 0.0);
  let accel = rest * 0.48;
  let fIn = rest * 0.10;
  let fOut = rest * 0.10;
  let decel = rest * 0.32;

  let tA = accel;
  let tB = tA + fIn;
  let tC = tB + tunnelLen;
  let tD = tC + fOut;
  let tE = tD + decel;

  let period = max(tE + u.pause, 0.0001);
  let clock = u.time + u.start;
  let loops = select(0.0, floor(clock / period), u.repeats > 0.5);
  let lt = clock - loops * period;

  let accelDist = accel * 0.25;
  let base = accelDist + fIn + 3.2 * (tunnelLen + fOut);
  let wEnd = base + decel / 3.5;

  var warped = wEnd;
  if (lt < tA) {
    let k = select(1.0, lt / accel, accel > 0.0);
    warped = accel * pow(k, 4.0) * 0.25;
  } else if (lt < tB) {
    warped = accelDist + (lt - tA);
  } else if (lt < tD) {
    warped = accelDist + fIn + 3.2 * (lt - tB);
  } else if (lt < tE) {
    let k = select(1.0, (lt - tD) / decel, decel > 0.0);
    warped = base + decel * (1.0 - pow(1.0 - k, 3.5)) / 3.5;
  }
  let warpT = (0.10 * clock + loops * wEnd + warped) * u.speed;

  let fadeIn = max(fIn * 2.0, 0.12);
  let fadeOut = max(fOut * 2.0, 0.12);
  var stretch = 0.0;
  var flash = 0.0;
  var tunnelMix = 0.0;
  if (lt < tA) {
    let k = select(1.0, lt / accel, accel > 0.0);
    stretch = k * k * k;
  } else if (lt < tB) {
    stretch = 1.0;
    flash = select(1.0, (lt - tA) / fIn, fIn > 0.0);
  } else if (lt < tC) {
    stretch = 1.0;
    tunnelMix = 1.0;
    flash = max(0.0, 1.0 - (lt - tB) / fadeIn);
  } else if (lt < tD) {
    stretch = 1.0;
    tunnelMix = 1.0;
    flash = select(1.0, (lt - tC) / fOut, fOut > 0.0);
  } else if (lt < tE) {
    let k = select(1.0, (lt - tD) / decel, decel > 0.0);
    stretch = pow(1.0 - k, 2.5);
    flash = max(0.0, 1.0 - (lt - tD) / fadeOut);
  }

  let tintC = u.tint.rgb;
  let starC = u.starTint.rgb;
  let coreC = u.core.rgb;
  let flashC = u.flare.rgb * vec3<f32>(1.03, 1.03, 1.06);

  var p = (2.0 * position - size) / size.y;
  p = p + vec2<f32>(sin(clock * 43.7), cos(clock * 37.3)) * 0.006 * (stretch * 0.7 + tunnelMix * 0.35);

  let r = length(p);
  let a = atan2(p.y, p.x);
  let a01 = a / HS_TAU + 0.5;

  let sc = hs_starField(r, a01, clock, stretch, warpT, tintC, starC, coreC,
                        u.stars, u.starDensity, u.starLayers, u.starSize, u.starLength,
                        u.starSpeed, u.starSpread, u.twinkle, u.warpGlow);

  var tc = vec3<f32>(0.0);
  if (tunnelMix > 0.0) {
    tc = hs_pickTunnel(i32(u.style + 0.5), r, a, a01, warpT, tintC, coreC,
                       u.tunnelBright, u.tunnelGlow);
  }

  var col = mix(sc, tc, tunnelMix) + sc * tunnelMix * 0.22;
  col = col * (1.0 - u.vignette * hs_sstep(0.85, 1.5, r));
  col = mix(col, flashC, clamp(flash, 0.0, 1.0));
  col = 1.0 - exp(-col * u.exposure);
  col = pow(max(col, vec3<f32>(0.0)), vec3<f32>(0.85));
  return vec4<f32>(col, 1.0);
}
