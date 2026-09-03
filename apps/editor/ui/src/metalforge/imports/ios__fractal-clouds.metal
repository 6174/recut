#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float fc_hash(float2 p) {
    p = fract(p * float2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

static float fc_noise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    float a = fc_hash(i);
    float b = fc_hash(i + float2(1.0, 0.0));
    float c = fc_hash(i + float2(0.0, 1.0));
    float d = fc_hash(i + float2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

static float fc_fbm(float2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * fc_noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

[[ stitchable ]] half4 fractalClouds(float2 position,
                                     half4  color,
                                     float4 boundingRect,
                                     float  time,
                                     float  speed,
                                     float  zoom,
                                     float  driftX,
                                     float  driftY,
                                     float  warp,
                                     float  coverage,
                                     half4  skyColor,
                                     half4  cloudColor,
                                     half4  warmTint,
                                     float  warmth) {
    float2 size = boundingRect.zw;
    float2 uv   = position / size;

    float t = time * speed;

    uv *= max(zoom, 0.0001);
    uv += float2(t * driftX, t * driftY);

    float f1 = fc_fbm(uv);
    float f2 = fc_fbm(uv + f1 * warp + float2(t * 0.02, t * 0.03));

    float3 sky   = float3(skyColor.rgb);
    float3 cloud = float3(cloudColor.rgb);
    float3 tint  = float3(warmTint.rgb);

    float3 col = mix(sky, cloud, clamp(f2 + coverage, 0.0, 1.0));
    col += tint * f1 * warmth;

    return half4(half3(col), 1.0);
}
