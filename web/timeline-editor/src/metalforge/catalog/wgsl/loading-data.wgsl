struct PV { pos: vec2<f32>, vel: vec2<f32> };
struct NodeStatic {
  home: vec2<f32>,
  radius: f32,
  spawn: f32,
  formStart: f32,
  seed: f32,
  group: u32,
  pad: f32,
};
struct Edge { a: u32, b: u32, rest: f32, activation: f32 };
struct Neighbor { node: u32, edge: u32 };

struct Params {
  viewport: vec2<f32>,
  camPan: vec2<f32>,
  time: f32,
  dt: f32,
  progress: f32,
  repulsion: f32,
  springK: f32,
  centerK: f32,
  damping: f32,
  radialR: f32,
  maxSpeed: f32,
  rotation: f32,
  scale: f32,
  spaceBreath: f32,
  zoom: f32,
  nodeSize: f32,
  lineHalf: f32,
  glow: f32,
  edgeAlpha: f32,
  nodeCount: u32,
  edgeCount: u32,
  _pad0: f32,
  nodeColor: vec4<f32>,
  edgeColor: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> inPV: array<PV>;
@group(0) @binding(1) var<storage, read_write> outPV: array<PV>;
@group(0) @binding(2) var<storage, read> statics: array<NodeStatic>;
@group(0) @binding(3) var<storage, read> edges: array<Edge>;
@group(0) @binding(4) var<storage, read> neighbors: array<Neighbor>;
@group(0) @binding(5) var<storage, read> offsets: array<u32>;
@group(0) @binding(6) var<uniform> P: Params;

const kQuad = array<vec2<f32>, 6>(
  vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
  vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
);

fn rotate2(p: vec2<f32>, a: f32) -> vec2<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
}

@compute @workgroup_size(64)
fn s2_integrate(@builtin(global_invocation_id) gid3: vec3<u32>) {
  let gid = gid3.x;
  if (gid >= P.nodeCount) { return; }

  let me = inPV[gid];
  let st = statics[gid];
  let pos = me.pos;

  let gather = smoothstep(st.formStart, st.formStart + 0.10, P.progress);
  let ball = smoothstep(0.66, 1.00, P.progress);

  var rep = vec2<f32>(0.0, 0.0);
  for (var j: u32 = 0u; j < P.nodeCount; j = j + 1u) {
    if (j == gid) { continue; }
    let d = pos - inPV[j].pos;
    let dist2 = max(dot(d, d), 0.0009);
    let inv = inverseSqrt(dist2);
    let f = P.repulsion / dist2;
    rep = rep + (d * inv) * min(f, 2.0);
  }
  var force = rep * gather;

  let start = offsets[gid];
  let end = offsets[gid + 1u];
  for (var k: u32 = start; k < end; k = k + 1u) {
    let nb = neighbors[k];
    let e = edges[nb.edge];
    let act = smoothstep(e.activation, e.activation + 0.16, P.progress);
    if (act <= 0.0) { continue; }
    let d = inPV[nb.node].pos - pos;
    let dlen = max(length(d), 1e-4);
    let dir = d / dlen;
    force = force + dir * (dlen - e.rest) * P.springK * act;
  }

  let anchor = mix(st.home, vec2<f32>(0.0, 0.0), ball);
  force = force + (anchor - pos) * (P.centerK * gather);

  let r = length(pos);
  if (r > P.radialR) {
    force = force - (pos / max(r, 1e-4)) * (r - P.radialR) * (P.centerK * 8.0) * ball;
  }

  var vel = (me.vel + force * P.dt) * P.damping;
  let sp = length(vel);
  if (sp > P.maxSpeed) { vel = vel * (P.maxSpeed / sp); }

  var outv: PV;
  outv.pos = pos + vel * P.dt;
  outv.vel = vel;
  outPV[gid] = outv;
}

struct EdgeInOut {
  @builtin(position) position: vec4<f32>,
  @location(0) across: f32,
  @location(1) alpha: f32,
  @location(2) color: vec3<f32>,
};

@vertex
fn s2_edge_vertex(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> EdgeInOut {
  let e = edges[iid];

  let grow = smoothstep(e.activation, e.activation + 0.06, P.progress);

  let space = P.scale * P.spaceBreath;
  let aN = (rotate2(inPV[e.a].pos, P.rotation) - P.camPan) * space;
  let bN = (rotate2(inPV[e.b].pos, P.rotation) - P.camPan) * space;
  let bEff = mix(aN, bN, grow);

  let dir = bEff - aN;
  let ln = max(length(dir), 1e-4);
  let t = dir / ln;
  let n = vec2<f32>(-t.y, t.x);

  let q = kQuad[vid];
  let along = q.x * 0.5 + 0.5;
  let across = q.y;
  let halfW = P.lineHalf * P.zoom;

  let posPix = mix(aN, bEff, along) + n * across * halfW;

  var o: EdgeInOut;
  o.position = vec4<f32>(posPix / (0.5 * P.viewport), 0.0, 1.0);
  o.across = across;
  o.alpha = grow * P.edgeAlpha;
  o.color = P.edgeColor.rgb;
  return o;
}

@fragment
fn s2_edge_fragment(in: EdgeInOut) -> @location(0) vec4<f32> {
  let soft = smoothstep(1.0, 0.0, abs(in.across));
  let a = in.alpha * soft;
  return vec4<f32>(in.color * a, a);
}

struct NodeInOut {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) alpha: f32,
  @location(2) color: vec3<f32>,
};

@vertex
fn s2_node_vertex(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> NodeInOut {
  let q = kQuad[vid];
  let s = inPV[iid];
  let st = statics[iid];

  let appear = smoothstep(st.spawn, st.spawn + 0.10, P.progress);
  let radius = st.radius * P.nodeSize * appear * P.zoom;
  let reach = 2.4;

  let space = P.scale * P.spaceBreath;
  let centerPix = (rotate2(s.pos, P.rotation) - P.camPan) * space;
  let cornerPix = centerPix + q * (radius * reach);

  var o: NodeInOut;
  o.position = vec4<f32>(cornerPix / (0.5 * P.viewport), 0.0, 1.0);
  o.local = q * reach;
  o.alpha = appear;
  o.color = P.nodeColor.rgb;
  return o;
}

@fragment
fn s2_node_fragment(in: NodeInOut) -> @location(0) vec4<f32> {
  let d = length(in.local);
  let core = smoothstep(1.0, 0.72, d);
  let glow = exp(-2.4 * d) * 0.55 * P.glow;
  let a = clamp(core + glow * 0.9, 0.0, 1.0) * in.alpha;
  let col = in.color * (0.55 + 0.55 * core) + in.color * glow * 0.5;
  return vec4<f32>(col * a, a);
}
