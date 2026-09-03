#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float mf_edge_d(float soft) {
    return soft - 0.005;
}

static float3 mf_edge_glow(float3 col, float2 uv, float2 ctr, float rad,
                           float soft, float glow, float3 glowRGB) {
    if (glow <= 0.0) { return col; }
    float r = length(uv - ctr);
    float e = max(soft, 0.0005);
    float outside = smoothstep(rad - e, rad + e, r);
    return col + glowRGB * (glow * exp(-max(r - rad, 0.0) * 11.0) * outside);
}

static float3 mf_ramp_pick(float idx,
                           float3 s0, float3 s1, float3 s2,  float3 s3,
                           float3 s4, float3 s5, float3 s6,  float3 s7,
                           float3 s8, float3 s9, float3 s10, float3 s11) {
    float3 r = s0;
    r = select(r, s1,  idx == 1.0);
    r = select(r, s2,  idx == 2.0);
    r = select(r, s3,  idx == 3.0);
    r = select(r, s4,  idx == 4.0);
    r = select(r, s5,  idx == 5.0);
    r = select(r, s6,  idx == 6.0);
    r = select(r, s7,  idx == 7.0);
    r = select(r, s8,  idx == 8.0);
    r = select(r, s9,  idx == 9.0);
    r = select(r, s10, idx == 10.0);
    r = select(r, s11, idx == 11.0);
    return r;
}

static float3 mf_ramp_cyc(float t, float n,
                          float3 s0, float3 s1, float3 s2,  float3 s3,
                          float3 s4, float3 s5, float3 s6,  float3 s7,
                          float3 s8, float3 s9, float3 s10, float3 s11) {
    float k  = clamp(floor(n + 0.5), 1.0, 12.0);
    float x  = fract(t) * k;
    float i0 = min(floor(x), k - 1.0);
    float i1 = select(i0 + 1.0, 0.0, i0 + 1.0 >= k);
    return mix(mf_ramp_pick(i0, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
               mf_ramp_pick(i1, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
               x - i0);
}

static float3 mf_ramp_lin(float t, float n,
                          float3 s0, float3 s1, float3 s2,  float3 s3,
                          float3 s4, float3 s5, float3 s6,  float3 s7,
                          float3 s8, float3 s9, float3 s10, float3 s11) {
    float k  = clamp(floor(n + 0.5), 1.0, 12.0);
    float x  = clamp(t, 0.0, 1.0) * (k - 1.0);
    float i0 = clamp(floor(x), 0.0, max(k - 2.0, 0.0));
    return mix(mf_ramp_pick(i0,     s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
               mf_ramp_pick(i0 + 1.0, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
               x - i0);
}

struct MfRamp {
    float  n;
    float3 s0, s1, s2,  s3;
    float3 s4, s5, s6,  s7;
    float3 s8, s9, s10, s11;
};

static MfRamp mf_ramp_of(float n,
                         float3 s0, float3 s1, float3 s2,  float3 s3,
                         float3 s4, float3 s5, float3 s6,  float3 s7,
                         float3 s8, float3 s9, float3 s10, float3 s11) {
    return MfRamp{ n, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11 };
}

static float3 mf_ramp_cycR(float t, MfRamp r) {
    return mf_ramp_cyc(t, r.n, r.s0, r.s1, r.s2, r.s3, r.s4, r.s5,
                       r.s6, r.s7, r.s8, r.s9, r.s10, r.s11);
}

static float3 mf_ramp_linR(float t, MfRamp r) {
    return mf_ramp_lin(t, r.n, r.s0, r.s1, r.s2, r.s3, r.s4, r.s5,
                       r.s6, r.s7, r.s8, r.s9, r.s10, r.s11);
}

static float lq_hash(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + float2(45.32));
    return fract(p.x * p.y);
}

static float lq_noise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(lq_hash(i),                    lq_hash(i + float2(1.0, 0.0)), f.x),
               mix(lq_hash(i + float2(0.0, 1.0)), lq_hash(i + float2(1.0, 1.0)), f.x), f.y);
}

static float lq_fbm(float2 p) {
    float s = 0.0, a = 0.5, m = 0.0;
    for (int i = 0; i < 5; i++) {
        s += a * lq_noise(p);
        m += a;
        a *= 0.5;
        p = float2(0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y) * 2.03;
    }
    return s / m;
}

static float3 lq_ramp(float v, float3 cA, float3 cB, float3 cC, float3 cD) {
    float3 c = mix(cA, cB, smoothstep(0.0, 0.45, v));
    c = mix(c, cC, smoothstep(0.38, 0.72, v));
    return mix(c, cD, smoothstep(0.68, 1.0, v));
}

[[ stitchable ]] half4 orbCyclone(float2 position,
                                  half4  color,
                                  float4 boundingRect,
                                  float  time,
                                  float  speed,
                                  float  radius,
                                  float  zoom,
                                  float  warp,
                                  float  twist,
                                  float  spin,
                                  float  shade,
                                  float  grain,
                                  float  exposure,
                                  float  edgeSoftness,
                                  float  edgeGlow,
                                  float  paletteCount,
                                  half4  colorA,
                                  half4  colorB,
                                  half4  colorC,
                                  half4  colorD,
                                  half4  highlightColor,
                                  half4  glowColor,
                                  half4  paletteStop0,
                                  half4  paletteStop1,
                                  half4  paletteStop2,
                                  half4  paletteStop3,
                                  half4  paletteStop4,
                                  half4  paletteStop5,
                                  half4  paletteStop6,
                                  half4  paletteStop7,
                                  half4  paletteStop8,
                                  half4  paletteStop9,
                                  half4  paletteStop10,
                                  half4  paletteStop11) {
    float2 size = boundingRect.zw;
    float2 fc = float2(position.x, size.y - position.y);
    float2 uv = (2.0 * fc - size) / max(min(size.x, size.y), 1.0);

    float  rad = max(radius, 0.05);

    if (length(uv) > rad * (0.995 + mf_edge_d(edgeSoftness))) {
        float3 out0 = mf_edge_glow(float3(0.0), uv, float2(0.0), rad,
                                   edgeSoftness, edgeGlow, float3(glowColor.rgb));
        return half4(half3(saturate(out0)), 1.0);
    }

    float  t   = time * speed;
    float2 p   = uv / rad;
    float  d   = length(p);

    float2 pp = p * zoom;
    float2 w  = float2(lq_fbm(pp * 1.1 + float2(0.0,  t * 0.09)),
                       lq_fbm(pp * 1.1 + float2(7.7, -t * 0.07)));

    float an = twist * exp(-d * d * 1.1) + t * spin;
    float cs = cos(an);
    float sn = sin(an);
    float2 rp = float2(cs * p.x + sn * p.y, -sn * p.x + cs * p.y) * zoom * 3.0;

    float  v = lq_fbm(rp * 1.3 + warp * 0.3 * (w - float2(0.5)));
    MfRamp pal = mf_ramp_of(paletteCount,
                            float3(paletteStop0.rgb), float3(paletteStop1.rgb),
                            float3(paletteStop2.rgb), float3(paletteStop3.rgb),
                            float3(paletteStop4.rgb), float3(paletteStop5.rgb),
                            float3(paletteStop6.rgb), float3(paletteStop7.rgb),
                            float3(paletteStop8.rgb), float3(paletteStop9.rgb),
                            float3(paletteStop10.rgb), float3(paletteStop11.rgb));

    float  cv = smoothstep(0.15, 0.85, v);
    float3 c  = lq_ramp(cv, float3(colorA.rgb), float3(colorB.rgb),
                        float3(colorC.rgb), float3(colorD.rgb));
    c = select(c, mf_ramp_linR(cv, pal), paletteCount > 0.5);

    c = mix(c, float3(highlightColor.rgb),
            shade * 0.3 * smoothstep(0.25, 1.25, dot(p, float2(-0.32, 0.78))));
    c *= 1.0 - shade * 0.42 * smoothstep(-0.05, 1.25, dot(p, float2(0.45, -0.62)));
    c *= 1.0 - shade * 0.3 * smoothstep(0.72, 1.0, d);
    c += float3((lq_hash(p * 900.0 + float2(t)) - 0.5) * 0.05 * grain);

    float  ballA = 1.0 - smoothstep(0.955 - mf_edge_d(edgeSoftness), 0.995 + mf_edge_d(edgeSoftness), d);
    float3 col   = saturate(c) * ballA * max(exposure, 0.0);
    float3 edged = mf_edge_glow(saturate(col), uv, float2(0.0), rad,
                                edgeSoftness, edgeGlow, float3(glowColor.rgb));
    return half4(half3(saturate(edged)), 1.0);
}
