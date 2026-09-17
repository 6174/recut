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

static float tm_sstep(float e0, float e1, float x) {
    float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

static float tm_hash(float3 p) {
    return fract(sin(dot(p, float3(127.1, 311.7, 74.7))) * 43758.5453);
}

static float tm_noise(float3 p) {
    float3 i = floor(p);
    float3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = tm_hash(i);
    float b = tm_hash(i + float3(1.0, 0.0, 0.0));
    float c = tm_hash(i + float3(0.0, 1.0, 0.0));
    float d = tm_hash(i + float3(1.0, 1.0, 0.0));
    float e = tm_hash(i + float3(0.0, 0.0, 1.0));
    float g = tm_hash(i + float3(1.0, 0.0, 1.0));
    float j = tm_hash(i + float3(0.0, 1.0, 1.0));
    float k = tm_hash(i + float3(1.0, 1.0, 1.0));
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
               mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

static float tm_fbm(float3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * tm_noise(p);
        p = p * 2.03 + float3(7.1, 3.7, 1.3);
        a *= 0.5;
    }
    return v;
}

static float3 tm_aces(float3 x) {
    return saturate((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
}

static float tm_schlick(float ct, float f0) {
    return f0 + (1.0 - f0) * pow(max(1.0 - ct, 0.0), 5.0);
}

static float3 tm_rotY(float3 p, float a) {
    float c = cos(a), s = sin(a);
    return float3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

static float3 tm_studioBG(float2 p, float3 wallA, float3 wallB,
                          float3 lamp, float3 fill) {
    float3 wall = mix(wallA, wallB, smoothstep(-0.55, 1.25, p.y));
    float2 s1 = (p - float2(-0.80, 0.74)) * float2(1.00, 1.65);
    wall += lamp * exp(-dot(s1, s1) * 1.30);
    float2 s2 = (p - float2(0.94, 0.14)) * float2(1.30, 2.05);
    wall += fill * exp(-dot(s2, s2) * 1.85);
    return wall;
}

static float3 tm_envMirror(float2 uv, float3 R,
                           float3 wallA, float3 wallB, float3 lamp, float3 fill,
                           float3 glint, float3 sheen, float3 bloom, float3 bounce,
                           float3 band, float3 bandT, float irid) {
    float3 L1 = normalize(float3(-0.60, 0.64, 0.48));
    float3 e = tm_studioBG(uv * 0.55 + R.xy * 0.72, wallA, wallB, lamp, fill) * 7.5;
    e += glint * pow(max(dot(R, L1), 0.0), 900.0) * 6.5;
    e += sheen * pow(max(dot(R, L1), 0.0), 22.0) * 0.55;
    e += bloom * pow(max(dot(R, L1), 0.0), 4.0) * 0.30;
    e += mix(band, bandT, 0.5 + 0.5 * R.x)
       * pow(1.0 - abs(R.y), 3.0) * 0.42 * irid;
    e += bounce * tm_sstep(0.2, -0.9, R.y) * 0.16;
    return e;
}

static float tm_terf(float3 d) {
    return tm_fbm(d * 2.6) * 1.45 + tm_fbm(d * 5.6) * 0.45;
}

[[ stitchable ]] half4 orbTemper(float2 position,
                                 half4  color,
                                 float4 boundingRect,
                                 float  time,
                                 float  speed,
                                 float  radius,
                                 float  terraces,
                                 float  facet,
                                 float  oxide,
                                 float  heat,
                                 float  iridescence,
                                 float  glow,
                                 float  exposure,
                                 float  spectrum,
                                 float  edgeSoftness,
                                 float  edgeGlow,
                                 float  paletteCount,
                                 half4  tintColor,
                                 half4  metalColor,
                                 half4  sheenColor,
                                 half4  bloomColor,
                                 half4  bounceColor,
                                 half4  wallColor,
                                 half4  wallTintColor,
                                 half4  lampColor,
                                 half4  fillColor,
                                 half4  glintColor,
                                 half4  bandColor,
                                 half4  bandTintColor,
                                 half4  ambientColor,
                                 half4  filmBaseColor,
                                 half4  specularColor,
                                 half4  filmColor,
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

    float  t    = time * speed;
    float  rad  = max(radius, 0.05);
    float3 tint = float3(tintColor.rgb);

    float3 wallA = float3(wallColor.rgb)     * 0.0112;
    float3 wallB = float3(wallTintColor.rgb) * 0.0027;
    float3 lamp  = float3(lampColor.rgb)     * 0.0270;
    float3 fill  = float3(fillColor.rgb)     * 0.0135;
    float3 amb   = float3(ambientColor.rgb)  * 0.032;

    float2 su = (uv - float2(0.0, 0.06)) / rad;
    float  r  = length(su);

    float3 col = tm_studioBG(uv, wallA, wallB, lamp, fill);
    col += tint * exp(-max(r - 1.0, 0.0) * 11.0) * 0.045 * glow;

    if (r < 1.004 + mf_edge_d(edgeSoftness)) {
        float  m = tm_sstep(1.0 + mf_edge_d(edgeSoftness), 1.0 - edgeSoftness, r);
        float  z = sqrt(max(1.0 - r * r, 0.0));
        float3 N = float3(su, z), V = float3(0.0, 0.0, 1.0);

        float3 d   = tm_rotY(N, t * 0.032);
        float  f   = tm_terf(d);
        float  lev = floor(f * terraces);
        float  stp = fract(f * terraces);

        float3 jn = float3(tm_hash(float3(lev * 3.1, 7.7, 1.3)),
                           tm_hash(float3(lev * 3.1, 2.2, 9.9)),
                           tm_hash(float3(lev * 3.1, 5.5, 4.4))) - 0.5;
        float3 fnrm = normalize(N + jn * facet);
        float  edge = tm_sstep(0.07, 0.0, stp) + smoothstep(0.93, 1.0, stp);

        float  ph    = fract(t * 0.042);
        float  front = sqrt(ph) * 3.0;
        float3 hotd  = normalize(float3(-0.34, -1.0, 0.22));
        float  ang   = acos(clamp(dot(d, hotd), -1.0, 1.0));
        float  q  = (ang - front) / max(heat, 0.02);
        float  Tt = exp(-q * q) * (1.0 - ph * 0.30);
        Tt += exp(-ang * 1.6) * (1.0 - ph) * 0.45;

        float  ox    = 16.0 + oxide * clamp(Tt, 0.0, 1.2) + 26.0 * tm_fbm(d * 7.0);
        float3 baseW = float3(612.0, 548.0, 462.0);
        float3 wl    = 612.0 + (baseW - 612.0) * spectrum;
        MfRamp pal = mf_ramp_of(paletteCount,
                                float3(paletteStop0.rgb), float3(paletteStop1.rgb),
                                float3(paletteStop2.rgb), float3(paletteStop3.rgb),
                                float3(paletteStop4.rgb), float3(paletteStop5.rgb),
                                float3(paletteStop6.rgb), float3(paletteStop7.rgb),
                                float3(paletteStop8.rgb), float3(paletteStop9.rgb),
                                float3(paletteStop10.rgb), float3(paletteStop11.rgb));

        float3 film  = select(0.5 - 0.5 * cos(float3(12.5663706 * 2.55 * ox) / wl),
                              mf_ramp_cycR(ox / 120.0, pal), paletteCount > 0.5)
                     * float3(filmColor.rgb);

        float  ndv = max(dot(fnrm, V), 0.0);
        float  fr  = tm_schlick(ndv, 0.62);
        float3 R   = reflect(-V, fnrm);
        float3 env = tm_envMirror(uv, R, wallA, wallB, lamp, fill,
                                  float3(glintColor.rgb), float3(sheenColor.rgb),
                                  float3(bloomColor.rgb), float3(bounceColor.rgb),
                                  float3(bandColor.rgb), float3(bandTintColor.rgb),
                                  iridescence);

        float3 c = env * mix(float3(metalColor.rgb),
                             film * 1.35 + float3(filmBaseColor.rgb), 0.62) * fr;
        c += amb
           * (0.4 + 0.9 * max(dot(fnrm, normalize(float3(-0.60, 0.64, 0.48))), 0.0));
        c += film * edge * (0.30 + 0.75 * Tt) * 1.15 * glow;
        c += float3(specularColor.rgb)
           * pow(max(dot(fnrm, normalize(normalize(float3(-0.60, 0.64, 0.48)) + V)), 0.0), 260.0) * 2.2;
        c += film * pow(1.0 - ndv, 3.2) * 0.85;
        c *= 0.30 + 0.70 * smoothstep(-0.95, 0.30, fnrm.y);
        c *= (0.35 + 0.65 * glow);
        col = mix(col, c, m);
    }

    col = pow(tm_aces(col * max(exposure, 0.0)), float3(1.0 / 2.2));
    float3 edged = mf_edge_glow(col, uv, float2(0.0, 0.06), rad,
                                edgeSoftness, edgeGlow, float3(glowColor.rgb));
    return half4(half3(saturate(edged)), 1.0);
}
