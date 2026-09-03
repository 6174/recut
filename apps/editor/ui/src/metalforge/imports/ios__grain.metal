#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float gg_h00(float x) { return 2.0 * x * x * x - 3.0 * x * x + 1.0; }
static float gg_h10(float x) { return x * x * x - 2.0 * x * x + x; }
static float gg_h01(float x) { return 3.0 * x * x - 2.0 * x * x * x; }
static float gg_h11(float x) { return x * x * x - x * x; }

static float gg_hermite(float p0, float p1, float m0, float m1, float x) {
    return p0 * gg_h00(x) + m0 * gg_h10(x) + p1 * gg_h01(x) + m1 * gg_h11(x);
}

static int gg_index(int x, int y) { return clamp(y * 3 + x, 0, 8); }

static float3 gg_grid(float2 coords0, float t, float flow, thread const float3 *pal) {
    float a = sin(t * 1.0) * 0.5 + 0.5;
    float b = sin(t * 1.5) * 0.5 + 0.5;
    float c = sin(t * 2.0) * 0.5 + 0.5;
    float d = sin(t * 2.5) * 0.5 + 0.5;

    float y0 = mix(a, b, coords0.x);
    float y1 = mix(c, d, coords0.x);
    float x0 = mix(a, c, coords0.y);
    float x1 = mix(b, d, coords0.y);

    float cx = gg_hermite(0.0, 1.0, flow * x0, flow * x1, coords0.x);
    float cy = gg_hermite(0.0, 1.0, flow * y0, flow * y1, coords0.y);

    float2 gridCoords = float2(cx, cy) * 2.0;
    int2 idStart = int2(gridCoords);
    int2 idEnd   = int2(ceil(gridCoords));

    float2 factors = smoothstep(float2(0.0), float2(1.0), fract(gridCoords));

    float3 r0 = mix(pal[gg_index(idStart.x, idStart.y)], pal[gg_index(idEnd.x, idStart.y)], factors.x);
    float3 r1 = mix(pal[gg_index(idStart.x, idEnd.y)],   pal[gg_index(idEnd.x, idEnd.y)],   factors.x);
    return mix(r0, r1, factors.y);
}

[[ stitchable ]] half4 grainGradient(float2 position,
                                     half4  color,
                                     float4 boundingRect,
                                     float  time,
                                     float  speed,
                                     float  flow,
                                     float  grain,
                                     float  brightness,
                                     half4  color1,
                                     half4  color2,
                                     half4  color3,
                                     half4  color4,
                                     half4  color5,
                                     half4  color6,
                                     half4  color7,
                                     half4  color8,
                                     half4  color9) {
    float2 uv = position / boundingRect.zw;

    float3 pal[9] = {
        float3(color1.rgb), float3(color2.rgb), float3(color3.rgb),
        float3(color4.rgb), float3(color5.rgb), float3(color6.rgb),
        float3(color7.rgb), float3(color8.rgb), float3(color9.rgb),
    };

    float3 col = gg_grid(uv, time * speed * 0.20, flow, pal) * brightness;

    float x = (uv.x + 4.0) * (uv.y + 4.0) * 10.0;
    float g = fmod((fmod(x, 13.0) + 1.0) * (fmod(x, 123.0) + 1.0), 0.01) - 0.005;
    col += g * grain;

    return half4(half3(clamp(col, 0.0, 1.0)), 1.0);
}
