// shape.wgsl — WebGPU preview of the 3D shape spinners (all shapes share this).
//
// A hand-written mirror of shape.metal's shape_vertex / shape_fragment. The
// ShapeSim (effects/shapes/preview.ts) owns the vertex buffer (interleaved
// position/bary/mask for the selected shape), computes the MVP + back-to-front
// face order on the CPU each frame, and drives this pipeline directly —
// kind: "mesh3d" forks in lib/preview/runner.ts. Keep in lockstep with
// shape.metal. Fill and edge are independent colours.

struct Uniforms {
  mvp: mat4x4<f32>,
  fill: vec4<f32>,     // face colour, straight alpha (rgb, faceOpacity)
  edge: vec4<f32>,     // edge colour, opaque (rgb, 1)
  borderPx: f32,       // border thickness in drawable pixels
  gridDensity: f32,    // grid lines per object-space unit (0 = off)
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) bary: vec3<f32>,
  @location(1) mask: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

@vertex
fn vs_main(@location(0) position: vec3<f32>,
           @location(1) bary: vec3<f32>,
           @location(2) mask: vec3<f32>,
           @location(3) uv: vec2<f32>) -> VOut {
  var o: VOut;
  o.pos = u.mvp * vec4<f32>(position, 1.0);
  o.bary = bary;
  o.mask = mask;   // identical across the 3 verts of a triangle
  o.uv = uv;
  return o;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  // Pixel distance to each triangle edge; push hidden (diagonal) edges away.
  let b = in.bary;
  let fw = max(fwidth(b), vec3<f32>(1e-5));
  let dpx = b / fw + (vec3<f32>(1.0) - in.mask) * 1e4;
  let dist = min(dpx.x, min(dpx.y, dpx.z));
  var lineMix = 1.0 - smoothstep(u.borderPx - 0.75, u.borderPx + 0.75, dist);

  // Optional interior grid across the face (in per-face UV space).
  if (u.gridDensity > 0.0) {
    let g = in.uv * u.gridDensity;
    let gw = max(fwidth(g), vec2<f32>(1e-5));
    let gd = abs(fract(g - 0.5) - 0.5) / gw;
    let gridDist = min(gd.x, gd.y);
    let gridMix = 1.0 - smoothstep(u.borderPx - 0.75, u.borderPx + 0.75, gridDist);
    lineMix = max(lineMix, gridMix);
  }

  let col = mix(u.fill, u.edge, lineMix);

  // Premultiplied output — composited "over" the cleared background.
  return vec4<f32>(col.rgb * col.a, col.a);
}
