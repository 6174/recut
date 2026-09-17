import React from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float speed = 1.0;
const float layers = 3.0;
const float baseScale = 50.0;
const float scaleStep = 80.0;
const float density = 0.05;
const float starSize = 0.1;
const float twinkleSpeed = 3.0;
const float twinkleAmount = 0.3;
const half4 starColor = half4(1.0, 1.0, 1.0, 1.0);
const half4 background = half4(0.007843, 0.007843, 0.031373, 1.0);

float sf_hash1(float2 p) {
    return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}
float2 sf_hash2(float2 p) {
    float a = fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
    float b = fract(sin(dot(p, float2(269.5, 183.3))) * 43758.5453);
    return float2(a, b);
}

half4 main(float2 position) {
    float2 size = uResolution;
    float2 uv   = position / max(size, float2(1.0));

    float count  = max(1.0, min(floor(layers), 8.0));
    float thresh = clamp(1.0 - density, 0.0, 1.0);
    float ssz    = max(starSize, 0.001);
    float amt    = clamp(twinkleAmount, 0.0, 1.0);

    float3 starRGB = float3(starColor.rgb);
    float3 col     = float3(0.0);

    for (int layer = 0; layer < 6; layer++) {
        float fl    = float(layer);
        if (fl >= count) break;

        float scale = max(baseScale + fl * scaleStep, 1.0);
        float lspd  = (0.03 + fl * 0.02) * speed;
        float bri   = max(0.0, 1.0 - fl * 0.25);

        float2 st   = uv * scale;
        st.y       += uTime * lspd * scale;
        float2 cell = floor(st);
        float2 f    = fract(st);

        float h = sf_hash1(cell);
        if (h > thresh) {
            float2 center = sf_hash2(cell);
            float  d      = length(f - center);
            float twink = sin(uTime * twinkleSpeed + h * 100.0) * amt + (1.0 - amt);
            float falloff = 1.0 - smoothstep(0.0, ssz, d);
            col += starRGB * (falloff * twink * bri);
        }
    }

    float3 bg = float3(background.rgb);
    return half4(half3(bg + col), 1.0);
}
`)!;

export default function StarfieldView() {
    const { width, height } = useWindowDimensions();
    const clock = useClock();
    const uniforms = useDerivedValue(() => ({
        uResolution: [width, height],
        uTime: clock.value / 1000,
    }));

    return (
        <Canvas style={{ flex: 1 }}>
            <Fill>
                <Shader source={SOURCE} uniforms={uniforms} />
            </Fill>
        </Canvas>
    );
}
