import React from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float speed = 1.5;
const float radius = 0.72;
const float zoom = 1.35;
const float warp = 3.1;
const float spectrum = 1.0;
const float grain = 1.0;
const float glow = 1.0;
const float exposure = 1.0;
const float edgeSoftness = 0.005;
const float edgeGlow = 0.0;
const float paletteCount = 0.0;
const half4 tintColor = half4(1.0, 1.0, 1.0, 1.0);
const half4 highlightColor = half4(1.0, 1.0, 1.0, 1.0);
const half4 haloColor = half4(1.0, 0.470588, 0.705882, 1.0);
const half4 haloTintColor = half4(0.352941, 0.627451, 1.0, 1.0);
const half4 glowColor = half4(1.0, 0.470588, 0.705882, 1.0);
const half4 paletteStop0 = half4(1.0, 0.376471, 0.376471, 1.0);
const half4 paletteStop1 = half4(0.878431, 0.176471, 0.698039, 1.0);
const half4 paletteStop2 = half4(0.580392, 0.211765, 0.94902, 1.0);
const half4 paletteStop3 = half4(0.282353, 0.462745, 0.984314, 1.0);
const half4 paletteStop4 = half4(0.160784, 0.780392, 0.780392, 1.0);
const half4 paletteStop5 = half4(0.282353, 0.984314, 0.462745, 1.0);
const half4 paletteStop6 = half4(0.580392, 0.94902, 0.211765, 1.0);
const half4 paletteStop7 = half4(0.878431, 0.698039, 0.176471, 1.0);
const half4 paletteStop8 = half4(0.878431, 0.698039, 0.176471, 1.0);
const half4 paletteStop9 = half4(0.878431, 0.698039, 0.176471, 1.0);
const half4 paletteStop10 = half4(0.878431, 0.698039, 0.176471, 1.0);
const half4 paletteStop11 = half4(0.878431, 0.698039, 0.176471, 1.0);

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

float pr_hash(float2 p) {
    return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

float pr_noise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(pr_hash(i),                    pr_hash(i + float2(1.0, 0.0)), f.x),
               mix(pr_hash(i + float2(0.0, 1.0)), pr_hash(i + float2(1.0, 1.0)), f.x), f.y);
}

float pr_fbm(float2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * pr_noise(p);
        p = p * 2.03 + float2(1.7, 9.2);
        a *= 0.55;
    }
    return v;
}

float3 pr_overlay(float3 b, float3 s) {
    return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(float3(0.5), b));
}

half4 main(float2 position) {
    float2 size = uResolution;
    float2 fc = float2(position.x, size.y - position.y);
    float2 uv = (2.0 * fc - size) / max(min(size.x, size.y), 1.0);

    float  rad = max(radius, 0.05);

    if (length(uv) > rad * 1.394470) {
        float3 out0 = mf_edge_glow(float3(0.0), uv, float2(0.0), rad,
                                   edgeSoftness, edgeGlow, float3(glowColor.rgb));
        return half4(half3(clamp(out0, 0.0, 1.0)), 1.0);
    }

    float  t   = uTime * speed;
    float2 p   = uv / rad;
    float  d   = length(p);

    float2 q = float2(pr_fbm(p * 1.6 + float2(0.0, t * 0.12)),
                      pr_fbm(p * 1.6 + float2(5.2, t * 0.09)));
    float2 w = p * zoom + warp * (q - 0.5);
    float  m1 = pr_fbm(w + float2(t * 0.06, -t * 0.05));
    float  m2 = pr_fbm(w * 1.7 - float2(t * 0.04, t * 0.07));

    float band = m1 * 1.15 + m2 * 0.35 + t * 0.015;

    float3 ph = float3(0.0, 0.33, 0.67) * spectrum;
    float3 spec = paletteCount > 0.5
        ? mf_ramp_cyc(band * spectrum, paletteCount,
                      float3(paletteStop0.rgb),  float3(paletteStop1.rgb),
                      float3(paletteStop2.rgb),  float3(paletteStop3.rgb),
                      float3(paletteStop4.rgb),  float3(paletteStop5.rgb),
                      float3(paletteStop6.rgb),  float3(paletteStop7.rgb),
                      float3(paletteStop8.rgb),  float3(paletteStop9.rgb),
                      float3(paletteStop10.rgb), float3(paletteStop11.rgb))
        : float3(0.58) + 0.42 * cos(6.28318 * (float3(band) + ph));
    float3 col = spec * float3(tintColor.rgb);
    col = mix(col, float3(highlightColor.rgb),
              0.5 * smoothstep(0.1, 1.2, dot(p, float2(-0.35, 0.8))));
    col *= 1.0 - 0.26 * smoothstep(-0.2, 1.2, dot(p, float2(0.45, -0.6)));

    float gn = pr_hash(p * 900.0);
    col = mix(col, pr_overlay(col, float3(gn)), 0.1327 * grain);

    float2 cone1 = float2(-0.473118,  0.473118);
    float2 cone2 = float2( 0.473118, -0.473118);
    float  a1 = 0.35 * max(1.0 - length(p - cone1) / 1.405090, 0.0);
    float  a2 = 0.35 * max(1.0 - length(p - cone2) / 1.405090, 0.0);
    float3 halo = float3(haloColor.rgb) * a1
                + float3(haloTintColor.rgb) * a2 * (1.0 - a1);
    halo *= (1.0 - smoothstep(0.971122, 1.394470, d)) * glow;

    float  ballA = 1.0 - smoothstep(0.99 - mf_edge_d(edgeSoftness), 1.0 + mf_edge_d(edgeSoftness), d);
    float3 outc  = col * ballA + halo * (1.0 - ballA);

    outc = clamp(outc * exposure, 0.0, 1.0);
    float3 edged = mf_edge_glow(outc, uv, float2(0.0), rad,
                                edgeSoftness, edgeGlow, float3(glowColor.rgb));
    return half4(half3(clamp(edged, 0.0, 1.0)), 1.0);
}
`)!;

export default function OrbPrismView() {
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
