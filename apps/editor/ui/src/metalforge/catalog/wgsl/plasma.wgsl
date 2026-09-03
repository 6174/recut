// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering for every effect. WGSL inserts an
// implicit 4-byte pad after `style` (vec4 align 16) so `c1` lands at
// offset 16 — the packer mirrors this gap.
struct Uniforms {
  size:       vec2<f32>,
  time:       f32,
  style:      f32,
  c1:         vec4<f32>,
  c2:         vec4<f32>,
  c3:         vec4<f32>,
  c4:         vec4<f32>,
  c5:         vec4<f32>,
  scale:      f32,
  intensity:  f32,
  distortion: f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn paHash21(pIn: vec2<f32>) -> f32 {
  let p = vec2<f32>(dot(pIn, vec2<f32>(91.31, 47.79)),
                    dot(pIn, vec2<f32>(31.07, 73.13)));
  return fract(sin(p.x + p.y) * 19357.713);
}

fn paVnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = paHash21(i);
  let b = paHash21(i + vec2<f32>(1.0, 0.0));
  let c = paHash21(i + vec2<f32>(0.0, 1.0));
  let d = paHash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn paFbm2(p: vec2<f32>) -> f32 {
  var v = paVnoise(p) * 0.6;
  v = v + paVnoise(p * 2.0) * 0.4;
  return v - 0.5;
}

fn paFbm3(p: vec2<f32>) -> f32 {
  var v = paVnoise(p) * 0.5;
  v = v + paVnoise(p * 2.0) * 0.3;
  v = v + paVnoise(p * 4.0) * 0.2;
  return v - 0.5;
}

fn paPal5(tIn: f32, c1: vec3<f32>, c2: vec3<f32>, c3: vec3<f32>, c4: vec3<f32>, c5: vec3<f32>) -> vec3<f32> {
  let t = clamp(tIn, 0.0, 1.0);
  if (t < 0.25) { return mix(c1, c2, smoothstep(0.0, 0.25, t)); }
  if (t < 0.5)  { return mix(c2, c3, smoothstep(0.25, 0.5, t)); }
  if (t < 0.75) { return mix(c3, c4, smoothstep(0.5, 0.75, t)); }
  return mix(c4, c5, smoothstep(0.75, 1.0, t));
}

fn paPrism(pp: vec2<f32>, d: vec2<f32>, t: f32, distortion: f32) -> f32 {
  return sin(dot(pp, d) * 3.0 + paFbm2(pp * 1.5) * distortion * 3.0 + t * 0.4);
}

fn paSpectrum(pp: vec2<f32>, d: vec2<f32>, t: f32, distortion: f32) -> f32 {
  return sin(dot(pp, d) * 2.4 + paFbm3(pp * 1.3 + t * 0.07) * distortion * 4.0 + t * 0.45);
}

fn plasmaAnim(uv01: vec2<f32>) -> vec4<f32> {
  let res    = u.size;
  let aspect = res.x / res.y;
  var p      = uv01 - vec2<f32>(0.5);
  p.x        = p.x * aspect;
  p          = p * u.scale;

  let time   = u.time;
  let styleI = i32(u.style);
  let cc1    = u.c1.rgb;
  let cc2    = u.c2.rgb;
  let cc3    = u.c3.rgb;
  let cc4    = u.c4.rgb;
  let cc5    = u.c5.rgb;

  if (styleI == 1) {
    let a  = time * 0.3;
    let d  = vec2<f32>(cos(a), sin(a));
    let v1 = paPrism(p + vec2<f32>( 0.025, 0.0), d, time, u.distortion);
    let v2 = paPrism(p,                          d, time, u.distortion);
    let v3 = paPrism(p + vec2<f32>(-0.025, 0.0), d, time, u.distortion);
    let ca = paPal5(v1 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    let cb = paPal5(v2 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    let cc = paPal5(v3 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    let col = vec3<f32>(ca.r, cb.g, cc.b) * u.intensity;
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.5)), 1.0);
  }
  if (styleI == 2) {
    let a  = time * 0.22 + 1.57;
    let d  = vec2<f32>(cos(a), sin(a));
    let v1 = paSpectrum(p + vec2<f32>(0.0,  0.045), d, time, u.distortion);
    let v2 = paSpectrum(p,                          d, time, u.distortion);
    let v3 = paSpectrum(p + vec2<f32>(0.0, -0.045), d, time, u.distortion);
    let ca = paPal5(v1 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    let cb = paPal5(v2 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    let cc = paPal5(v3 * 0.5 + 0.5, cc1, cc2, cc3, cc4, cc5);
    let col = vec3<f32>(ca.r, cb.g, cc.b) * u.intensity * 1.15;
    return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.6)), 1.0);
  }
  if (styleI == 3) {
    let pp = p * 1.3;
    var v: f32 = 0.0;
    v = v + sin(pp.x * 2.5 + time * 0.6);
    v = v + sin(pp.y * 3.0 + time * 0.8);
    v = v + sin(length(pp) * 2.0 - time * 0.5);
    v = v + paFbm3(pp * 2.0 + vec2<f32>(time * 0.18)) * u.distortion * 3.0;
    v = (v + 4.0) * 0.125;
    v = pow(clamp(v, 0.0, 1.0), 1.6) * u.intensity;
    var col = paPal5(v, cc1, cc2, cc3, cc4, cc5);
    col = col + vec3<f32>(pow(v, 6.0) * 0.55);
    return vec4<f32>(col, 1.0);
  }
  if (styleI == 4) {
    let t      = time * 0.7;
    let breath = 0.5 + 0.5 * sin(time * 0.5);
    var v: f32 = 0.0;
    v = v + sin(p.x * 1.8 + t);
    v = v + sin(p.y * 2.2 + t * 1.1);
    v = v + sin((p.x + p.y) * 1.0 + t * 0.8);
    v = v + paFbm3(p * 1.5 + vec2<f32>(t * 0.15)) * u.distortion * 2.0;
    v = (v + 3.5) * 0.143;
    v = clamp(v * u.intensity * (0.7 + 0.6 * breath), 0.0, 1.0);
    var col = paPal5(v, cc1, cc2, cc3, cc4, cc5);
    col = col + vec3<f32>(pow(v, 4.0) * 0.35 * breath);
    return vec4<f32>(col, 1.0);
  }

  // styleI == 0 — Solar.
  var v: f32 = 0.0;
  v = v + sin(p.x * 2.1 + time * 0.7);
  v = v + sin(p.y * 2.5 + time * 0.9);
  v = v + sin((p.x + p.y) * 1.4 + time * 0.5);
  v = v + paFbm3(p * 2.0 + vec2<f32>(time * 0.18)) * u.distortion * 2.0;
  v = (v + 4.0) * 0.125;
  v = clamp(v * u.intensity, 0.0, 1.0);
  var col = paPal5(v, cc1, cc2, cc3, cc4, cc5);
  col = col + vec3<f32>(pow(v, 4.0) * 0.4);
  return vec4<f32>(col, 1.0);
}
