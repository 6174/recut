#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float mo_hash(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

static float mo_noise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mo_hash(i);
    float b = mo_hash(i + float2(1.0, 0.0));
    float c = mo_hash(i + float2(0.0, 1.0));
    float d = mo_hash(i + float2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

static float mo_fbm(float2 p, int octaves) {
    float sum = 0.0, amp = 0.5, norm = 0.0;
    float2x2 rot = float2x2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 5; i++) {
        if (i >= octaves) break;
        sum += amp * mo_noise(p);
        norm += amp;
        amp *= 0.5;
        p = rot * p * 2.03;
    }
    return sum / max(norm, 0.0001);
}

static float mo_ridge(float value, float sharpness) {
    float r = 1.0 - abs(value * 2.0 - 1.0);
    return pow(saturate(r), sharpness);
}

[[ stitchable ]] half4 molten(float2 position,
                              half4  color,
                              float4 boundingRect,
                              float  time,
                              float  speed,
                              float  scale,
                              float  warp,
                              float  crack,
                              float  detail,
                              float  heat,
                              float  grain,
                              float  vignette,
                              half4  rockColor,
                              half4  emberColor,
                              half4  midColor,
                              half4  hotColor) {
    float2 size = boundingRect.zw;
    float2 uv   = position / size;
    float  t    = time * speed;

    float2 p = uv - 0.5;
    p.x *= size.x / max(size.y, 1.0);
    p *= max(scale, 0.0001);
    p.y += t * 0.06;

    float2 w = float2(mo_fbm(p * 1.1 + float2(0.0, t * 0.08), 4),
                      mo_fbm(p * 1.1 + float2(7.7, -t * 0.06), 4));
    float2 q = p + warp * (w - 0.5);

    float body  = mo_fbm(q * 1.5, 5);
    float veins = mo_ridge(mo_fbm(q * 2.2 + 3.1, 5), max(crack, 0.0001));
    float fine  = mo_ridge(mo_fbm(q * 5.0 + 11.0, 4), max(detail, 0.0001));

    float lava = veins * 1.3 + fine * 0.6;
    lava *= 0.55 + 0.75 * body;
    lava += 0.10 * smoothstep(0.55, 1.0, body);
    lava *= heat;

    float shade = 0.35 + 0.65 * mo_fbm(q * 4.0 + 21.0, 3);

    float3 c = float3(rockColor.rgb) * shade;
    c = mix(c, float3(emberColor.rgb), saturate(lava * 1.1));
    c = mix(c, float3(midColor.rgb),   saturate(lava - 0.55));
    c = mix(c, float3(hotColor.rgb),   saturate(lava - 1.15));
    c = saturate(c);

    float2 d = uv - 0.5;
    c *= 1.0 - 0.85 * vignette * dot(d, d);
    c += (mo_hash(uv * 900.0 + t) - 0.5) * 0.015 * grain;

    return half4(half3(saturate(c)), 1.0);
}
