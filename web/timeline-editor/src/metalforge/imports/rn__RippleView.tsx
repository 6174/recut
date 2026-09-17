import React from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Group, Paint, RuntimeShader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform shader image;
uniform float2 uResolution;
uniform float uTime;

const float originX = 0.5;
const float originY = 0.68;
const float amplitude = 10.0;
const float wavelength = 14.0;
const float speed = 101.0;
const float decay = 0.0029;
const float shine = 0.1;
const float delay = 1.4;
const float dispersion = 0.0;
const half4 sheenColor = half4(1.0, 1.0, 1.0, 1.0);

const int RING_COUNT = 6;

half4 main(float2 position) {
    float2 size = uResolution;
    float2 origin = float2(originX, originY) * size;

    float2 toOrigin = position - origin;
    float  dist = length(toOrigin);
    float2 dir  = dist > 0.0001 ? toOrigin / dist : float2(0.0);

    float halfWidth = max(wavelength * 0.5, 1.0);

    float gap  = max(delay, 0.0001);
    float age0 = mod(uTime, gap);

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
    half4 color = image.eval(position + dir * disp);
    color.r = image.eval(position + dir * dr).r;
    color.b = image.eval(position + dir * db).b;

    half3 highlight = sheenColor.rgb * half(crestSum * distFalloff * shine);
    color.rgb = clamp(color.rgb + highlight, half3(0.0), half3(1.0));

    return color;
}
`)!;

export default function RippleView({ children }: { children?: React.ReactNode }) {
    const { width, height } = useWindowDimensions();
    const clock = useClock();
    const uniforms = useDerivedValue(() => ({
        uResolution: [width, height],
        uTime: clock.value / 1000,
    }));

    return (
        <Canvas style={{ flex: 1 }}>
            <Group layer={
                <Paint>
                    <RuntimeShader source={SOURCE} uniforms={uniforms} />
                </Paint>
            }>
                {children}
            </Group>
        </Canvas>
    );
}
