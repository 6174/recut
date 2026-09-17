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

static float nb_sstep(float e0, float e1, float x) {
    float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

static float nb_hash(float3 p) {
    return fract(sin(dot(p, float3(127.1, 311.7, 74.7))) * 43758.5453);
}

static float nb_noise(float3 p) {
    float3 i = floor(p);
    float3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = nb_hash(i);
    float b = nb_hash(i + float3(1.0, 0.0, 0.0));
    float c = nb_hash(i + float3(0.0, 1.0, 0.0));
    float d = nb_hash(i + float3(1.0, 1.0, 0.0));
    float e = nb_hash(i + float3(0.0, 0.0, 1.0));
    float g = nb_hash(i + float3(1.0, 0.0, 1.0));
    float j = nb_hash(i + float3(0.0, 1.0, 1.0));
    float k = nb_hash(i + float3(1.0, 1.0, 1.0));
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
               mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

static float nb_fbm(float3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * nb_noise(p);
        p = p * 2.03 + float3(7.1, 3.7, 1.3);
        a *= 0.5;
    }
    return v;
}

static float3 nb_pal(float x, float3 c0, float3 c1, float3 c2, float3 c3) {
    float3 c = mix(c0, c1, smoothstep(0.05, 0.38, x));
    c = mix(c, c2, smoothstep(0.40, 0.68, x));
    c = mix(c, c3, smoothstep(0.70, 0.94, x));
    return c;
}

[[ stitchable ]] half4 orbNebula(float2 position,
                                 half4  color,
                                 float4 boundingRect,
                                 float  time,
                                 float  speed,
                                 float  radius,
                                 float  density,
                                 float  coreSize,
                                 float  rim,
                                 float  glow,
                                 float  exposure,
                                 float  edgeSoftness,
                                 float  edgeGlow,
                                 float  paletteCount,
                                 float2 core,
                                 half4  deepColor,
                                 half4  midColor,
                                 half4  flameColor,
                                 half4  hotColor,
                                 half4  coreColor,
                                 half4  haloColor,
                                 half4  haloTintColor,
                                 half4  emberGlowColor,
                                 half4  ambientColor,
                                 half4  rimColor,
                                 half4  rimTintColor,
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

    float t   = time * speed;
    float rad = max(radius, 0.05);
    float r   = length(uv);

    float3 col = mix(float3(haloColor.rgb), float3(haloTintColor.rgb), 0.5 + 0.5 * uv.y)
               * exp(-max(r - rad, 0.0) * 9.0) * 0.26 * glow;

    if (r < rad + 0.01 + mf_edge_d(edgeSoftness)) {
        float  m  = nb_sstep(rad + mf_edge_d(edgeSoftness), rad - edgeSoftness, r);
        float2 su = uv / rad;
        float  z  = sqrt(max(1.0 - dot(su, su), 0.0));

        float3 k1 = float3(sin(t * 0.16) + 0.55 * sin(t * 0.071 + 2.4),
                           cos(t * 0.13) + 0.55 * cos(t * 0.058 + 0.9),
                           sin(t * 0.10 + 3.7)) * 0.6;

    MfRamp pal = mf_ramp_of(paletteCount,
                            float3(paletteStop0.rgb), float3(paletteStop1.rgb),
                            float3(paletteStop2.rgb), float3(paletteStop3.rgb),
                            float3(paletteStop4.rgb), float3(paletteStop5.rgb),
                            float3(paletteStop6.rgb), float3(paletteStop7.rgb),
                            float3(paletteStop8.rgb), float3(paletteStop9.rgb),
                            float3(paletteStop10.rgb), float3(paletteStop11.rgb));

    float3 acc = float3(0.0);
        float  T   = 1.0;
        const int N = 18;
        float dl = 2.0 * z / float(N);
        for (int i = 0; i < N; i++) {
            float  fz = z - (float(i) + 0.5) * dl;
            float3 p  = float3(su * (1.0 - 0.20 * (z - fz)), fz);
            float  rr = length(p);
            float  b  = nb_fbm(p * 1.7 + k1);
            float  w  = nb_fbm(p * 1.15 + b * 1.8 + k1.zxy * 0.7);
            float  dens = pow(smoothstep(0.30, 0.86, w), 1.6) * nb_sstep(1.0, 0.5, rr) * density;
            float  aa = 1.0 - exp(-dens * 5.5 * dl);
            float  lit = 0.45 + 0.55 * max(dot(normalize(float3(0.35, 0.25, 0.5) - p), float3(0.0, 0.0, 1.0)), 0.0);
            float  px = clamp(w * 1.25 - rr * 0.30 + 0.08, 0.0, 1.0);
            float3 c  = select(nb_pal(px, float3(deepColor.rgb), float3(midColor.rgb),
                                      float3(flameColor.rgb), float3(hotColor.rgb)),
                               mf_ramp_linR(px, pal), paletteCount > 0.5) * lit;
            acc += T * c * aa * 2.0;
            T   *= 1.0 - aa * 0.86;
        }

        float2 off  = core;
        float  gCore = exp(-dot(su - off, su - off) * max(coreSize, 0.01));
        acc += float3(coreColor.rgb) * pow(gCore, 2.5) * 1.7 * glow * T;
        acc += float3(emberGlowColor.rgb) * gCore * 0.40;
        acc += T * float3(ambientColor.rgb);

        float fres = pow(1.0 - z, 2.4);
        acc += mix(float3(rimColor.rgb), float3(rimTintColor.rgb), 0.5 + 0.5 * su.y) * fres * 0.95 * rim;
        acc *= (0.2 + 0.8 * glow);
        col = mix(col, acc, m);
    }

    col = 1.0 - exp(-col * 1.6 * max(exposure, 0.0));
    float3 edged = mf_edge_glow(saturate(col), uv, float2(0.0), rad,
                                edgeSoftness, edgeGlow, float3(glowColor.rgb));
    return half4(half3(saturate(edged)), 1.0);
}
