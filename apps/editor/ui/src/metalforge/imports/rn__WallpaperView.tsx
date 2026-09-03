import React from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float mode = 0.0;
const float scale = 1.15;
const float warp = 2.6;
const float contrast = 1.35;
const float bands = 1.0;
const float rotation = 20.0;
const float lift = 0.04;
const float softness = 0.5;
const float grain = 0.5;
const float vignette = 0.85;
const float seed = 27.0;
const float animate = 1.0;
const float aSpeed = 1.0;
const float aAmount = 0.05;
const float aWaves = 6.0;
const half4 color1 = half4(0.015686, 0.019608, 0.101961, 1.0);
const half4 color2 = half4(0.031373, 0.098039, 0.368627, 1.0);
const half4 color3 = half4(0.117647, 0.360784, 1.0, 1.0);
const half4 color4 = half4(0.247059, 0.847059, 1.0, 1.0);
const half4 color5 = half4(0.933333, 0.945098, 0.964706, 1.0);

float2 wp_hash2(float2 p) {
    float2 q = float2(dot(p, float2(127.1, 311.7)), dot(p, float2(269.5, 183.3)));
    return fract(sin(q) * 43758.5453) * 2.0 - 1.0;
}

float wp_hash1(float2 p) {
    return fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
}

float wp_noise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(dot(wp_hash2(i),                    f),
            dot(wp_hash2(i + float2(1.0, 0.0)), f - float2(1.0, 0.0)), u.x),
        mix(dot(wp_hash2(i + float2(0.0, 1.0)), f - float2(0.0, 1.0)),
            dot(wp_hash2(i + float2(1.0, 1.0)), f - float2(1.0, 1.0)), u.x),
        u.y
    );
}

float wp_fbm(float2 p) {
    float a = 0.6;
    float s = 0.0;
    for (int i = 0; i < 3; i++) {
        s += a * wp_noise(p);
        p *= 2.1;
        a *= 0.42;
    }
    return s;
}

float3 wp_pal(float t) {
    t = clamp(t, 0.0, 1.0);
    float3 c = mix(float3(color1.rgb), float3(color2.rgb), smoothstep(0.00, 0.46, t));
    c = mix(c, float3(color3.rgb), smoothstep(0.44, 0.76, t));
    c = mix(c, float3(color4.rgb), smoothstep(0.74, 0.93, t));
    c = mix(c, float3(color5.rgb), smoothstep(0.92, 1.00, t));
    return c;
}

half4 main(float2 fragCoord) {
    float2 res = max(uResolution, float2(1.0));
    float2 fc = float2(fragCoord.x, res.y - fragCoord.y);
    float2 uv = (fc - 0.5 * res) / res.y;

    float soft = clamp(softness, 0.0, 1.0);
    float sc = scale * (1.05 - soft * 0.55);
    float wa = warp * (0.35 + soft * 0.7);
    float th = radians(rotation);
    float2 uvw = uv;
    if (animate > 0.5) {
        float ts = uTime * aSpeed;
        uvw += aAmount * float2(sin(ts + uv.y * aWaves),
                                cos(ts * 0.77 + uv.x * aWaves));
    }
    float2 p = float2(cos(th) * uvw.x + sin(th) * uvw.y,
                      -sin(th) * uvw.x + cos(th) * uvw.y) * sc + seed;

    float2 q = float2(wp_fbm(p), wp_fbm(p + float2(3.7, 1.3)));
    float2 r = float2(wp_fbm(p + wa * q + float2(1.7, 9.2)),
                      wp_fbm(p + wa * q + float2(8.3, 2.8)));
    float f = wp_fbm(p + wa * r);

    float t;
    if (mode < 0.5) {
        t = 0.46 + f * contrast * 1.9;
        float k = t - 0.78;
        if (k > 0.0) { t = 0.78 + k / (1.0 + k * 1.6); }
        t = pow(clamp(t, 0.0, 1.0), 1.35);
    } else {
        t = 0.5 + 0.5 * sin(f * 6.2831 * bands * 1.7 + seed * 2.0);
        t = pow(clamp(t, 0.0, 1.0), contrast);
        float k = t - 0.72;
        if (k > 0.0) { t = 0.72 + k / (1.0 + k * 0.6); }
    }

    float3 col = wp_pal(t + lift);

    float d = length(uv * float2(0.78, 0.52));
    col *= mix(1.0, 1.0 - smoothstep(0.1, 1.25, d), clamp(vignette, 0.0, 1.0));

    float gs = 1500.0 / res.y;
    float g = wp_hash1(floor(fc * gs) + seed * 37.0);
    col += (g - 0.5) * clamp(grain, 0.0, 1.0) * 0.34 * (0.22 + dot(col, float3(0.333)));

    return half4(half3(max(col, float3(0.0))), 1.0);
}
`)!;

export default function WallpaperView() {
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
