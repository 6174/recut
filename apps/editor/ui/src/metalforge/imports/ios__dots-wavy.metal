#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float dotsWavyH(float x, float z, float t,
                       float amplitude, float patternScale) {
    float base = (sin(x * 3.6 * patternScale + t * 0.85) * 0.45 +
                  sin(z * 2.2 * patternScale + t * 0.65) * 0.40 +
                  sin((x * 1.9 + z * 2.0) * patternScale + t * 1.10) * 0.30 +
                  sin((x * 2.8 - z * 1.3) * patternScale + t * 0.45) * 0.22) * 0.16;
    float damp = 1.0 - smoothstep(3.5, 9.0, z) * 0.85;
    return base * damp * amplitude;
}

[[ stitchable ]] half4 dotsWavy(float2 position,
                                half4  color,
                                float4 boundingRect,
                                float  time,
                                float  speed,
                                float  brightness,
                                half4  tint,
                                half4  background,
                                float  dotSize,
                                float  gridDensity,
                                float  patternScale,
                                float  vignette,
                                float  horizon,
                                float  amplitude,
                                float  depthFade) {
    float2 size = boundingRect.zw;
    float2 uv   = (position - 0.5 * size) / size.y;
    float  t    = time * speed;

    float yFromHorizon = uv.y - horizon;
    if (yFromHorizon < 0.002) {
        return half4(half3(background.rgb), 1.0h);
    }

    float gridSize = 0.034 / max(gridDensity, 0.01);
    const float cellZmax = 9.1;
    float jMaxAbsolute = cellZmax / gridSize;

    float yampMax   = 0.22 * amplitude;
    float Zmin      = max(0.05, (1.0 - yampMax) / yFromHorizon);
    float dampEst   = 1.0 - smoothstep(3.5, 9.0, Zmin) * 0.85;
    float yampBound = max(0.22 * dampEst * amplitude, 0.03);
    float Zlo = max(0.05, (1.0 - yampBound) / yFromHorizon);
    float Zhi = (1.0 + yampBound) / yFromHorizon;
    int jMin = max(1, int(floor(Zlo / gridSize)));
    int jMax = min(int(jMaxAbsolute), int(ceil(Zhi / gridSize)));

    float3 accum = float3(0.0);
    float halfSizeX = 0.5 * size.x;
    float halfSizeY = 0.5 * size.y;
    for (int j = jMin; j <= jMax; j++) {
        float jf    = float(j);
        float cellZ = jf * gridSize;

        float rawR             = 4.4 / (1.0 + cellZ * 1.10);
        float pxR              = max(rawR, 0.85) * dotSize;
        float horizCullThresh  = pxR * 4.0 + 2.0;
        float baseHaloScale    = max(pxR * 1.7, 1.2);
        float subPxFade        = smoothstep(0.4, 1.0, rawR);
        float depth            = 1.0 / (1.0 + cellZ * 0.35 * depthFade);

        float iCenter         = round(uv.x * jf);
        float invCellZ        = 1.0 / cellZ;
        float pitchScreenX    = gridSize * invCellZ * size.y;
        float haloScale       = max(baseHaloScale, pitchScreenX * 0.5);
        float iCenterScreenX  = iCenter * pitchScreenX + halfSizeX;
        float iCenterCellX    = iCenter * gridSize;

        for (int di = -1; di <= 1; di++) {
            float dotScreenX = iCenterScreenX + float(di) * pitchScreenX;
            if (abs(position.x - dotScreenX) > horizCullThresh) continue;

            float cellX = iCenterCellX + float(di) * gridSize;
            float Y     = dotsWavyH(cellX, cellZ, t, amplitude, patternScale);

            float dotYFromHorizon = (1.0 - Y) * invCellZ;
            if (dotYFromHorizon < 0.01) continue;
            float dotScreenY = (horizon + dotYFromHorizon) * size.y + halfSizeY;
            if (abs(position.y - dotScreenY) > horizCullThresh) continue;

            float horizonFade = smoothstep(0.0, 0.05, dotYFromHorizon);
            float distPx      = length(position - float2(dotScreenX, dotScreenY));
            float mask        = smoothstep(pxR + 1.0, pxR - 1.0, distPx);
            float halo        = exp(-distPx / haloScale) * 0.25;
            float crest       = clamp(Y / (0.22 * max(amplitude, 0.01)) * 0.5 + 0.5, 0.0, 1.0);
            float highlight   = 0.55 + 0.85 * crest;
            float intensity   = (mask + halo) * depth * highlight * horizonFade * subPxFade;
            accum = max(accum, float3(intensity));
        }
    }
    accum *= 1.25;
    accum  = min(accum, float3(1.0));

    float2 vUV    = (position - 0.5 * size) / size;
    float  vig    = clamp(1.0 - dot(vUV, vUV) * 0.6 * vignette, 0.0, 1.0);
    accum *= vig;

    float3 fg  = float3(tint.rgb) * brightness;
    float3 bg  = float3(background.rgb);
    float3 col = mix(bg, fg, float3(accum));
    return half4(half3(col), 1.0h);
}
