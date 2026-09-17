#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float sm_hash(float2 p) {
    return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5);
}

static float sm_noise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float a = sm_hash(i);
    float b = sm_hash(i + float2(1.0, 0.0));
    float c = sm_hash(i + float2(0.0, 1.0));
    float d = sm_hash(i + float2(1.0, 1.0));
    float2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

static float sm_fbm(float2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * sm_noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

[[ stitchable ]] half4 smoke(float2 position,
                             half4  color,
                             float4 boundingRect,
                             float  time,
                             float  speed,
                             float  scaleX,
                             float  scaleY,
                             float  sharpness,
                             float  fade,
                             float  amount,
                             half4  bgColor,
                             half4  smokeColor) {
    float2 uv = position / boundingRect.zw;

    float2 p = float2(uv.x * scaleX, uv.y * scaleY - time * speed);
    float  n = sm_fbm(p);

    float density = n * (1.0 - smoothstep(0.0, max(fade, 0.0001), uv.y));
    density = pow(max(density, 0.0), max(sharpness, 0.0001)) * amount;

    float3 col = mix(float3(bgColor.rgb), float3(smokeColor.rgb), clamp(density, 0.0, 1.0));
    return half4(half3(col), 1.0);
}
