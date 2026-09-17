#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float lc_hash(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

static float lc_noise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    float a = lc_hash(i);
    float b = lc_hash(i + float2(1.0, 0.0));
    float c = lc_hash(i + float2(0.0, 1.0));
    float d = lc_hash(i + float2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

[[ stitchable ]] half4 liquidChrome(float2 position,
                                    half4  color,
                                    float4 boundingRect,
                                    float  time,
                                    float  speed,
                                    float  scale,
                                    float  warp,
                                    float  contrast,
                                    float  specPower,
                                    float  specStrength,
                                    float  tintStrength,
                                    half4  shadow,
                                    half4  silver,
                                    half4  highlight,
                                    half4  tint) {
    float2 size = boundingRect.zw;
    float2 uv = (position * 2.0 - size) / max(min(size.x, size.y), 1.0);

    float t = time * speed;

    float2 p  = uv * max(scale, 0.0001);
    float  n1 = lc_noise(p + float2(t, t * 0.6));
    float  n2 = lc_noise(p + n1 * warp + float2(-t * 0.4, t * 0.3));
    float  n3 = lc_noise(p * 1.5 + n2 * warp + float2(t * 0.2, -t * 0.5));

    float chrome = clamp(n3 * 0.5 + 0.5, 0.0, 1.0);
    chrome = pow(chrome, max(contrast, 0.001));

    float3 sh = float3(shadow.rgb);
    float3 sv = float3(silver.rgb);
    float3 hl = float3(highlight.rgb);
    float3 tn = float3(tint.rgb);

    float3 col = mix(sh, sv, chrome);
    col = mix(col, hl, smoothstep(0.8, 0.98, chrome));
    col += tn * smoothstep(0.3, 0.6, n1) * tintStrength;

    float spec = pow(max(chrome, 0.0), max(specPower, 0.001));
    col += float3(0.6, 0.6, 0.8) * spec * specStrength;

    return half4(half3(col), 1.0);
}
