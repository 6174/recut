import React from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float speed = 1.0;
const float zoom = 3.0;
const float driftX = 0.08;
const float driftY = 0.04;
const float warp = 2.0;
const float coverage = 0.0;
const half4 skyColor = half4(0.101961, 0.14902, 0.34902, 1.0);
const half4 cloudColor = half4(0.901961, 0.901961, 1.0, 1.0);
const half4 warmTint = half4(0.101961, 0.05098, 0.0, 1.0);
const float warmth = 0.5;

float fc_hash(float2 p) {
    p = fract(p * float2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}

float fc_noise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    float a = fc_hash(i);
    float b = fc_hash(i + float2(1.0, 0.0));
    float c = fc_hash(i + float2(0.0, 1.0));
    float d = fc_hash(i + float2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fc_fbm(float2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * fc_noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

half4 main(float2 position) {
    float2 size = uResolution;
    float2 uv   = position / size;

    float t = uTime * speed;

    uv *= max(zoom, 0.0001);
    uv += float2(t * driftX, t * driftY);

    float f1 = fc_fbm(uv);
    float f2 = fc_fbm(uv + f1 * warp + float2(t * 0.02, t * 0.03));

    float3 sky   = float3(skyColor.rgb);
    float3 cloud = float3(cloudColor.rgb);
    float3 tint  = float3(warmTint.rgb);

    float3 col = mix(sky, cloud, clamp(f2 + coverage, 0.0, 1.0));
    col += tint * f1 * warmth;

    return half4(half3(col), 1.0);
}
`)!;

export default function FractalCloudsView() {
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
