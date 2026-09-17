import React from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float speed = 1.0;
const float flow = 2.0;
const float grain = 16.0;
const float brightness = 1.0;
const half4 color1 = half4(0.603922, 0.313725, 0.168627, 1.0);
const half4 color2 = half4(0.513725, 0.501961, 0.607843, 1.0);
const half4 color3 = half4(0.0, 0.129412, 0.258824, 1.0);
const half4 color4 = half4(0.227451, 0.247059, 0.368627, 1.0);
const half4 color5 = half4(0.015686, 0.090196, 0.180392, 1.0);
const half4 color6 = half4(0.745098, 0.341176, 0.015686, 1.0);
const half4 color7 = half4(0.015686, 0.090196, 0.180392, 1.0);
const half4 color8 = half4(0.678431, 0.309804, 0.011765, 1.0);
const half4 color9 = half4(0.607843, 0.462745, 0.513725, 1.0);

float gg_h00(float x) { return 2.0 * x * x * x - 3.0 * x * x + 1.0; }
float gg_h10(float x) { return x * x * x - 2.0 * x * x + x; }
float gg_h01(float x) { return 3.0 * x * x - 2.0 * x * x * x; }
float gg_h11(float x) { return x * x * x - x * x; }

float gg_hermite(float p0, float p1, float m0, float m1, float x) {
    return p0 * gg_h00(x) + m0 * gg_h10(x) + p1 * gg_h01(x) + m1 * gg_h11(x);
}

int gg_index(int x, int y) {
    int i = y * 3 + x;
    return i < 0 ? 0 : (i > 8 ? 8 : i);
}

float3 gg_pal(int i) {
    return i == 0 ? float3(color1.rgb)
         : i == 1 ? float3(color2.rgb)
         : i == 2 ? float3(color3.rgb)
         : i == 3 ? float3(color4.rgb)
         : i == 4 ? float3(color5.rgb)
         : i == 5 ? float3(color6.rgb)
         : i == 6 ? float3(color7.rgb)
         : i == 7 ? float3(color8.rgb)
         :          float3(color9.rgb);
}

float3 gg_grid(float2 coords0, float t) {
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

    float3 r0 = mix(gg_pal(gg_index(idStart.x, idStart.y)), gg_pal(gg_index(idEnd.x, idStart.y)), factors.x);
    float3 r1 = mix(gg_pal(gg_index(idStart.x, idEnd.y)),   gg_pal(gg_index(idEnd.x, idEnd.y)),   factors.x);
    return mix(r0, r1, factors.y);
}

half4 main(float2 position) {
    float2 uv = position / uResolution;

    float3 col = gg_grid(uv, uTime * speed * 0.20) * brightness;

    float x = (uv.x + 4.0) * (uv.y + 4.0) * 10.0;
    float g = mod((mod(x, 13.0) + 1.0) * (mod(x, 123.0) + 1.0), 0.01) - 0.005;
    col += g * grain;

    return half4(half3(clamp(col, 0.0, 1.0)), 1.0);
}
`)!;

export default function GrainView() {
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
