#include <metal_stdlib>
#include <SwiftUI/SwiftUI.h>
using namespace metal;

constant int RING_COUNT = 6;

[[ stitchable ]] half4 concentricRings(float2 position,
                                       SwiftUI::Layer layer,
                                       float4 boundingRect,
                                       float  time,
                                       float  originX,
                                       float  originY,
                                       float  amplitude,
                                       float  wavelength,
                                       float  speed,
                                       float  decay,
                                       float  shine,
                                       float  delay,
                                       float  dispersion,
                                       half4  sheenColor) {
    float2 size = boundingRect.zw;
    float2 origin = float2(originX, originY) * size;

    float2 toOrigin = position - origin;
    float  dist = length(toOrigin);
    float2 dir  = dist > 0.0001 ? toOrigin / dist : float2(0.0);

    float halfWidth = max(wavelength * 0.5, 1.0);

    float gap  = max(delay, 0.0001);
    float age0 = fmod(time, gap);

    float waveSum  = 0.0;
    float crestSum = 0.0;
    for (int i = 0; i < RING_COUNT; i++) {
        float age    = age0 + float(i) * gap;
        float radius = age * speed;
        float x = (dist - radius) / halfWidth;
        float g = exp(-0.5 * x * x);
        waveSum  += 1.64872 * x * g;
        crestSum += g;
    }

    float distFalloff = exp(-dist * decay);

    float disp = amplitude * waveSum * distFalloff;

    float dr = disp * (1.0 + dispersion);
    float db = disp * (1.0 - dispersion);
    half4 color = layer.sample(position + dir * disp);
    color.r = layer.sample(position + dir * dr).r;
    color.b = layer.sample(position + dir * db).b;

    half3 highlight = sheenColor.rgb * half(crestSum * distFalloff * shine);
    color.rgb = clamp(color.rgb + highlight, half3(0.0), half3(1.0));

    return color;
}
