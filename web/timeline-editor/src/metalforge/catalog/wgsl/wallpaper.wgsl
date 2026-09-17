// wallpaper.wgsl — WebGPU preview of the Mesh01 wallpaper gradient.
//
// A literal transcription of wallpaper.metal (the file the user exports): same
// gradient-noise fbm, same two-stage warp, same palette ramp, grain and
// vignette, same constants. The runner's wrapper hands `wallpaperMain` a
// top-left-origin uv, the same convention as the stitchable MSL — the
// WebGL-style bottom-origin flip both apply lives inside, so a given seed
// renders the exact frame the study app shows.

struct Uniforms {
  size: vec2<f32>,
  time: f32,
  mode: f32,
  scale: f32,
  warp: f32,
  contrast: f32,
  bands: f32,
  rotation: f32,
  lift: f32,
  softness: f32,
  grain: f32,
  vignette: f32,
  seed: f32,
  animate: f32,
  aSpeed: f32,
  aAmount: f32,
  aWaves: f32,
  color1: vec4<f32>,
  color2: vec4<f32>,
  color3: vec4<f32>,
  color4: vec4<f32>,
  color5: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

fn wp_hash2(p: vec2<f32>) -> vec2<f32> {
  let q = vec2<f32>(dot(p, vec2<f32>(127.1, 311.7)), dot(p, vec2<f32>(269.5, 183.3)));
  return fract(sin(q) * 43758.5453) * 2.0 - 1.0;
}

fn wp_hash1(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

// Gradient noise — the study's `noise2`.
fn wp_noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u2 = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dot(wp_hash2(i), f),
        dot(wp_hash2(i + vec2<f32>(1.0, 0.0)), f - vec2<f32>(1.0, 0.0)), u2.x),
    mix(dot(wp_hash2(i + vec2<f32>(0.0, 1.0)), f - vec2<f32>(0.0, 1.0)),
        dot(wp_hash2(i + vec2<f32>(1.0, 1.0)), f - vec2<f32>(1.0, 1.0)), u2.x),
    u2.y,
  );
}

// The study's fbm: 3 octaves, amplitude 0.6, lacunarity 2.1, gain 0.42.
fn wp_fbm(p0: vec2<f32>) -> f32 {
  var p = p0;
  var a = 0.6;
  var s = 0.0;
  for (var i = 0; i < 3; i = i + 1) {
    s = s + a * wp_noise(p);
    p = p * 2.1;
    a = a * 0.42;
  }
  return s;
}

// Five-stop palette ramp, dark → bright — the study's `pal()`, verbatim.
fn wp_pal(t0: f32) -> vec3<f32> {
  let t = clamp(t0, 0.0, 1.0);
  var c = mix(u.color1.rgb, u.color2.rgb, smoothstep(0.00, 0.46, t));
  c = mix(c, u.color3.rgb, smoothstep(0.44, 0.76, t));
  c = mix(c, u.color4.rgb, smoothstep(0.74, 0.93, t));
  c = mix(c, u.color5.rgb, smoothstep(0.92, 1.00, t));
  return c;
}

fn wallpaperMain(uv01: vec2<f32>) -> vec4<f32> {
  let res = max(u.size, vec2<f32>(1.0));
  // The design counts rows from the bottom (WebGL); flip to match.
  let fc = vec2<f32>(uv01.x * res.x, res.y - uv01.y * res.y);
  let uv = (fc - 0.5 * res) / res.y;

  // Softness modulates zoom and warp exactly as the study's Look does.
  let soft = clamp(u.softness, 0.0, 1.0);
  let sc = u.scale * (1.05 - soft * 0.55);
  let wa = u.warp * (0.35 + soft * 0.7);
  let th = radians(u.rotation);
  // Wave — an in-place travelling undulation of the FIELD's sampling
  // coordinate, like fabric: nothing scrolls, and grain/vignette below stay
  // locked to the screen. Off skips this entirely = the study's exact still.
  var uvw = uv;
  if (u.animate > 0.5) {
    let ts = u.time * u.aSpeed;
    uvw = uvw + u.aAmount * vec2<f32>(sin(ts + uv.y * u.aWaves),
                                      cos(ts * 0.77 + uv.x * u.aWaves));
  }
  let p = vec2<f32>(cos(th) * uvw.x + sin(th) * uvw.y,
                    -sin(th) * uvw.x + cos(th) * uvw.y) * sc + vec2<f32>(u.seed);

  let q = vec2<f32>(wp_fbm(p), wp_fbm(p + vec2<f32>(3.7, 1.3)));
  let r = vec2<f32>(wp_fbm(p + wa * q + vec2<f32>(1.7, 9.2)),
                    wp_fbm(p + wa * q + vec2<f32>(8.3, 2.8)));
  let f = wp_fbm(p + wa * r);

  var t: f32;
  if (u.mode < 0.5) {
    // Bloom — soft pools of light, with a rolled shoulder above 0.78.
    t = 0.46 + f * u.contrast * 1.9;
    let k = t - 0.78;
    if (k > 0.0) { t = 0.78 + k / (1.0 + k * 1.6); }
    t = pow(clamp(t, 0.0, 1.0), 1.35);
  } else {
    // Flow — repeating silk bands, shouldered above 0.72.
    t = 0.5 + 0.5 * sin(f * 6.2831 * u.bands * 1.7 + u.seed * 2.0);
    t = pow(clamp(t, 0.0, 1.0), u.contrast);
    let k = t - 0.72;
    if (k > 0.0) { t = 0.72 + k / (1.0 + k * 0.6); }
  }

  var col = wp_pal(t + u.lift);

  // Elliptical vignette, weighted for a portrait frame.
  let d = length(uv * vec2<f32>(0.78, 0.52));
  col = col * mix(1.0, 1.0 - smoothstep(0.1, 1.25, d), clamp(u.vignette, 0.0, 1.0));

  // Film grain: 1500 cell-rows per frame height, luminance-weighted, locked
  // to the seed — still, like real film stock.
  let gs = 1500.0 / res.y;
  let g = wp_hash1(floor(fc * gs) + u.seed * 37.0);
  col = col + vec3<f32>((g - 0.5) * clamp(u.grain, 0.0, 1.0) * 0.34 * (0.22 + dot(col, vec3<f32>(0.333, 0.333, 0.333))));

  return vec4<f32>(max(col, vec3<f32>(0.0)), 1.0);
}
