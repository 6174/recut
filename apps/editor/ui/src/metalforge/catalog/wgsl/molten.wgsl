// Molten — dark crust cracked open over flowing lava.
//
// Field order mirrors `mslArgOrder` in config.ts so the runner's generic
// uniform packer can walk one ordering. The eight floats sit back to back and
// WGSL pads after `vignette` to put `rockColor` on a 16-byte boundary — the
// packer mirrors that gap.
struct Uniforms {
  size:       vec2<f32>,
  time:       f32,
  speed:      f32,
  scale:      f32,
  warp:       f32,
  crack:      f32,
  detail:     f32,
  heat:       f32,
  grain:      f32,
  vignette:   f32,
  rockColor:  vec4<f32>,
  emberColor: vec4<f32>,
  midColor:   vec4<f32>,
  hotColor:   vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn moHash(pIn: vec2<f32>) -> f32 {
  var p = fract(pIn * vec2<f32>(123.34, 456.21));
  p = p + vec2<f32>(dot(p, p + vec2<f32>(45.32)));
  return fract(p.x * p.y);
}

fn moNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = moHash(i);
  let b = moHash(i + vec2<f32>(1.0, 0.0));
  let c = moHash(i + vec2<f32>(0.0, 1.0));
  let d = moHash(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Rotate-and-scale between octaves so the lattice never lines up with itself.
// mat2x2 is column-major, same as the MSL float2x2: col0 = (0.80, 0.60).
fn moFbm(pIn: vec2<f32>, octaves: i32) -> f32 {
  var p = pIn;
  var sum: f32 = 0.0;
  var amp: f32 = 0.5;
  var norm: f32 = 0.0;
  let rot = mat2x2<f32>(0.80, 0.60, -0.60, 0.80);
  for (var i: i32 = 0; i < 5; i = i + 1) {
    if (i >= octaves) { break; }
    sum = sum + amp * moNoise(p);
    norm = norm + amp;
    amp = amp * 0.5;
    p = rot * p * 2.03;
  }
  return sum / max(norm, 0.0001);
}

// A thin bright ridge out of a 0…1 field. Higher sharpness = a crisper, more
// line-like crack; at 1 the ridge spreads into a broad glow.
fn moRidge(value: f32, sharpness: f32) -> f32 {
  let r = 1.0 - abs(value * 2.0 - 1.0);
  return pow(clamp(r, 0.0, 1.0), sharpness);
}

fn moltenAnim(uv01: vec2<f32>) -> vec4<f32> {
  let t = u.time * u.speed;

  // Aspect-corrected, centred, zoomed. The whole crust creeps upward.
  var p = uv01 - vec2<f32>(0.5);
  p.x = p.x * (u.size.x / max(u.size.y, 1.0));
  p = p * max(u.scale, 0.0001);
  p.y = p.y + t * 0.06;

  // Domain warp: two 4-octave fields scrolling in opposite directions.
  let w = vec2<f32>(moFbm(p * 1.1 + vec2<f32>(0.0, t * 0.08), 4),
                    moFbm(p * 1.1 + vec2<f32>(7.7, -t * 0.06), 4));
  let q = p + u.warp * (w - vec2<f32>(0.5));

  let body  = moFbm(q * 1.5, 5);
  let veins = moRidge(moFbm(q * 2.2 + vec2<f32>(3.1), 5), max(u.crack, 0.0001));
  let fine  = moRidge(moFbm(q * 5.0 + vec2<f32>(11.0), 4), max(u.detail, 0.0001));

  var lava = veins * 1.3 + fine * 0.6;
  lava = lava * (0.55 + 0.75 * body);                 // lava pools where the mass is thick
  lava = lava + 0.10 * smoothstep(0.55, 1.0, body);   // faint glow through the crust
  lava = lava * u.heat;

  // Crust shading so the dark parts read as solid rock.
  let shade = 0.35 + 0.65 * moFbm(q * 4.0 + vec2<f32>(21.0), 3);

  var c = u.rockColor.rgb * shade;
  c = mix(c, u.emberColor.rgb, clamp(lava * 1.1, 0.0, 1.0));
  c = mix(c, u.midColor.rgb,   clamp(lava - 0.55, 0.0, 1.0));
  c = mix(c, u.hotColor.rgb,   clamp(lava - 1.15, 0.0, 1.0));
  c = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));

  // Vignette, then film grain — the finishing pass, in that order.
  let d = uv01 - vec2<f32>(0.5);
  c = c * (1.0 - 0.85 * u.vignette * dot(d, d));
  c = c + (moHash(uv01 * 900.0 + vec2<f32>(t)) - 0.5) * 0.015 * u.grain;

  return vec4<f32>(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
