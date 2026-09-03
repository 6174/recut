// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering for every effect. WGSL inserts
// implicit padding before `skyColor` (vec4 align 16) to satisfy alignment —
// the packer mirrors those gaps.
struct Uniforms {
  size:       vec2<f32>,
  time:       f32,
  speed:      f32,
  zoom:       f32,
  driftX:     f32,
  driftY:     f32,
  warp:       f32,
  coverage:   f32,
  skyColor:   vec4<f32>,
  cloudColor: vec4<f32>,
  warmTint:   vec4<f32>,
  warmth:     f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn fcHash(pIn: vec2<f32>) -> f32 {
  var p = fract(pIn * vec2<f32>(123.34, 345.45));
  p = p + vec2<f32>(dot(p, p + 34.345));
  return fract(p.x * p.y);
}

fn fcNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = fcHash(i);
  let b = fcHash(i + vec2<f32>(1.0, 0.0));
  let c = fcHash(i + vec2<f32>(0.0, 1.0));
  let d = fcHash(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fcFbm(pIn: vec2<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 5; i = i + 1) {
    v = v + a * fcNoise(p);
    p = p * 2.0;
    a = a * 0.5;
  }
  return v;
}

fn fractalCloudsAnim(uv01: vec2<f32>) -> vec4<f32> {
  let t = u.time * u.speed;

  var uv = uv01;
  uv = uv * max(u.zoom, 0.0001);
  uv = uv + vec2<f32>(t * u.driftX, t * u.driftY);

  let f1 = fcFbm(uv);
  let f2 = fcFbm(uv + f1 * u.warp + vec2<f32>(t * 0.02, t * 0.03));

  let sky   = u.skyColor.rgb;
  let cloud = u.cloudColor.rgb;
  let tint  = u.warmTint.rgb;

  var col = mix(sky, cloud, clamp(f2 + u.coverage, 0.0, 1.0));
  col = col + tint * f1 * u.warmth;

  return vec4<f32>(col, 1.0);
}
