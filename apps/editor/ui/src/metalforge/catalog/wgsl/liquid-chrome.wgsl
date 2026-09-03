// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering for every effect. WGSL inserts implicit
// padding before `shadow` (vec4 align 16) — the packer mirrors that gap.
struct Uniforms {
  size:         vec2<f32>,
  time:         f32,
  speed:        f32,
  scale:        f32,
  warp:         f32,
  contrast:     f32,
  specPower:    f32,
  specStrength: f32,
  tintStrength: f32,
  shadow:       vec4<f32>,
  silver:       vec4<f32>,
  highlight:    vec4<f32>,
  tint:         vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn lcHash(pIn: vec2<f32>) -> f32 {
  var p = fract(pIn * vec2<f32>(123.34, 456.21));
  p = p + vec2<f32>(dot(p, p + 45.32));
  return fract(p.x * p.y);
}

fn lcNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = lcHash(i);
  let b = lcHash(i + vec2<f32>(1.0, 0.0));
  let c = lcHash(i + vec2<f32>(0.0, 1.0));
  let d = lcHash(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn liquidChromeAnim(uv01: vec2<f32>) -> vec4<f32> {
  let size = u.size;
  // Reconstruct the MSL `position` from the runner's normalized uv, then
  // recreate the same aspect-corrected centered coords as the .metal file.
  let position = uv01 * size;
  let uv = (position * 2.0 - size) / max(min(size.x, size.y), 1.0);

  let t = u.time * u.speed;

  let p  = uv * max(u.scale, 0.0001);
  let n1 = lcNoise(p + vec2<f32>(t, t * 0.6));
  let n2 = lcNoise(p + n1 * u.warp + vec2<f32>(-t * 0.4, t * 0.3));
  let n3 = lcNoise(p * 1.5 + n2 * u.warp + vec2<f32>(t * 0.2, -t * 0.5));

  var chrome = clamp(n3 * 0.5 + 0.5, 0.0, 1.0);
  chrome = pow(chrome, max(u.contrast, 0.001));

  let sh = u.shadow.rgb;
  let sv = u.silver.rgb;
  let hl = u.highlight.rgb;
  let tn = u.tint.rgb;

  var col = mix(sh, sv, chrome);
  col = mix(col, hl, smoothstep(0.8, 0.98, chrome));
  col = col + tn * smoothstep(0.3, 0.6, n1) * u.tintStrength;

  let spec = pow(max(chrome, 0.0), max(u.specPower, 0.001));
  col = col + vec3<f32>(0.6, 0.6, 0.8) * spec * u.specStrength;

  return vec4<f32>(col, 1.0);
}
