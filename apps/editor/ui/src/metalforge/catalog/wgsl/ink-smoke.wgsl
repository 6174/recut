// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering for every effect. WGSL pads 4 bytes
// before `ink1` so the vec4 sits on its 16-byte alignment — the packer mirrors
// that gap.
struct Uniforms {
  size:      vec2<f32>,
  time:      f32,
  speed:     f32,
  scale:     f32,
  warp:      f32,
  highlight: f32,
  ink1:      vec4<f32>,
  ink2:      vec4<f32>,
  ink3:      vec4<f32>,
  ink4:      vec4<f32>,
  glow:      vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn ink_hash21(p0: vec2<f32>) -> f32 {
  var p = fract(p0 * vec2<f32>(123.34, 456.21));
  p = p + vec2<f32>(dot(p, p + vec2<f32>(45.32)));
  return fract(p.x * p.y);
}

fn ink_vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (vec2<f32>(3.0) - 2.0 * f);
  let a = ink_hash21(i);
  let b = ink_hash21(i + vec2<f32>(1.0, 0.0));
  let c = ink_hash21(i + vec2<f32>(0.0, 1.0));
  let d = ink_hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn ink_fbm(p0: vec2<f32>) -> f32 {
  var p = p0;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 5; i = i + 1) {
    v = v + a * ink_vnoise(p);
    p = p * 2.0;
    a = a * 0.5;
  }
  return v;
}

fn inkSmoke(uv01: vec2<f32>) -> vec4<f32> {
  let res = u.size;
  let uv  = (uv01 * 2.0 - vec2<f32>(1.0)) * res / min(res.x, res.y);

  let t = u.time * u.speed * 0.2;
  let p = uv * max(u.scale, 0.0001);

  let q  = vec2<f32>(ink_fbm(p + vec2<f32>(t * 0.4, t * 0.3)),
                     ink_fbm(p + vec2<f32>(t * 0.2, -t * 0.4)));
  let r2 = vec2<f32>(ink_fbm(p + q * u.warp + vec2<f32>(1.7, 9.2) + vec2<f32>(t * 0.15)),
                     ink_fbm(p + q * u.warp + vec2<f32>(8.3, 2.8) - vec2<f32>(t * 0.1)));
  let f  = ink_fbm(p + r2 * 2.0);

  var col = mix(u.ink1.rgb, u.ink2.rgb, clamp(f * 2.0, 0.0, 1.0));
  col     = mix(col, u.ink3.rgb, clamp(q.x * 1.5, 0.0, 1.0));
  col     = mix(col, u.ink4.rgb, clamp(r2.y * 0.8, 0.0, 1.0));

  let wisp = pow(clamp(f * 1.5, 0.0, 1.0), 3.0);
  col      = col + u.glow.rgb * wisp * u.highlight;

  return vec4<f32>(col, 1.0);
}
