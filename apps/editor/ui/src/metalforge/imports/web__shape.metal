#include <metal_stdlib>
using namespace metal;

struct ShapeVertexIn {
    float3 position;
    float3 bary;
    float3 mask;
    float2 uv;
};

struct Uniforms {
    float4x4 mvp;
    float4   fill;
    float4   edge;
    float    borderPx;
    float    gridDensity;
};

struct VOut {
    float4 pos [[position]];
    float3 bary;
    float3 mask;
    float2 uv;
};

vertex VOut shape_vertex(uint vid                        [[vertex_id]],
                         constant ShapeVertexIn *verts   [[buffer(0)]],
                         constant Uniforms      &u       [[buffer(1)]]) {
    VOut o;
    o.pos  = u.mvp * float4(verts[vid].position, 1.0);
    o.bary = verts[vid].bary;
    o.mask = verts[vid].mask;
    o.uv   = verts[vid].uv;
    return o;
}

fragment float4 shape_fragment(VOut in              [[stage_in]],
                               constant Uniforms &u  [[buffer(1)]]) {
    float3 b    = in.bary;
    float3 fw   = max(fwidth(b), float3(1e-5));
    float3 dpx  = b / fw + (1.0 - in.mask) * 1e4;
    float  dist = min(dpx.x, min(dpx.y, dpx.z));
    float  lineMix = 1.0 - smoothstep(u.borderPx - 0.75, u.borderPx + 0.75, dist);

    if (u.gridDensity > 0.0) {
        float2 g        = in.uv * u.gridDensity;
        float2 gw       = max(fwidth(g), float2(1e-5));
        float2 gd       = abs(fract(g - 0.5) - 0.5) / gw;
        float  gridDist = min(gd.x, gd.y);
        float  gridMix  = 1.0 - smoothstep(u.borderPx - 0.75, u.borderPx + 0.75, gridDist);
        lineMix = max(lineMix, gridMix);
    }

    float4 col = mix(u.fill, u.edge, lineMix);

    return float4(col.rgb * col.a, col.a);
}
