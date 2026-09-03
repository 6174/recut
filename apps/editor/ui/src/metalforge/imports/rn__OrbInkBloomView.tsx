import React from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float speed = 1.0;
const float radius = 0.72;
const float density = 8.0;
const float bands = 3.2;
const float fringe = 8.5;
const float rim = 1.0;
const float glow = 1.0;
const float exposure = 1.0;
const float spectrum = 1.0;
const float edgeSoftness = 0.005;
const float edgeGlow = 0.0;
const float paletteCount = 0.0;
const half4 haloColor = half4(0.058824, 0.05098, 0.2, 1.0);
const half4 inkColor = half4(0.015686, 0.011765, 0.043137, 1.0);
const half4 interiorColor = half4(0.160784, 0.101961, 0.54902, 1.0);
const half4 bloomColor = half4(0.54902, 0.121569, 0.6, 1.0);
const half4 rimColor = half4(0.141176, 0.4, 1.0, 1.0);
const half4 rimTintColor = half4(0.74902, 0.25098, 1.0, 1.0);
const half4 filmColor = half4(1.0, 1.0, 1.0, 1.0);
const half4 glowColor = half4(0.54902, 0.121569, 0.6, 1.0);
const half4 paletteStop0 = half4(0.0, 0.0, 0.0, 1.0);
const half4 paletteStop1 = half4(0.145098, 0.239216, 0.368627, 1.0);
const half4 paletteStop2 = half4(0.498039, 0.72549, 0.929412, 1.0);
const half4 paletteStop3 = half4(0.854902, 1.0, 0.858824, 1.0);
const half4 paletteStop4 = half4(1.0, 0.792157, 0.258824, 1.0);
const half4 paletteStop5 = half4(0.854902, 0.309804, 0.015686, 1.0);
const half4 paletteStop6 = half4(0.501961, 0.007843, 0.482353, 1.0);
const half4 paletteStop7 = half4(0.145098, 0.176471, 0.976471, 1.0);
const half4 paletteStop8 = half4(0.145098, 0.176471, 0.976471, 1.0);
const half4 paletteStop9 = half4(0.145098, 0.176471, 0.976471, 1.0);
const half4 paletteStop10 = half4(0.145098, 0.176471, 0.976471, 1.0);
const half4 paletteStop11 = half4(0.145098, 0.176471, 0.976471, 1.0);

float mf_edge_d(float soft) {
    return soft - 0.005;
}

float3 mf_edge_glow(float3 col, float2 uv, float2 ctr, float rad,
                    float soft, float glow, float3 glowRGB) {
    if (glow <= 0.0) { return col; }
    float r = length(uv - ctr);
    float e = max(soft, 0.0005);
    float outside = smoothstep(rad - e, rad + e, r);
    return col + glowRGB * (glow * exp(-max(r - rad, 0.0) * 11.0) * outside);
}

float3 mf_ramp_pick(float idx,
                    float3 s0, float3 s1, float3 s2,  float3 s3,
                    float3 s4, float3 s5, float3 s6,  float3 s7,
                    float3 s8, float3 s9, float3 s10, float3 s11) {
    float3 r = s0;
    r = idx == 1.0  ? s1  : r;
    r = idx == 2.0  ? s2  : r;
    r = idx == 3.0  ? s3  : r;
    r = idx == 4.0  ? s4  : r;
    r = idx == 5.0  ? s5  : r;
    r = idx == 6.0  ? s6  : r;
    r = idx == 7.0  ? s7  : r;
    r = idx == 8.0  ? s8  : r;
    r = idx == 9.0  ? s9  : r;
    r = idx == 10.0 ? s10 : r;
    r = idx == 11.0 ? s11 : r;
    return r;
}

float3 mf_ramp_cyc(float t, float n,
                   float3 s0, float3 s1, float3 s2,  float3 s3,
                   float3 s4, float3 s5, float3 s6,  float3 s7,
                   float3 s8, float3 s9, float3 s10, float3 s11) {
    float k  = clamp(floor(n + 0.5), 1.0, 12.0);
    float x  = fract(t) * k;
    float i0 = min(floor(x), k - 1.0);
    float i1 = i0 + 1.0 >= k ? 0.0 : i0 + 1.0;
    return mix(mf_ramp_pick(i0, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
               mf_ramp_pick(i1, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
               x - i0);
}

float3 mf_ramp_lin(float t, float n,
                   float3 s0, float3 s1, float3 s2,  float3 s3,
                   float3 s4, float3 s5, float3 s6,  float3 s7,
                   float3 s8, float3 s9, float3 s10, float3 s11) {
    float k  = clamp(floor(n + 0.5), 1.0, 12.0);
    float x  = clamp(t, 0.0, 1.0) * (k - 1.0);
    float i0 = clamp(floor(x), 0.0, max(k - 2.0, 0.0));
    return mix(mf_ramp_pick(i0,     s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
               mf_ramp_pick(i0 + 1.0, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
               x - i0);
}

struct MfRamp {
    float  n;
    float3 s0, s1, s2,  s3;
    float3 s4, s5, s6,  s7;
    float3 s8, s9, s10, s11;
};

MfRamp mf_ramp_of(float n,
                  float3 s0, float3 s1, float3 s2,  float3 s3,
                  float3 s4, float3 s5, float3 s6,  float3 s7,
                  float3 s8, float3 s9, float3 s10, float3 s11) {
    return MfRamp(n, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11);
}

float3 mf_ramp_cycR(float t, MfRamp r) {
    return mf_ramp_cyc(t, r.n, r.s0, r.s1, r.s2, r.s3, r.s4, r.s5,
                       r.s6, r.s7, r.s8, r.s9, r.s10, r.s11);
}

float3 mf_ramp_linR(float t, MfRamp r) {
    return mf_ramp_lin(t, r.n, r.s0, r.s1, r.s2, r.s3, r.s4, r.s5,
                       r.s6, r.s7, r.s8, r.s9, r.s10, r.s11);
}

float ib_sstep(float e0, float e1, float x) {
    float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

float ib_hash(float3 p) {
    return fract(sin(dot(p, float3(127.1, 311.7, 74.7))) * 43758.5453);
}

float ib_noise(float3 p) {
    float3 i = floor(p);
    float3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = ib_hash(i);
    float b = ib_hash(i + float3(1.0, 0.0, 0.0));
    float c = ib_hash(i + float3(0.0, 1.0, 0.0));
    float d = ib_hash(i + float3(1.0, 1.0, 0.0));
    float e = ib_hash(i + float3(0.0, 0.0, 1.0));
    float g = ib_hash(i + float3(1.0, 0.0, 1.0));
    float j = ib_hash(i + float3(0.0, 1.0, 1.0));
    float k = ib_hash(i + float3(1.0, 1.0, 1.0));
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
               mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

float ib_fbm(float3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * ib_noise(p);
        p = p * 2.03 + float3(7.1, 3.7, 1.3);
        a *= 0.5;
    }
    return v;
}

half4 main(float2 position) {
    float2 size = uResolution;
    float2 fc = float2(position.x, size.y - position.y);
    float2 uv = (2.0 * fc - size) / max(min(size.x, size.y), 1.0);

    float t   = uTime * speed;
    float rad = max(radius, 0.05);
    float r   = length(uv);

    float3 col = float3(haloColor.rgb) * exp(-max(r - rad, 0.0) * 11.0) * 0.28 * glow;

    if (r < rad + 0.01 + mf_edge_d(edgeSoftness)) {
        float  m  = ib_sstep(rad + mf_edge_d(edgeSoftness), rad - edgeSoftness, r);
        float2 su = uv / rad;
        float  z  = sqrt(max(1.0 - dot(su, su), 0.0));

        float3 k1 = float3(sin(t * 0.17) + 0.6 * sin(t * 0.073 + 1.9),
                           cos(t * 0.14) + 0.6 * cos(t * 0.061 + 0.5),
                           sin(t * 0.11 + 2.8)) * 0.55;
        float3 k2 = float3(cos(t * 0.12 + 0.9),
                           sin(t * 0.10 + 3.2),
                           cos(t * 0.08 + 1.1)) * 0.45;

        float3 baseF = float3(1.0, 1.30, 1.66);
        float3 freq  = float3(1.0) + (baseF - float3(1.0)) * spectrum;

        MfRamp pal = mf_ramp_of(paletteCount,
                                float3(paletteStop0.rgb), float3(paletteStop1.rgb),
                                float3(paletteStop2.rgb), float3(paletteStop3.rgb),
                                float3(paletteStop4.rgb), float3(paletteStop5.rgb),
                                float3(paletteStop6.rgb), float3(paletteStop7.rgb),
                                float3(paletteStop8.rgb), float3(paletteStop9.rgb),
                                float3(paletteStop10.rgb), float3(paletteStop11.rgb));

        float3 acc = float3(0.0);
        float  T   = 1.0;
        const int N = 16;
        float dl = 2.0 * z / float(N);
        for (int i = 0; i < N; i++) {
            float  fz = z - (float(i) + 0.5) * dl;
            float3 p  = float3(su * (1.0 - 0.24 * (z - fz)), fz);
            float  rr = length(p);
            float  g  = ib_fbm(p * 2.0 + k1);
            float  w  = ib_fbm(p * 1.35 + g * 1.9 + k2);
            float  msk  = ib_sstep(1.0, 0.6, rr);
            float  body = smoothstep(0.50, 0.68, w) * msk;
            float  edge = pow(ib_sstep(0.10, 0.0, abs(w - 0.50)), 2.0) * msk;
            float  ith = w * bands + rr * 1.5 + sin(t * 0.09) * 0.3;
            float3 fr  = (paletteCount > 0.5
                            ? mf_ramp_cycR(ith, pal)
                            : 0.5 - 0.5 * cos(6.2831 * ith * freq)) * float3(filmColor.rgb);
            float  aa = 1.0 - exp(-body * density * dl);
            acc += T * fr * edge * dl * fringe * glow;
            acc += T * float3(inkColor.rgb) * aa;
            T   *= 1.0 - aa * 0.95;
        }

        float3 glowbg = mix(float3(interiorColor.rgb), float3(bloomColor.rgb),
                            0.5 + 0.5 * su.y + 0.3 * su.x);
        glowbg *= 0.55 + 0.45 * exp(-dot(su, su) * 1.4);
        acc += T * glowbg * 1.1;

        float fres = pow(1.0 - z, 2.2);
        acc += mix(float3(rimColor.rgb), float3(rimTintColor.rgb), 0.5 + 0.5 * su.x) * fres * rim;
        acc *= (0.2 + 0.8 * glow);
        col = mix(col, acc, m);
    }

    col = 1.0 - exp(-col * 1.7 * max(exposure, 0.0));
    float3 edged = mf_edge_glow(clamp(col, 0.0, 1.0), uv, float2(0.0), rad,
                                edgeSoftness, edgeGlow, float3(glowColor.rgb));
    return half4(half3(clamp(edged, 0.0, 1.0)), 1.0);
}
`)!;

export default function OrbInkBloomView() {
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
