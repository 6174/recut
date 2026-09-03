import React from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const half4 c1 = half4(0.101961, 0.019608, 0.0, 1.0);
const half4 c2 = half4(0.352941, 0.070588, 0.031373, 1.0);
const half4 c3 = half4(0.768627, 0.290196, 0.12549, 1.0);
const half4 c4 = half4(0.941176, 0.541176, 0.227451, 1.0);
const half4 c5 = half4(1.0, 0.772549, 0.478431, 1.0);
const float scale = 1.0;
const float intensity = 1.0;
const float distortion = 1.0;

float ps_hash21(float2 p) {
    p = float2(dot(p, float2(91.31, 47.79)),
               dot(p, float2(31.07, 73.13)));
    return fract(sin(p.x + p.y) * 19357.713);
}

float ps_vnoise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    float a = ps_hash21(i);
    float b = ps_hash21(i + float2(1.0, 0.0));
    float c = ps_hash21(i + float2(0.0, 1.0));
    float d = ps_hash21(i + float2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float ps_fbm3(float2 p) {
    float v = ps_vnoise(p) * 0.5;
    v += ps_vnoise(p * 2.0) * 0.3;
    v += ps_vnoise(p * 4.0) * 0.2;
    return v - 0.5;
}

float3 ps_pal5(float t, float3 k1, float3 k2, float3 k3, float3 k4, float3 k5) {
    t = clamp(t, 0.0, 1.0);
    if (t < 0.25) return mix(k1, k2, smoothstep(0.0, 0.25, t));
    if (t < 0.5)  return mix(k2, k3, smoothstep(0.25, 0.5, t));
    if (t < 0.75) return mix(k3, k4, smoothstep(0.5, 0.75, t));
    return mix(k4, k5, smoothstep(0.75, 1.0, t));
}

half4 main(float2 position) {
    float2 size   = uResolution;
    float2 uv     = position / size;
    float  aspect = size.x / size.y;
    float2 p      = uv - 0.5;
    p.x *= aspect;
    p   *= scale;

    float v = 0.0;
    v += sin(p.x * 2.1 + uTime * 0.7);
    v += sin(p.y * 2.5 + uTime * 0.9);
    v += sin((p.x + p.y) * 1.4 + uTime * 0.5);
    v += ps_fbm3(p * 2.0 + uTime * 0.18) * distortion * 2.0;
    v  = (v + 4.0) * 0.125;
    v  = clamp(v * intensity, 0.0, 1.0);

    float3 col = ps_pal5(v, float3(c1.rgb), float3(c2.rgb), float3(c3.rgb), float3(c4.rgb), float3(c5.rgb));
    col += pow(v, 4.0) * 0.4;
    return half4(half3(col), 1.0);
}
`)!;

export default function PlasmaView() {
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
