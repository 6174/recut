// Glass Orb — unified WebGPU preview. Nine raymarched wavy-glass orbs selected by
// u.style (0-based option index). Every style is the same algorithm: ray vs a
// bounding sphere, sphere-trace a displaced sphere SDF (length(p) - 1 - waveDisp),
// then march refracted THROUGH the body to the back surface for Beer-Lambert
// transmission (deep coloured valleys) plus a Fresnel rim and two crisp white
// speculars. Styles differ only in the displacement personality (waveDisp), the
// glass tint, the light rig, the absorption colour, and the safe-step constants.
//
// Hand-ported to stay mathematically equivalent to the per-style
// glass-orb-<style>.metal exports. At the default knobs (speed/waveFreq/amplitude
// = 1) each style reproduces its original OrbWave-family orb exactly.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic uniform
// packer lines up: size, time, then style/speed/waveFreq/amplitude (f32), then
// tint (vec4 align 16, lands at byte 32 after a 4-byte pad), depth, highlight.
struct Uniforms {
  size:      vec2<f32>,
  time:      f32,
  style:     f32,
  speed:     f32,
  waveFreq:  f32,
  amplitude: f32,
  tint:      vec4<f32>,
  depth:     vec4<f32>,
  highlight: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

// Ray vs. bounding sphere — (near, far) hits, or (-1,-1) on a miss.
fn goSph(ro: vec3<f32>, rd: vec3<f32>, rad: f32) -> vec2<f32> {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - rad * rad;
  let h = b * b - c;
  if (h < 0.0) { return vec2<f32>(-1.0); }
  let hs = sqrt(h);
  return vec2<f32>(-b - hs, -b + hs);
}

// Per-style surface displacement. `fr` multiplies the ripple frequency, `amp`
// scales the depth — both 1.0 at default.
fn goWaveDisp(p: vec3<f32>, t: f32, fr: f32, amp: f32, style: i32) -> f32 {
  var disp = 0.0;
  if (style == 1) {                                   // Ember
    let q = normalize(p) * 3.0;
    var uu = q.x * 0.90 + q.y * 0.45 + q.z * 0.25;
    uu = uu + 0.35 * sin(q.y * 1.5 + t * 0.50);
    uu = uu + 0.18 * sin(q.z * 2.1 - t * 0.55);
    var vv = q.z * 0.70 + q.x * 0.55 + q.y * 0.45;
    vv = vv + 0.30 * sin(q.x * 1.6 - t * 0.55);
    vv = vv + 0.16 * sin(q.y * 2.0 + t * 0.60);
    disp = 0.040 * sin(uu * 5.5 * fr) + 0.032 * sin(vv * 5.0 * fr);
  } else if (style == 2) {                            // Mint
    let q = normalize(p) * 4.0;
    var uu = q.x * 0.85 + q.y * 0.50 + q.z * 0.20;
    uu = uu + 0.25 * sin(q.y * 1.1 + t * 0.28);
    uu = uu + 0.15 * sin(q.z * 1.9 - t * 0.30);
    var vv = q.z * 0.70 + q.x * 0.55 + q.y * 0.45;
    vv = vv + 0.22 * sin(q.x * 1.3 - t * 0.30);
    vv = vv + 0.13 * sin(q.y * 2.0 + t * 0.32);
    disp = 0.026 * sin(uu * 9.0 * fr) + 0.022 * sin(vv * 8.5 * fr);
  } else if (style == 3) {                            // Frost
    let q = normalize(p) * 3.5;
    var uu = q.x * 0.85 + q.y * 0.50 + q.z * 0.20;
    uu = uu + 0.30 * sin(q.y * 1.2 + t * 0.20);
    uu = uu + 0.18 * sin(q.z * 2.1 - t * 0.25);
    uu = uu + 0.10 * sin(q.y * 3.5 + q.z * 2.8 + t * 0.18);
    var vv = q.z * 0.70 + q.x * 0.55 + q.y * 0.45;
    vv = vv + 0.28 * sin(q.x * 1.3 - t * 0.22);
    vv = vv + 0.16 * sin(q.y * 2.4 + t * 0.30);
    vv = vv + 0.09 * sin(q.x * 3.2 + q.z * 2.5 - t * 0.20);
    disp = 0.038 * sin(uu * 7.5 * fr) + 0.030 * sin(vv * 7.0 * fr);
  } else if (style == 4) {                            // Sky
    let q = normalize(p) * 3.0;
    var uu = q.x * 0.85 + q.y * 0.50 + q.z * 0.20;
    uu = uu + 0.28 * sin(q.y * 1.0 + t * 0.18);
    uu = uu + 0.14 * sin(q.z * 1.6 - t * 0.22);
    var vv = q.z * 0.70 + q.x * 0.55 + q.y * 0.45;
    vv = vv + 0.25 * sin(q.x * 1.1 - t * 0.20);
    vv = vv + 0.12 * sin(q.y * 1.7 + t * 0.24);
    disp = 0.022 * sin(uu * 6.5 * fr) + 0.018 * sin(vv * 6.0 * fr);
  } else if (style == 5) {                            // Storm
    let q = normalize(p) * 3.5;
    var uu = q.x * 0.85 + q.y * 0.50 + q.z * 0.20;
    uu = uu + 0.32 * sin(q.y * 1.6 + t * 0.50);
    uu = uu + 0.20 * sin(q.z * 2.3 - t * 0.60);
    var vv = q.z * 0.70 + q.x * 0.55 + q.y * 0.45;
    vv = vv + 0.28 * sin(q.x * 1.7 + t * 0.55);
    vv = vv + 0.18 * sin(q.y * 2.4 - t * 0.70);
    disp = 0.042 * sin(uu * 6.5 * fr)
         + 0.034 * sin(vv * 6.0 * fr)
         + 0.018 * sin((uu + vv) * 8.5 * fr + t * 0.4);
  } else if (style == 6) {                            // Coral
    let q = normalize(p) * 3.3;
    var uu = q.x * 0.85 + q.y * 0.50 + q.z * 0.20;
    uu = uu + 0.32 * sin(q.y * 1.2 + t * 0.30);
    uu = uu + 0.18 * sin(q.z * 1.8 - t * 0.28);
    var vv = -q.x * 0.55 + q.z * 0.65 + q.y * 0.40;  // crossed band
    vv = vv + 0.28 * sin(q.x * 1.3 + t * 0.35);
    vv = vv + 0.16 * sin(q.y * 2.0 - t * 0.25);
    disp = 0.040 * sin(uu * 6.5 * fr) + 0.034 * sin(vv * 6.0 * fr);
  } else if (style == 7) {                            // Ice
    let q = normalize(p) * 4.0;
    var uu = q.x * 0.85 + q.y * 0.50 + q.z * 0.20;
    uu = uu + 0.22 * sin(q.y * 1.4 + t * 0.22);
    uu = uu + 0.13 * sin(q.z * 2.3 - t * 0.18);
    var vv = q.z * 0.70 + q.x * 0.55 + q.y * 0.45;
    vv = vv + 0.20 * sin(q.x * 1.5 - t * 0.22);
    vv = vv + 0.12 * sin(q.y * 2.5 + t * 0.20);
    disp = 0.030 * sin(uu * 10.0 * fr) + 0.025 * sin(vv * 9.5 * fr);
  } else if (style == 8) {                            // Magenta
    let q = normalize(p) * 4.0;
    var uu = q.x * 0.85 + q.y * 0.50 + q.z * 0.20;
    uu = uu + 0.25 * sin(q.y * 1.4 + t * 0.55);
    uu = uu + 0.14 * sin(q.z * 2.0 - t * 0.45);
    var vv = q.z * 0.70 + q.x * 0.55 + q.y * 0.45;
    vv = vv + 0.22 * sin(q.x * 1.5 - t * 0.50);
    vv = vv + 0.13 * sin(q.y * 2.2 + t * 0.45);
    disp = 0.030 * sin(uu * 9.5 * fr + t * 0.45) + 0.025 * sin(vv * 9.0 * fr - t * 0.40);
  } else {                                            // Wave (OrbWave) — style 0
    let q = normalize(p) * 3.5;
    var uu = q.x * 0.85 + q.y * 0.50 + q.z * 0.20;
    uu = uu + 0.32 * sin(q.y * 1.0 + t * 0.30);
    uu = uu + 0.22 * sin(q.z * 1.3 - t * 0.35);
    uu = uu + 0.14 * sin(q.y * 1.9 + q.z * 1.6 + t * 0.25);
    var vv = q.z * 0.70 + q.x * 0.55 + q.y * 0.45;
    vv = vv + 0.30 * sin(q.x * 1.2 - t * 0.32);
    vv = vv + 0.20 * sin(q.y * 1.5 + t * 0.45);
    vv = vv + 0.14 * sin(q.z * 1.9 + q.x * 1.6 + t * 0.28);
    disp = 0.042 * sin(uu * 7.0 * fr) + 0.034 * sin(vv * 6.5 * fr);
  }
  return disp * amp;
}

fn goMap(p: vec3<f32>, t: f32, fr: f32, amp: f32, style: i32) -> f32 {
  return length(p) - 1.0 - goWaveDisp(p, t, fr, amp, style);
}

fn goNormal(p: vec3<f32>, t: f32, e: f32, fr: f32, amp: f32, style: i32) -> vec3<f32> {
  let k = vec2<f32>(1.0, -1.0);
  return normalize(
    k.xyy * goMap(p + k.xyy * e, t, fr, amp, style) +
    k.yyx * goMap(p + k.yyx * e, t, fr, amp, style) +
    k.yxy * goMap(p + k.yxy * e, t, fr, amp, style) +
    k.xxx * goMap(p + k.xxx * e, t, fr, amp, style)
  );
}

// Sum of a style's final-band amplitudes — sizes the bounding sphere so the
// displaced surface always fits inside it, at any amplitude.
fn goAmpSum(style: i32) -> f32 {
  if (style == 1) { return 0.072; }
  if (style == 2) { return 0.048; }
  if (style == 3) { return 0.068; }
  if (style == 4) { return 0.040; }
  if (style == 5) { return 0.094; }
  if (style == 6) { return 0.074; }
  if (style == 7) { return 0.055; }
  if (style == 8) { return 0.055; }
  return 0.076;
}

// Base Lipschitz divisor for safe sphere-tracing of each style's displacement.
fn goLip(style: i32) -> f32 {
  if (style == 1) { return 2.5; }
  if (style == 2) { return 3.0; }
  if (style == 3) { return 2.8; }
  if (style == 4) { return 2.2; }
  if (style == 5) { return 3.0; }
  if (style == 6) { return 2.5; }
  if (style == 7) { return 3.5; }
  if (style == 8) { return 3.5; }
  return 2.0;
}

fn goLight1(style: i32) -> vec3<f32> {
  if (style == 1) { return normalize(vec3<f32>(0.55, 0.80, 0.55)); }   // Ember lit from the right
  if (style == 2) { return normalize(vec3<f32>(-0.45, 0.85, 0.55)); }
  if (style == 6) { return normalize(vec3<f32>(-0.50, 0.85, 0.55)); }
  if (style == 7) { return normalize(vec3<f32>(-0.50, 0.85, 0.55)); }
  if (style == 8) { return normalize(vec3<f32>(-0.50, 0.85, 0.55)); }
  return normalize(vec3<f32>(-0.55, 0.85, 0.55));
}

fn goLight2(style: i32) -> vec3<f32> {
  if (style == 1) { return normalize(vec3<f32>(-0.40, 0.30, 0.80)); }
  if (style == 2) { return normalize(vec3<f32>(0.50, 0.30, 0.75)); }
  if (style == 6) { return normalize(vec3<f32>(0.50, 0.30, 0.75)); }
  if (style == 7) { return normalize(vec3<f32>(0.45, 0.30, 0.80)); }
  if (style == 8) { return normalize(vec3<f32>(0.45, 0.30, 0.80)); }
  return normalize(vec3<f32>(0.40, 0.30, 0.80));
}

fn glassOrbAnim(uv01: vec2<f32>) -> vec4<f32> {
  let size = u.size;
  // uv01 * size == the SwiftUI `position` (top-left origin); match the MSL exactly.
  let pos = uv01 * size;
  var uv = (pos - 0.5 * size) / min(size.x, size.y);
  uv = uv * 2.0;

  let style = i32(u.style);
  let fr = u.waveFreq;
  let amp = u.amplitude;
  let t = u.time * u.speed;

  let ro = vec3<f32>(0.0, 0.0, 3.0);
  let rd = normalize(vec3<f32>(uv, -1.8));

  let ampSum = goAmpSum(style);
  let boundRad = 1.0 + ampSum * amp + 0.04;
  let lip = goLip(style) * max(1.0, fr) * max(1.0, amp);

  let hh = goSph(ro, rd, boundRad);
  if (hh.x < 0.0) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }

  var tHit = max(hh.x - 0.02, 0.0);
  let tMax = hh.y + 0.02;
  var hit = false;
  var pHit = vec3<f32>(0.0);
  for (var i = 0; i < 96; i = i + 1) {
    let p = ro + rd * tHit;
    let d = goMap(p, t, fr, amp, style) / lip;
    if (d < 0.0004) { hit = true; pHit = p; break; }
    tHit = tHit + d * 0.85;
    if (tHit > tMax) { break; }
  }
  if (!hit) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }

  let chord = hh.y - hh.x;
  let graze = clamp(1.0 - chord / (2.5 * boundRad), 0.0, 1.0);
  let nEps = mix(0.0015, 0.0070, graze);
  let n = goNormal(pHit, t, nEps, fr, amp, style);
  let v = -rd;
  let ndv = clamp(dot(n, v), 0.0, 1.0);

  let L1 = goLight1(style);
  let L2 = goLight2(style);
  let baseTint = u.tint.rgb * 2.0;
  // Core glow colour -> per-channel absorption: a bright channel is absorbed
  // little, so it survives to the deep valleys. depth = 1 - absorption/4.5.
  let absorption = 4.5 * (1.0 - u.depth.rgb);

  // March refracted into the body to the back surface for Beer-Lambert depth.
  let rIn = refract(rd, n, 1.0 / 1.45);
  var tBack = 0.01;
  var pBack = pHit + rIn * tBack;
  for (var i = 0; i < 32; i = i + 1) {
    pBack = pHit + rIn * tBack;
    let d = goMap(pBack, t, fr, amp, style);
    if (d > -0.0008) { break; }
    tBack = tBack + (-d) / lip * 0.85;
    if (tBack > 3.5) { break; }
  }
  let transmit = exp(-absorption * tBack);

  let nBack = goNormal(pBack, t, nEps, fr, amp, style);
  let bDiff = (dot(nBack, L1) * 0.5 + 0.5) * 0.65
            + (dot(nBack, L2) * 0.5 + 0.5) * 0.40;
  var interior = baseTint * (0.20 + bDiff) * transmit;

  let fres = pow(1.0 - ndv, 3.5);
  interior = interior + baseTint * fres * 0.55;

  let exp1 = mix(380.0, 90.0, graze);
  let exp2 = mix(240.0, 60.0, graze);
  let H1 = normalize(L1 + v);
  let H2 = normalize(L2 + v);
  let spec1 = pow(clamp(dot(n, H1), 0.0, 1.0), exp1);
  let spec2 = pow(clamp(dot(n, H2), 0.0, 1.0), exp2);
  let gloss = pow(clamp(dot(n, H1), 0.0, 1.0), 40.0) * 0.10;

  let hl = u.highlight.rgb;
  var col = interior;
  col = col + hl * spec1 * 6.5;
  col = col + hl * spec2 * 3.0;
  col = col + hl * gloss;

  col = col / (1.0 + col * 0.65);
  return vec4<f32>(col, 1.0);
}
