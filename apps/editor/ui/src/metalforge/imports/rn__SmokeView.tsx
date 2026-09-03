import React from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float speed = 0.4;
const float scaleX = 2.0;
const float scaleY = 4.0;
const float sharpness = 1.8;
const float fade = 1.0;
const float amount = 1.0;
const half4 bgColor = half4(0.039216, 0.039216, 0.058824, 1.0);
const half4 smokeColor = half4(0.54902, 0.54902, 0.65098, 1.0);

float sm_hash(float2 p) {
    return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5);
}

float sm_noise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float a = sm_hash(i);
    float b = sm_hash(i + float2(1.0, 0.0));
    float c = sm_hash(i + float2(0.0, 1.0));
    float d = sm_hash(i + float2(1.0, 1.0));
    float2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float sm_fbm(float2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * sm_noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

half4 main(float2 position) {
    float2 uv = position / uResolution;

    float2 p = float2(uv.x * scaleX, uv.y * scaleY - uTime * speed);
    float  n = sm_fbm(p);

    float density = n * (1.0 - smoothstep(0.0, max(fade, 0.0001), uv.y));
    density = pow(max(density, 0.0), max(sharpness, 0.0001)) * amount;

    float3 col = mix(float3(bgColor.rgb), float3(smokeColor.rgb), clamp(density, 0.0, 1.0));
    return half4(half3(col), 1.0);
}
`)!;

export default function SmokeView() {
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
