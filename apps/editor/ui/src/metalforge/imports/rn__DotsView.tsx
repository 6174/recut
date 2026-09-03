import React from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float style = 0.0;
const float speed = 1.0;
const float brightness = 1.0;
const half4 tint = half4(1.0, 1.0, 1.0, 1.0);
const half4 background = half4(0.0, 0.0, 0.0, 1.0);
const float dotSize = 1.0;
const float gridDensity = 1.0;
const float patternScale = 1.0;
const float vignette = 1.0;
const float horizon = -0.45;
const float amplitude = 1.0;
const float depthFade = 1.0;

const int DT_JSPAN = 2048;

float dtRound(float x) {
    return sign(x) * floor(abs(x) + 0.5);
}

float2 dtRound2(float2 v) {
    return sign(v) * floor(abs(v) + 0.5);
}

float dtWavyH(float x, float z, float t) {
    float ps = patternScale;
    float base = (sin(x * 3.6 * ps + t * 0.85) * 0.45
                + sin(z * 2.2 * ps + t * 0.65) * 0.40
                + sin((x * 1.9 + z * 2.0) * ps + t * 1.10) * 0.30
                + sin((x * 2.8 - z * 1.3) * ps + t * 0.45) * 0.22) * 0.16;
    float damp = 1.0 - smoothstep(3.5, 9.0, z) * 0.85;
    return base * damp * amplitude;
}

float dtMountainsH(float x, float z, float t) {
    float ps = patternScale;
    float h = sin(x * 1.0 * ps + t * 0.20) * 0.50
            + sin(z * 0.8 * ps + t * 0.15) * 0.50
            + sin((x * 2.3 + z * 1.7) * ps + t * 0.30) * 0.30
            + sin((x * 4.7 - z * 3.1) * ps + t * 0.40) * 0.18
            + sin((x * 9.0 + z * 7.0) * ps + t * 0.55) * 0.10;
    h = 1.0 - abs(h * 0.5);
    h = pow(max(h, 0.0), 2.5) - 0.4;
    h = h * 0.16;
    float damp = 1.0 - smoothstep(4.0, 10.0, z) * 0.85;
    return h * damp * amplitude;
}

float dtOceanH(float x, float z, float t) {
    float ps = patternScale;
    float base = sin(x * 1.2 * ps + t * 0.55) * 0.55
               + sin(z * 0.9 * ps + t * 0.45) * 0.50
               + sin((x * 0.5 + z * 0.7) * ps + t * 0.70) * 0.40
               + sin((x * 1.5 - z * 0.6) * ps + t * 0.35) * 0.20;
    base = base * 0.20;
    float damp = 1.0 - smoothstep(3.5, 9.0, z) * 0.85;
    return base * damp * amplitude;
}

float dtStandingH(float x, float z, float t) {
    float ps = patternScale;
    float a = sin(x * 4.5 * ps) * sin(z * 4.5 * ps);
    float b = sin(x * 7.0 * ps + 1.0) * sin(z * 7.0 * ps + 1.0);
    float env = sin(t * 1.4);
    float h = (a * 0.7 + b * 0.3) * env;
    h = h * 0.13;
    float damp = 1.0 - smoothstep(3.5, 9.0, z) * 0.85;
    return h * damp * amplitude;
}

float dtHeight(int styleI, float x, float z, float t) {
    if (styleI == 0) { return dtWavyH(x, z, t); }
    if (styleI == 1) { return dtMountainsH(x, z, t); }
    if (styleI == 2) { return dtOceanH(x, z, t); }
    return dtStandingH(x, z, t);
}

float3 dtRender3D(int styleI, float2 position) {
    float2 size = uResolution;
    float2 uv = (position - 0.5 * size) / size.y;
    float t = uTime * speed;

    float yFromHorizon = uv.y - horizon;
    if (yFromHorizon < 0.002) {
        return float3(0.0);
    }

    float gridSize = 0.034 / max(gridDensity, 0.01);
    float cellZmax = 9.1;
    float jMaxAbsolute = cellZmax / gridSize;

    float yampBase = (styleI == 0 || styleI == 1)
        ? (styleI == 1 ? 0.12 : 0.22)
        : (styleI == 2 ? 0.33 : 0.13);
    float yampMax = yampBase * amplitude;
    float Zmin = max(0.05, (1.0 - yampMax) / yFromHorizon);
    float dampEst = 1.0 - smoothstep(3.5, 9.0, Zmin) * 0.85;
    float yampBound = max(yampBase * dampEst * amplitude, 0.03);
    float Zlo = max(0.05, (1.0 - yampBound) / yFromHorizon);
    float Zhi = (1.0 + yampBound) / yFromHorizon;
    int jMin = int(max(1.0, floor(Zlo / gridSize)));
    int jMax = int(min(floor(jMaxAbsolute), ceil(Zhi / gridSize)));
    bool isWavy = styleI == 0;

    float3 accum = float3(0.0);
    float halfSizeX = 0.5 * size.x;
    float halfSizeY = 0.5 * size.y;

    float depthK = (styleI == 0 || styleI == 2) ? 0.35 : 0.32;

    float crestRef = (styleI == 1 || styleI == 0) ? 0.16 : 0.13;
    float crestRefFinal = (styleI == 0)
        ? 0.22
        : ((styleI == 2) ? 0.28 : crestRef);

    for (int k = 0; k < DT_JSPAN; k++) {
        int j = jMin + k;
        if (j > jMax) { break; }
        float jf = float(j);
        float cellZ = jf * gridSize;

        float rawR = 4.4 / (1.0 + cellZ * 1.10);
        float pxR = max(rawR, 0.85) * dotSize;
        float horizCullThresh = pxR * 4.0 + 2.0;
        float baseHaloScale = max(pxR * 1.7, 1.2);
        float subPxFade = smoothstep(0.4, 1.0, rawR);
        float depth = 1.0 / (1.0 + cellZ * depthK * depthFade);
        float invCellZ = 1.0 / cellZ;
        float pitchScreenX = gridSize * invCellZ * size.y;
        float haloScale = isWavy
            ? max(baseHaloScale, pitchScreenX * 0.5)
            : baseHaloScale;
        float iCenter = dtRound(uv.x * jf);
        float iCenterScreenX = iCenter * pitchScreenX + halfSizeX;
        float iCenterCellX = iCenter * gridSize;

        for (int di = -1; di <= 1; di++) {
            float dotScreenX = iCenterScreenX + float(di) * pitchScreenX;
            if (abs(position.x - dotScreenX) > horizCullThresh) { continue; }

            float cellX = iCenterCellX + float(di) * gridSize;
            float Y = dtHeight(styleI, cellX, cellZ, t);
            float dotYFromH = (1.0 - Y) * invCellZ;
            if (dotYFromH < 0.01) { continue; }
            float dotScreenY = (horizon + dotYFromH) * size.y + halfSizeY;
            if (isWavy) {
                if (abs(position.y - dotScreenY) > horizCullThresh) { continue; }
            }

            float horizonFade = smoothstep(0.0, 0.05, dotYFromH);
            float d = length(position - float2(dotScreenX, dotScreenY));
            float mask = smoothstep(pxR + 1.0, pxR - 1.0, d);
            float halo = exp(-d / haloScale) * 0.25;
            float crest = clamp(Y / (crestRefFinal * max(amplitude, 0.01)) * 0.5 + 0.5, 0.0, 1.0);

            float highlight;
            if (styleI == 0) { highlight = 0.55 + 0.85 * crest; }
            else if (styleI == 1) { highlight = 0.35 + 0.55 * crest + 0.6 * pow(crest, 3.0); }
            else if (styleI == 2) { highlight = 0.45 + 1.0 * crest; }
            else { highlight = 0.40 + 1.0 * crest; }

            float intensity = (mask + halo) * depth * highlight * horizonFade * subPxFade;
            accum = max(accum, float3(intensity));
        }
    }

    float boost = (styleI == 0 || styleI == 2)
        ? 1.25
        : ((styleI == 1) ? 1.15 : 1.2);
    accum = min(accum * boost, float3(1.0));

    float2 vUV = (position - 0.5 * size) / size;
    float vigK = (styleI == 0 || styleI == 2) ? 0.6 : 0.5;
    float vig = clamp(1.0 - dot(vUV, vUV) * vigK * vignette, 0.0, 1.0);
    accum = accum * vig;

    if (styleI == 2) {
        accum = accum * float3(0.92, 0.97, 1.0);
    }
    return accum;
}

float dtFlow(float2 position) {
    float2 size = uResolution;
    float2 uv = (position - 0.5 * size) / size.y;
    float t = uTime * speed;
    float ps = patternScale;

    float grid = 0.020 / max(gridDensity, 0.01);
    float2 cell = dtRound2(uv / grid) * grid;
    float distToDot = length(uv - cell);
    float pxR = (1.4 / size.y) * dotSize;
    float mask = smoothstep(pxR * 1.4, pxR * 0.6, distToDot);

    float n = sin(cell.x * 3.0 * ps + t * 0.4) * cos(cell.y * 3.0 * ps - t * 0.35)
            + 0.5 * sin(cell.x * 7.0 * ps - t * 0.6) * sin(cell.y * 7.0 * ps + t * 0.55);

    float fronts = sin(n * 6.0 + length(cell) * 8.0 * ps - t * 1.8);
    float bright = pow(max(fronts, 0.0), 1.8);

    float2 vUV = (position - 0.5 * size) / size;
    float vig = clamp(1.0 - dot(vUV, vUV) * 0.85 * vignette, 0.0, 1.0);
    return mask * (0.10 + 1.0 * bright) * vig;
}

float dtPlasma(float2 position) {
    float2 size = uResolution;
    float2 uv = (position - 0.5 * size) / size.y;
    float t = uTime * speed;
    float ps = patternScale;

    float grid = 0.018 / max(gridDensity, 0.01);
    float2 cell = dtRound2(uv / grid) * grid;
    float distToDot = length(uv - cell);
    float pxR = (1.6 / size.y) * dotSize;
    float mask = smoothstep(pxR * 1.4, pxR * 0.6, distToDot);

    float v = sin(cell.x * 8.0 * ps + t * 1.3)
            + sin(cell.y * 8.0 * ps + t * 1.1)
            + sin((cell.x + cell.y) * 6.0 * ps + t * 1.5)
            + sin(length(cell) * 10.0 * ps - t * 1.8);
    v = v * 0.25;
    float bright = clamp(0.5 + 0.5 * v, 0.0, 1.0);
    bright = pow(bright, 2.5);

    float2 vUV = (position - 0.5 * size) / size;
    float vig = clamp(1.0 - dot(vUV, vUV) * 0.9 * vignette, 0.0, 1.0);
    return mask * bright * vig;
}

float dtSnake(float2 position) {
    float2 size = uResolution;
    float2 uv = (position - 0.5 * size) / size.y;
    float t = uTime * speed;
    float ps = patternScale;

    float grid = 0.018 / max(gridDensity, 0.01);
    float2 cell = dtRound2(uv / grid) * grid;
    float distToDot = length(uv - cell);
    float pxR = (1.5 / size.y) * dotSize;
    float mask = smoothstep(pxR * 1.4, pxR * 0.6, distToDot);

    float angle = sin(cell.x * 4.0 * ps + t * 0.6) * 1.2
                + cos(cell.y * 4.0 * ps - t * 0.5) * 1.2
                + sin((cell.x + cell.y) * 3.0 * ps + t * 0.9);
    float2 flow = float2(cos(angle), sin(angle));

    float phase = dot(cell, flow) * 12.0 * ps - t * 4.0;
    float bright = 0.5 + 0.5 * sin(phase);
    bright = pow(bright, 4.0);

    float2 vUV = (position - 0.5 * size) / size;
    float vig = clamp(1.0 - dot(vUV, vUV) * 0.7 * vignette, 0.0, 1.0);
    return mask * (0.10 + 1.1 * bright) * vig;
}

half4 main(float2 fragCoord) {
    float2 position = fragCoord;
    int styleI = int(style);

    float3 fg = float3(tint.rgb) * brightness;
    float3 bg = float3(background.rgb);

    if (styleI <= 3) {
        float3 accum = dtRender3D(styleI, position);
        float3 col = mix(bg, fg, accum);
        return half4(half3(col), 1.0);
    }

    float intensity = 0.0;
    if (styleI == 4) { intensity = dtFlow(position); }
    else if (styleI == 5) { intensity = dtPlasma(position); }
    else { intensity = dtSnake(position); }
    float3 col = mix(bg, fg, float3(intensity));
    return half4(half3(col), 1.0);
}
`)!;

export type DotsViewProps = {
    children?: React.ReactNode;
};

export default function DotsView({ children }: DotsViewProps) {
    const { width, height } = useWindowDimensions();
    const clock = useClock();

    const uniforms = useDerivedValue(() => ({
        uResolution: [width, height],
        uTime: clock.value / 1000,
    }));

    return (
        <View style={{ flex: 1 }}>
            <Canvas style={StyleSheet.absoluteFill}>
                <Fill>
                    <Shader source={SOURCE} uniforms={uniforms} />
                </Fill>
            </Canvas>
            {children}
        </View>
    );
}
