// Grain — a 3x3 colour grid sampled through a time-warped cubic Hermite.
//
// The nine grid colours are real params, so the Style selector is nothing more
// than a set of presets that snap all nine at once — every one stays editable
// afterwards.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering. `color1` is a vec4 (align 16), so WGSL
// inserts implicit padding after `brightness` — the packer mirrors that gap.
struct Uniforms {
  size:       vec2<f32>,
  time:       f32,
  speed:      f32,
  flow:       f32,
  grain:      f32,
  brightness: f32,
  color1:     vec4<f32>,
  color2:     vec4<f32>,
  color3:     vec4<f32>,
  color4:     vec4<f32>,
  color5:     vec4<f32>,
  color6:     vec4<f32>,
  color7:     vec4<f32>,
  color8:     vec4<f32>,
  color9:     vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

// Row-major 3x3 lookup: index = y * 3 + x, clamped to the last cell.
fn ggColor(i: i32) -> vec3<f32> {
  switch (i) {
    case 0:  { return u.color1.rgb; }
    case 1:  { return u.color2.rgb; }
    case 2:  { return u.color3.rgb; }
    case 3:  { return u.color4.rgb; }
    case 4:  { return u.color5.rgb; }
    case 5:  { return u.color6.rgb; }
    case 6:  { return u.color7.rgb; }
    case 7:  { return u.color8.rgb; }
    default: { return u.color9.rgb; }
  }
}

fn ggH00(x: f32) -> f32 { return 2.0 * x * x * x - 3.0 * x * x + 1.0; }
fn ggH10(x: f32) -> f32 { return x * x * x - 2.0 * x * x + x; }
fn ggH01(x: f32) -> f32 { return 3.0 * x * x - 2.0 * x * x * x; }
fn ggH11(x: f32) -> f32 { return x * x * x - x * x; }

fn ggHermite(p0: f32, p1: f32, m0: f32, m1: f32, x: f32) -> f32 {
  return p0 * ggH00(x) + m0 * ggH10(x) + p1 * ggH01(x) + m1 * ggH11(x);
}

fn ggIndex(x: i32, y: i32) -> i32 { return clamp(y * 3 + x, 0, 8); }

fn ggGrid(coords0: vec2<f32>, t: f32) -> vec3<f32> {
  let a = sin(t * 1.0) * 0.5 + 0.5;
  let b = sin(t * 1.5) * 0.5 + 0.5;
  let c = sin(t * 2.0) * 0.5 + 0.5;
  let d = sin(t * 2.5) * 0.5 + 0.5;

  let y0 = mix(a, b, coords0.x);
  let y1 = mix(c, d, coords0.x);
  let x0 = mix(a, c, coords0.y);
  let x1 = mix(b, d, coords0.y);

  // Both hermite calls read the ORIGINAL coords (the MSL writes x first but
  // only reads y afterwards) — keep it that way or the warp desyncs.
  let cx = ggHermite(0.0, 1.0, u.flow * x0, u.flow * x1, coords0.x);
  let cy = ggHermite(0.0, 1.0, u.flow * y0, u.flow * y1, coords0.y);

  let gridCoords = vec2<f32>(cx, cy) * 2.0;   // gridSize - 1
  let idStart = vec2<i32>(gridCoords);
  let idEnd   = vec2<i32>(ceil(gridCoords));

  let factors = smoothstep(vec2<f32>(0.0), vec2<f32>(1.0), fract(gridCoords));

  let r0 = mix(ggColor(ggIndex(idStart.x, idStart.y)), ggColor(ggIndex(idEnd.x, idStart.y)), factors.x);
  let r1 = mix(ggColor(ggIndex(idStart.x, idEnd.y)),   ggColor(ggIndex(idEnd.x, idEnd.y)),   factors.x);
  return mix(r0, r1, factors.y);
}

fn grainAnim(uv01: vec2<f32>) -> vec4<f32> {
  var col = ggGrid(uv01, u.time * u.speed * 0.20) * u.brightness;

  // Cheap film grain, driven by the unwarped uv.
  let x = (uv01.x + 4.0) * (uv01.y + 4.0) * 10.0;
  let g = (((x % 13.0) + 1.0) * ((x % 123.0) + 1.0)) % 0.01 - 0.005;
  col = col + vec3<f32>(g * u.grain);

  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
