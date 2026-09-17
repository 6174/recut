import React from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float speed = 1.0;
const float scale = 1.8;
const float warp = 4.0;
const float highlight = 1.0;
const half4 ink1 = half4(0.05098, 0.0, 0.101961, 1.0);
const half4 ink2 = half4(0.101961, 0.2, 0.501961, 1.0);
const half4 ink3 = half4(0.4, 0.101961, 0.301961, 1.0);
const half4 ink4 = half4(0.0, 0.301961, 0.4, 1.0);
const half4 glow = half4(0.301961, 0.2, 0.4, 1.0);

float ink_hash21(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float ink_vnoise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    float a = ink_hash21(i);
    float b = ink_hash21(i + float2(1.0, 0.0));
    float c = ink_hash21(i + float2(0.0, 1.0));
    float d = ink_hash21(i + float2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float ink_fbm(float2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * ink_vnoise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

half4 main(float2 position) {
    float2 size = uResolution;
    float2 uv   = (position * 2.0 - size) / min(size.x, size.y);

    float  t = uTime * speed * 0.2;
    float2 p = uv * max(scale, 0.0001);

    float2 q  = float2(ink_fbm(p + float2(t * 0.4, t * 0.3)),
                       ink_fbm(p + float2(t * 0.2, -t * 0.4)));
    float2 r2 = float2(ink_fbm(p + q * warp + float2(1.7, 9.2) + t * 0.15),
                       ink_fbm(p + q * warp + float2(8.3, 2.8) - t * 0.1));
    float  f  = ink_fbm(p + r2 * 2.0);

    float3 c1 = float3(ink1.rgb);
    float3 c2 = float3(ink2.rgb);
    float3 c3 = float3(ink3.rgb);
    float3 c4 = float3(ink4.rgb);
    float3 g  = float3(glow.rgb);

    float3 col = mix(c1, c2, clamp(f * 2.0, 0.0, 1.0));
    col        = mix(col, c3, clamp(q.x * 1.5, 0.0, 1.0));
    col        = mix(col, c4, clamp(r2.y * 0.8, 0.0, 1.0));

    float wisp = pow(clamp(f * 1.5, 0.0, 1.0), 3.0);
    col       += g * wisp * highlight;

    return half4(half3(col), 1.0);
}
`)!;

export default function InkSmokeView() {
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
