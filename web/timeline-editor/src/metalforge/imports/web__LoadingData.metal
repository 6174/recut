#include <metal_stdlib>
using namespace metal;

struct S2PV { float2 pos; float2 vel; };
struct S2NodeStatic { float2 home; float radius; float spawn; float formStart; float seed; uint group; float pad; };
struct S2Edge { uint a; uint b; float rest; float activation; };
struct S2Neighbor { uint node; uint edge; };

struct S2Params {
    float2 viewport;
    float2 camPan;
    float time;
    float dt;
    float progress;
    float repulsion;
    float springK;
    float centerK;
    float damping;
    float radialR;
    float maxSpeed;
    float rotation;
    float scale;
    float spaceBreath;
    float zoom;
    float pad0;
    uint nodeCount;
    uint edgeCount;
    float3 nodeColor;
    float3 edgeColor;
    float edgeAlpha;
    float nodeSize;
    float lineScale;
    float glow;
};

constant float2 kQuad[6] = {
    float2(-1.0, -1.0), float2( 1.0, -1.0), float2(-1.0,  1.0),
    float2(-1.0,  1.0), float2( 1.0, -1.0), float2( 1.0,  1.0)
};

inline float2 s2_rotate2(float2 p, float a) {
    float c = cos(a), s = sin(a);
    return float2(c * p.x - s * p.y, s * p.x + c * p.y);
}

kernel void s2_integrate(device const S2PV*        inPV      [[buffer(0)]],
                         device S2PV*              outPV     [[buffer(1)]],
                         device const S2NodeStatic* statics  [[buffer(2)]],
                         device const S2Edge*      edges     [[buffer(3)]],
                         device const S2Neighbor*  neighbors [[buffer(4)]],
                         device const uint*        offsets   [[buffer(5)]],
                         constant S2Params&        P         [[buffer(6)]],
                         uint gid [[thread_position_in_grid]])
{
    if (gid >= P.nodeCount) return;

    S2PV    me  = inPV[gid];
    S2NodeStatic st = statics[gid];
    float2 pos = me.pos;

    float gather = smoothstep(st.formStart, st.formStart + 0.10, P.progress);
    float ball   = smoothstep(0.66, 1.00, P.progress);

    float2 rep = float2(0.0);
    for (uint j = 0; j < P.nodeCount; ++j) {
        if (j == gid) continue;
        float2 d = pos - inPV[j].pos;
        float dist2 = max(dot(d, d), 0.0009);
        float inv = rsqrt(dist2);
        float f = P.repulsion / dist2;
        rep += (d * inv) * min(f, 2.0);
    }
    float2 force = rep * gather;

    uint start = offsets[gid];
    uint end   = offsets[gid + 1];
    for (uint k = start; k < end; ++k) {
        S2Neighbor nb = neighbors[k];
        S2Edge e = edges[nb.edge];
        float act = smoothstep(e.activation, e.activation + 0.16, P.progress);
        if (act <= 0.0) continue;
        float2 d = inPV[nb.node].pos - pos;
        float dist = max(length(d), 1e-4);
        float2 dir = d / dist;
        force += dir * (dist - e.rest) * P.springK * act;
    }

    float2 target = mix(st.home, float2(0.0), ball);
    force += (target - pos) * (P.centerK * gather);

    float r = length(pos);
    if (r > P.radialR) {
        force += -(pos / max(r, 1e-4)) * (r - P.radialR) * (P.centerK * 8.0) * ball;
    }

    float2 vel = (me.vel + force * P.dt) * P.damping;
    float sp = length(vel);
    if (sp > P.maxSpeed) vel *= P.maxSpeed / sp;

    S2PV out;
    out.pos = pos + vel * P.dt;
    out.vel = vel;
    outPV[gid] = out;
}

struct S2EdgeInOut {
    float4 position [[position]];
    float  across;
    float  alpha;
    float3 color;
};

vertex S2EdgeInOut s2_edge_vertex(uint vid [[vertex_id]],
                                  uint iid [[instance_id]],
                                  device const S2PV*    pv    [[buffer(0)]],
                                  device const S2Edge*  edges [[buffer(1)]],
                                  constant S2Params&    P     [[buffer(2)]])
{
    S2Edge e = edges[iid];
    float grow = smoothstep(e.activation, e.activation + 0.06, P.progress);

    float space = P.scale * P.spaceBreath;
    float2 aN = (s2_rotate2(pv[e.a].pos, P.rotation) - P.camPan) * space;
    float2 bN = (s2_rotate2(pv[e.b].pos, P.rotation) - P.camPan) * space;
    float2 bEff = mix(aN, bN, grow);

    float2 dir = bEff - aN;
    float len = max(length(dir), 1e-4);
    float2 t = dir / len;
    float2 n = float2(-t.y, t.x);

    float2 q = kQuad[vid];
    float along  = q.x * 0.5 + 0.5;
    float across = q.y;
    float halfW = (1.43 * P.lineScale) * P.zoom;

    float2 posPix = mix(aN, bEff, along) + n * across * halfW;

    S2EdgeInOut o;
    o.position = float4(posPix / (0.5 * P.viewport), 0.0, 1.0);
    o.across = across;
    o.alpha = grow * P.edgeAlpha;
    o.color = P.edgeColor;
    return o;
}

fragment float4 s2_edge_fragment(S2EdgeInOut in [[stage_in]]) {
    float soft = smoothstep(1.0, 0.0, abs(in.across));
    float a = in.alpha * soft;
    return float4(in.color * a, a);
}

struct S2NodeInOut {
    float4 position [[position]];
    float2 local;
    float  alpha;
    float3 color;
    float  glow;
};

vertex S2NodeInOut s2_node_vertex(uint vid [[vertex_id]],
                                  uint iid [[instance_id]],
                                  device const S2PV*         pv      [[buffer(0)]],
                                  device const S2NodeStatic* statics [[buffer(1)]],
                                  constant S2Params&         P       [[buffer(2)]])
{
    float2 q = kQuad[vid];
    S2PV s = pv[iid];
    S2NodeStatic st = statics[iid];

    float appear = smoothstep(st.spawn, st.spawn + 0.10, P.progress);
    float radius = st.radius * (1.3 * P.nodeSize) * appear * P.zoom;
    float reach = 2.4;

    float space = P.scale * P.spaceBreath;
    float2 centerPix = (s2_rotate2(s.pos, P.rotation) - P.camPan) * space;
    float2 cornerPix = centerPix + q * (radius * reach);

    S2NodeInOut o;
    o.position = float4(cornerPix / (0.5 * P.viewport), 0.0, 1.0);
    o.local = q * reach;
    o.alpha = appear;
    o.color = P.nodeColor;
    o.glow = P.glow;
    return o;
}

fragment float4 s2_node_fragment(S2NodeInOut in [[stage_in]]) {
    float d = length(in.local);
    float core = smoothstep(1.0, 0.72, d);
    float glow = exp(-2.4 * d) * 0.55 * in.glow;
    float a = saturate(core + glow * 0.9) * in.alpha;
    float3 col = in.color * (0.55 + 0.55 * core) + in.color * glow * 0.5;
    return float4(col * a, a);
}
