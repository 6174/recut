// Field order mirrors `mslArgOrder` in config.ts. WGSL inserts implicit
// padding before each vec4 (align 16) — the runner's uniform packer mirrors
// those gaps. All scalar params are tightly packed before the colors.
struct Uniforms {
  size:          vec2<f32>,
  time:          f32,
  speed:         f32,
  layers:        f32,
  baseScale:     f32,
  scaleStep:     f32,
  density:       f32,
  starSize:      f32,
  twinkleSpeed:  f32,
  twinkleAmount: f32,
  starColor:     vec4<f32>,
  background:    vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn sf_hash1(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}
fn sf_hash2(p: vec2<f32>) -> vec2<f32> {
  let a = fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
  let b = fract(sin(dot(p, vec2<f32>(269.5, 183.3))) * 43758.5453);
  return vec2<f32>(a, b);
}

fn starfield(uv01: vec2<f32>) -> vec4<f32> {
  // The runner's vertex shader already flipped y so uv01 matches Metal's
  // top-left-origin screen-space — same as `position / size` in MSL.
  let uv = uv01;

  let count  = max(1, min(i32(u.layers), 8));
  let thresh = clamp(1.0 - u.density, 0.0, 1.0);
  let ssz    = max(u.starSize, 0.001);
  let amt    = clamp(u.twinkleAmount, 0.0, 1.0);

  let starRGB = u.starColor.rgb;
  var col     = vec3<f32>(0.0);

  for (var layer: i32 = 0; layer < count; layer = layer + 1) {
    let fl    = f32(layer);
    let scale = max(u.baseScale + fl * u.scaleStep, 1.0);
    let lspd  = (0.03 + fl * 0.02) * u.speed;
    let bri   = max(0.0, 1.0 - fl * 0.25);

    var st     = uv * scale;
    st.y       = st.y + u.time * lspd * scale;
    let cell   = floor(st);
    let f      = fract(st);

    let h = sf_hash1(cell);
    if (h > thresh) {
      let center  = sf_hash2(cell);
      let d       = length(f - center);
      let twink   = sin(u.time * u.twinkleSpeed + h * 100.0) * amt + (1.0 - amt);
      let falloff = 1.0 - smoothstep(0.0, ssz, d);
      col = col + starRGB * (falloff * twink * bri);
    }
  }

  return vec4<f32>(u.background.rgb + col, 1.0);
}
