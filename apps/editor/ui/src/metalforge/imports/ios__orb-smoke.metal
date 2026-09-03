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

static float sm_sstep(float e0, float e1, float x) {
    float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

static float sm_hash(float3 p) {
    return fract(sin(dot(p, float3(127.1, 311.7, 74.7))) * 43758.5453);
}

static float sm_noise(float3 p) {
    float3 i = floor(p);
    float3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = sm_hash(i);
    float b = sm_hash(i + float3(1.0, 0.0, 0.0));
    float c = sm_hash(i + float3(0.0, 1.0, 0.0));
    float d = sm_hash(i + float3(1.0, 1.0, 0.0));
    float e = sm_hash(i + float3(0.0, 0.0, 1.0));
    float g = sm_hash(i + float3(1.0, 0.0, 1.0));
    float j = sm_hash(i + float3(0.0, 1.0, 1.0));
    float k = sm_hash(i + float3(1.0, 1.0, 1.0));
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
               mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

static float sm_fbm(float3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * sm_noise(p);
        p = p * 2.03 + float3(7.1, 3.7, 1.3);
        a *= 0.5;
    }
    return v;
}

static float sm_fbm2(float3 p) {
    return sm_noise(p) * 0.62 + sm_noise(p * 2.07 + float3(7.1, 3.3, 1.7)) * 0.31;
}

static float sm_hg(float ct, float g) {
    float gg = g * g;
    float d = 1.0 + gg - 2.0 * g * ct;
    return (1.0 - gg) / (12.5664 * d * sqrt(max(d, 1e-4)));
}

static float3 sm_aces(float3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

static float sm_sphExit(float3 p, float3 d) {
    float b = dot(p, d);
    return -b + sqrt(max(1.0 - dot(p, p) + b * b, 0.0));
}

static float3 sm_knead(float t, float a, float b, float c, float ph) {
    return float3(sin(t * a) + 0.55 * sin(t * a * 0.41 + ph),
                  cos(t * b) + 0.55 * cos(t * b * 0.37 + ph * 1.7),
                  sin(t * c + ph * 2.3));
}

static float sm_schlick(float ct, float f0) {
    return f0 + (1.0 - f0) * pow(max(1.0 - ct, 0.0), 5.0);
}

static float3 sm_studioBG(float2 p, float3 wallC, float3 wallT, float3 lampC, float3 bounceC) {
    float3 wall = mix(wallC, wallT, smoothstep(-0.55, 1.25, p.y));
    float2 s1 = (p - float2(-0.80, 0.74)) * float2(1.00, 1.65);
    wall += lampC * exp(-dot(s1, s1) * 1.30);
    float2 s2 = (p - float2(0.94, 0.14)) * float2(1.30, 2.05);
    wall += bounceC * exp(-dot(s2, s2) * 1.85);
    return wall;
}

static float3 sm_bgThrough(float2 uv, float3 N,
                           float3 wallC, float3 wallT, float3 lampC, float3 bounceC) {
    float3 d1 = refract(float3(0.0, 0.0, -1.0), N, 1.0 / 1.500);
    float3 d2 = refract(float3(0.0, 0.0, -1.0), N, 1.0 / 1.524);
    float3 d3 = refract(float3(0.0, 0.0, -1.0), N, 1.0 / 1.552);
    return float3(sm_studioBG(uv + d1.xy * 1.15, wallC, wallT, lampC, bounceC).r,
                  sm_studioBG(uv + d2.xy * 1.15, wallC, wallT, lampC, bounceC).g,
                  sm_studioBG(uv + d3.xy * 1.15, wallC, wallT, lampC, bounceC).b) * 2.6;
}

static float3 sm_glassHi(float3 N, float2 su, float z, float3 rimC,
                         float3 specC, float3 softC, float3 hiC, float3 edgeC) {
    float3 V = float3(0.0, 0.0, 1.0);
    float3 L1 = normalize(float3(-0.62, 0.60, 0.50));
    float3 L2 = normalize(float3(0.66, 0.16, 0.72));
    float3 H1 = normalize(L1 + V), H2 = normalize(L2 + V);
    float k = max(dot(N, H1), 0.0);
    float3 c = specC * (pow(k, 420.0) * 2.8 + pow(k, 46.0) * 0.11);
    float2 sb = (su - float2(-0.44, 0.46)) * float2(2.0, 4.4);
    c += softC * exp(-dot(sb, sb) * 2.2) * 0.26;
    c += hiC * pow(max(dot(N, H2), 0.0), 120.0) * 0.34;
    float e = smoothstep(0.86, 1.0, length(su));
    c += rimC * e * pow(1.0 - z, 1.6) * 0.26;
    c += edgeC * pow(smoothstep(0.972, 1.0, length(su)), 0.75) * 0.26;
    return c;
}

static float sm_smk(float3 p, float t, float density, float detail) {
    float3 k = sm_knead(t, 0.16, 0.13, 0.10, 1.4) * 0.40;
    float g = sm_fbm(p * 1.85 + k);
    float w = sm_fbm(p * detail + g * 1.85 + k.zxy * 0.6);
    return pow(smoothstep(0.30, 0.76, w), 1.5) * sm_sstep(1.0, 0.66, length(p)) * density;
}

static float sm_smkLo(float3 p, float t, float density, float detail) {
    float3 k = sm_knead(t, 0.16, 0.13, 0.10, 1.4) * 0.40;
    float w = sm_fbm2(p * detail + sm_fbm2(p * 1.85 + k) * 1.85 + k.zxy * 0.6);
    return pow(smoothstep(0.30, 0.76, w), 1.5) * sm_sstep(1.0, 0.66, length(p)) * density;
}

[[ stitchable ]] half4 orbSmoke(float2 position,
                                half4  color,
                                float4 boundingRect,
                                float  time,
                                float  speed,
                                float  radius,
                                float  density,
                                float  detail,
                                float  shadow,
                                float  scatter,
                                float  glow,
                                float  exposure,
                                float  edgeSoftness,
                                float  edgeGlow,
                                float  paletteCount,
                                half4  tint,
                                half4  keyColor,
                                half4  fillColor,
                                half4  rimColor,
                                half4  wallColor,
                                half4  wallTint,
                                half4  lampColor,
                                half4  bounceColor,
                                half4  specColor,
                                half4  softboxColor,
                                half4  hiColor,
                                half4  edgeColor,
                                half4  albedoColor,
                                half4  albedoTint,
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

    float  t   = time * speed;
    float  rad = max(radius, 0.05);
    float3 tn  = float3(tint.rgb);

    float3 wallC   = float3(wallColor.rgb)   * 0.0112;
    float3 wallT   = float3(wallTint.rgb)    * 0.0027;
    float3 lampC   = float3(lampColor.rgb)   * 0.0270;
    float3 bounceC = float3(bounceColor.rgb) * 0.0135;

    float2 su = (uv - float2(0.0, 0.06)) / rad;
    float  r  = length(su);

    float3 col = sm_studioBG(uv, wallC, wallT, lampC, bounceC);
    col += tn * exp(-max(r - 1.0, 0.0) * 7.0) * 0.05 * glow;

    if (r < 1.004 + mf_edge_d(edgeSoftness)) {
        float  m = sm_sstep(1.0 + mf_edge_d(edgeSoftness), 1.0 - edgeSoftness, r);
        float  z = sqrt(max(1.0 - r * r, 0.0));
        float3 N = float3(su, z);
        float  F = sm_schlick(z, 0.045);
        float3 D = refract(float3(0.0, 0.0, -1.0), N, 1.0 / 1.52);
        float3 bg = sm_bgThrough(uv, N, wallC, wallT, lampC, bounceC);

        float3 P0 = N * 0.997;
        float  len = sm_sphExit(P0, D);
        float3 L = normalize(float3(-0.60, 0.62, 0.50));
        float  ph = sm_hg(dot(D, L), clamp(scatter, 0.0, 0.95)) * 1.1 + 0.30;

        MfRamp pal = mf_ramp_of(paletteCount,
                                float3(paletteStop0.rgb), float3(paletteStop1.rgb),
                                float3(paletteStop2.rgb), float3(paletteStop3.rgb),
                                float3(paletteStop4.rgb), float3(paletteStop5.rgb),
                                float3(paletteStop6.rgb), float3(paletteStop7.rgb),
                                float3(paletteStop8.rgb), float3(paletteStop9.rgb),
                                float3(paletteStop10.rgb), float3(paletteStop11.rgb));

        float3 albC = float3(albedoColor.rgb);
        float3 albT = float3(albedoTint.rgb);
        float3 keyC = float3(keyColor.rgb);
        float3 filC = float3(fillColor.rgb);

        float3 acc = float3(0.0);
        float  T = 1.0;
        const int NS = 16;
        float dl = len / float(NS);
        for (int i = 0; i < NS; i++) {
            float3 p = P0 + D * ((float(i) + 0.5) * dl);
            float  d = sm_smk(p, t, density, detail);
            if (d > 0.012) {
                float sh = exp(-(sm_smkLo(p + L * 0.17, t, density, detail) * 1.0
                               + sm_smkLo(p + L * 0.42, t, density, detail) * 0.65) * shadow);
                float aa = 1.0 - exp(-d * 3.4 * dl);
                float3 lit = keyC * sh * ph * 1.8 + filC * 0.42;
                float  albT01 = clamp(d * 0.5, 0.0, 1.0);
                float3 alb = select(mix(albC, albT, albT01),
                                    mf_ramp_linR(albT01, pal), paletteCount > 0.5);
                acc += T * alb * lit * aa;
                T   *= 1.0 - aa * 0.93;
            }
        }

        float3 inner = acc + bg * T;
        inner *= exp(-pow(1.0 - z, 2.0) * 0.60);
        float3 c = inner * (1.0 - F) * (0.35 + 0.65 * glow);
        c += sm_glassHi(N, su, z, float3(rimColor.rgb), float3(specColor.rgb),
                        float3(softboxColor.rgb), float3(hiColor.rgb), float3(edgeColor.rgb));
        col = mix(col, c, m);
    }

    col = pow(sm_aces(col * max(exposure, 0.0)), float3(1.0 / 2.2));
    float3 edged = mf_edge_glow(saturate(col), uv, float2(0.0, 0.06), rad,
                                edgeSoftness, edgeGlow, float3(glowColor.rgb));
    return half4(half3(saturate(edged)), 1.0);
}
