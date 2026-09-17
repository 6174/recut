// Smoke — rising 5-octave value-noise plume.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering. WGSL pads after `amount` to put
// `bgColor` on a 16-byte boundary — the packer mirrors that gap.
struct Uniforms {
  size:       vec2<f32>,
  time:       f32,
  speed:      f32,
  scaleX:     f32,
  scaleY:     f32,
  sharpness:  f32,
  fade:       f32,
  amount:     f32,
  bgColor:    vec4<f32>,
  smokeColor: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn smHash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5);
}

fn smNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = smHash(i);
  let b = smHash(i + vec2<f32>(1.0, 0.0));
  let c = smHash(i + vec2<f32>(0.0, 1.0));
  let d = smHash(i + vec2<f32>(1.0, 1.0));
  let uu = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, uu.x), mix(c, d, uu.x), uu.y);
}

fn smFbm(pIn: vec2<f32>) -> f32 {
  var p = pIn;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 5; i = i + 1) {
    v = v + a * smNoise(p);
    p = p * 2.0;
    a = a * 0.5;
  }
  return v;
}

fn smokeAnim(uv01: vec2<f32>) -> vec4<f32> {
  // Rising motion: the sample window slides along y with time.
  let p = vec2<f32>(uv01.x * u.scaleX, uv01.y * u.scaleY - u.time * u.speed);
  let n = smFbm(p);

  // Thins out along y, then a gamma curve tightens the plume's edge.
  var density = n * (1.0 - smoothstep(0.0, max(u.fade, 0.0001), uv01.y));
  density = pow(max(density, 0.0), max(u.sharpness, 0.0001)) * u.amount;

  let col = mix(u.bgColor.rgb, u.smokeColor.rgb, clamp(density, 0.0, 1.0));
  return vec4<f32>(col, 1.0);
}
