#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float sf_hash1(float2 p) {
    return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}
static float2 sf_hash2(float2 p) {
    float a = fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
    float b = fract(sin(dot(p, float2(269.5, 183.3))) * 43758.5453);
    return float2(a, b);
}

[[ stitchable ]] half4 starfield(float2 position,
                                 half4  color,
                                 float4 boundingRect,
                                 float  time,
                                 float  speed,
                                 float  layers,
                                 float  baseScale,
                                 float  scaleStep,
                                 float  density,
                                 float  starSize,
                                 float  twinkleSpeed,
                                 float  twinkleAmount,
                                 half4  starColor,
                                 half4  background) {
    float2 size = boundingRect.zw;
    float2 uv   = position / max(size, float2(1.0));

    int   count  = max(1, min(int(layers), 8));
    float thresh = clamp(1.0 - density, 0.0, 1.0);
    float ssz    = max(starSize, 0.001);
    float amt    = clamp(twinkleAmount, 0.0, 1.0);

    float3 starRGB = float3(starColor.rgb);
    float3 col     = float3(0.0);

    for (int layer = 0; layer < count; layer++) {
        float fl    = float(layer);
        float scale = max(baseScale + fl * scaleStep, 1.0);
        float lspd  = (0.03 + fl * 0.02) * speed;
        float bri   = max(0.0, 1.0 - fl * 0.25);

        float2 st   = uv * scale;
        st.y       += time * lspd * scale;
        float2 cell = floor(st);
        float2 f    = fract(st);

        float h = sf_hash1(cell);
        if (h > thresh) {
            float2 center = sf_hash2(cell);
            float  d      = length(f - center);
            float twink = sin(time * twinkleSpeed + h * 100.0) * amt + (1.0 - amt);
            float falloff = 1.0 - smoothstep(0.0, ssz, d);
            col += starRGB * (falloff * twink * bri);
        }
    }

    float3 bg = float3(background.rgb);
    return half4(half3(bg + col), 1.0);
}
