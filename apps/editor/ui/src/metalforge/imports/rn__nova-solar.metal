#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static inline float2x2 nv_rot(float a) { float c = cos(a), s = sin(a); return float2x2(c, -s, s, c); }
static float3 nv_halo(float3 col0, float3 haloCol, float corona) {
    float l0 = dot(col0, float3(0.2126, 0.7152, 0.0722));
    float3 glow = haloCol * ((1.0 - exp(-corona)) * (1.0 - clamp(l0, 0.0, 1.0)));
    return col0 + glow - col0 * glow;
}
static float nv_hash(float2 p) {
    float3 p3 = fract(float3(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
static float3 nv_dither(float3 col, float2 frag) {
    float n = nv_hash(frag) + nv_hash(frag + 19.19) - 1.0;
    float gate = smoothstep(0.0, 2.0 / 255.0, max(col.r, max(col.g, col.b)));
    return col + n * (1.0 / 255.0) * gate;
}

static float3 nvb_solar(float3 a, float t) {
    for (float d = 1.0; d++ < 7.0; )
        a -= sin(a * d + t * 1.4).zxy / d;
    return a;
}

static float3 nvSolar(float2 cc, float2 R, float t, float turb, float3 surfCol, float3 coreCol, float3 haloCol) {
    float3 dir = normalize(float3(cc, R.y * 1.35));
    float2x2 m1 = nv_rot(0.17 * t), m2 = nv_rot(0.11 * t);
    float3 rdir = dir;                    rdir.xz = m1 * rdir.xz; rdir.yz = m2 * rdir.yz;
    float3 roff = float3(0.0, 0.0, -13.0); roff.xz = m1 * roff.xz; roff.yz = m2 * roff.yz;
    float3 acc = float3(0.0);
    float z = 0.0, d = 0.0, s = 0.0, rPrev = 1e9;
    float radius = 2.4 + 0.45 * sin(t * 1.1) + 0.16 * sin(t * 2.7 + 1.0);
    for (float i = 0.0; i++ < 7.2e1; ) {
        float3 p = z * rdir + roff;
        float r = length(p);
        if (r > 6.0 && r > rPrev) break;
        rPrev = r;
        float dr = abs(r - radius);
        float3 q = (dr < 4.0) ? nvb_solar(p * 1.3, t) * (1.0 - smoothstep(2.5, 4.0, dr)) : float3(0.0);
        float boil = 0.55 * (0.5 * q.x + 0.4 * sin(s = q.y) + 0.3 * q.z) * turb;
        float shell = abs(r - radius - boil);
        z += d = 0.08 * shell + 0.05 * abs(cos(s)) + 0.012;
        float core = 1.0 / (0.6 * r * r + 0.04);
        float3 hue = cos(s + 0.5 * r - 0.5 * t + float3(0.0, 0.9, 1.7)) + 1.0;
        acc += (hue * surfCol * 2.0 + core * coreCol * 2.0) / d;
        if (min(acc.x, min(acc.y, acc.z)) > 2.45e4) break;
    }
    float corona = 0.0;
    for (float j = 0.0; j++ < 36.0; ) {
        float3 p = (0.5 * j) * dir;
        p.z -= 13.0;
        float rr = abs(length(p) - radius);
        corona += 0.06 / (0.25 + rr * rr);
    }
    return nv_halo(tanh(acc / 7.0e3), haloCol, corona);
}

[[ stitchable ]] half4 novaSolar(float2 position,
                                 half4  color,
                                 float4 boundingRect,
                                 float  time,
                                 float  speed,
                                 float  scale,
                                 float  turbulence,
                                 float  brightness,
                                 float  contrast,
                                 float  saturation,
                                 half4  surfaceColor,
                                 half4  coreColor,
                                 half4  haloColor,
                                 half4  tint,
                                 half4  background) {
    float2 R    = boundingRect.zw;
    float2 U    = float2(position.x, R.y - position.y);
    U = R * 0.5 + (U - R * 0.5) * 2.0;
    float2 cc = (U * 2.0 - R) / max(scale, 0.001);
    float  t  = time * speed;
    float3 base = nvSolar(cc, R, t, turbulence,
                          float3(surfaceColor.rgb), float3(coreColor.rgb), float3(haloColor.rgb));
    if (any(isnan(base))) base = float3(0.0);
    float3 col = base * brightness * float3(tint.rgb);
    float luma = dot(col, float3(0.2126, 0.7152, 0.0722));
    col = mix(float3(luma), col, saturation);
    col = (col - 0.5) * contrast + 0.5;
    float lum = max(col.r, max(col.g, col.b));
    col += float3(background.rgb) * (1.0 - clamp(lum, 0.0, 1.0));
    col = nv_dither(col, position);
    col = clamp(col, 0.0, 1.0);
    return half4(half3(col), 1.0h);
}
