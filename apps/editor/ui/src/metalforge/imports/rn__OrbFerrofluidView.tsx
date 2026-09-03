import React from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float speed = 1.0;
const float radius = 0.7;
const float spikes = 3.4;
const float sharpness = 3.0;
const float relief = 2.6;
const float flank = 0.85;
const float glow = 1.0;
const float exposure = 1.0;
const float edgeSoftness = 0.005;
const float edgeGlow = 0.0;
const float paletteCount = 0.0;
const half4 bodyColor = half4(0.2, 0.211765, 0.239216, 1.0);
const half4 aquaColor = half4(0.2, 0.901961, 0.94902, 1.0);
const half4 violetColor = half4(0.54902, 0.34902, 1.0, 1.0);
const half4 magentaColor = half4(1.0, 0.301961, 0.74902, 1.0);
const half4 amberColor = half4(0.94902, 0.74902, 0.25098, 1.0);
const half4 bodyTintColor = half4(0.94902, 0.960784, 1.0, 1.0);
const half4 specularColor = half4(1.0, 1.0, 1.0, 1.0);
const half4 highlightColor = half4(1.0, 1.0, 1.0, 1.0);
const half4 glowColor = half4(0.2, 0.901961, 0.94902, 1.0);
const half4 paletteStop0 = half4(0.2, 0.211765, 0.239216, 1.0);
const half4 paletteStop1 = half4(0.305882, 0.317647, 0.34902, 1.0);
const half4 paletteStop2 = half4(0.415686, 0.427451, 0.454902, 1.0);
const half4 paletteStop3 = half4(0.521569, 0.533333, 0.564706, 1.0);
const half4 paletteStop4 = half4(0.627451, 0.639216, 0.67451, 1.0);
const half4 paletteStop5 = half4(0.733333, 0.745098, 0.784314, 1.0);
const half4 paletteStop6 = half4(0.843137, 0.854902, 0.890196, 1.0);
const half4 paletteStop7 = half4(0.94902, 0.960784, 1.0, 1.0);
const half4 paletteStop8 = half4(0.94902, 0.960784, 1.0, 1.0);
const half4 paletteStop9 = half4(0.94902, 0.960784, 1.0, 1.0);
const half4 paletteStop10 = half4(0.94902, 0.960784, 1.0, 1.0);
const half4 paletteStop11 = half4(0.94902, 0.960784, 1.0, 1.0);

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

float ff_sstep(float e0, float e1, float x) {
    float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

float ff_hash(float3 p) {
    return fract(sin(dot(p, float3(127.1, 311.7, 74.7))) * 43758.5453);
}

float ff_noise(float3 p) {
    float3 i = floor(p);
    float3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = ff_hash(i);
    float b = ff_hash(i + float3(1.0, 0.0, 0.0));
    float c = ff_hash(i + float3(0.0, 1.0, 0.0));
    float d = ff_hash(i + float3(1.0, 1.0, 0.0));
    float e = ff_hash(i + float3(0.0, 0.0, 1.0));
    float g = ff_hash(i + float3(1.0, 0.0, 1.0));
    float j = ff_hash(i + float3(0.0, 1.0, 1.0));
    float k = ff_hash(i + float3(1.0, 1.0, 1.0));
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
               mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

float ff_fbm(float3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * ff_noise(p);
        p = p * 2.03 + float3(7.1, 3.7, 1.3);
        a *= 0.5;
    }
    return v;
}

float ff_ridge(float3 p, float k) {
    return pow(1.0 - abs(ff_fbm(p) - 0.5) * 2.0, k);
}

float3 ff_knead(float t, float a, float b, float c, float ph) {
    return float3(sin(t * a) + 0.55 * sin(t * a * 0.41 + ph),
                  cos(t * b) + 0.55 * cos(t * b * 0.37 + ph * 1.7),
                  sin(t * c + ph * 2.3));
}

float ff_sch(float ct, float f0) {
    return f0 + (1.0 - f0) * pow(max(1.0 - ct, 0.0), 5.0);
}

float3 ff_env(float3 d, float t, float3 cA, float3 cB, float3 cC, float3 cD) {
    float3 p0 = normalize(float3(sin(t * 0.088 + 0.0), 0.65 * sin(t * 0.068 + 0.0), cos(t * 0.096 + 0.0)));
    float3 p1 = normalize(float3(sin(t * 0.101 + 2.1), 0.65 * sin(t * 0.079 + 2.7), cos(t * 0.113 + 1.5)));
    float3 p2 = normalize(float3(sin(t * 0.114 + 4.3), 0.65 * sin(t * 0.090 + 5.6), cos(t * 0.130 + 3.0)));
    float3 p3 = normalize(float3(sin(t * 0.127 + 1.2), 0.65 * sin(t * 0.101 + 1.6), cos(t * 0.147 + 0.8)));
    float w0 = exp(4.8 * (dot(d, p0) - 1.0));
    float w1 = exp(4.8 * (dot(d, p1) - 1.0));
    float w2 = exp(4.8 * (dot(d, p2) - 1.0));
    float w3 = exp(4.8 * (dot(d, p3) - 1.0));
    return (w0 * cA + w1 * cB + w2 * cC + w3 * cD) / (w0 + w1 + w2 + w3 + 1e-4);
}

float3 ff_aces(float3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

half4 main(float2 position) {
    float2 size = uResolution;
    float2 fc = float2(position.x, size.y - position.y);
    float2 uv = (2.0 * fc - size) / max(min(size.x, size.y), 1.0);

    float t   = uTime * speed;
    float rad = max(radius, 0.05);
    float r   = length(uv);

    float3 cA = float3(aquaColor.rgb);
    float3 cB = float3(violetColor.rgb);
    float3 cC = float3(magentaColor.rgb);
    float3 cD = float3(amberColor.rgb);

    float3 col = ff_env(normalize(float3(uv, 0.5)), t, cA, cB, cC, cD)
               * exp(-max(r - rad, 0.0) * 8.0) * 0.12 * glow;

    if (r < rad + 0.01 + mf_edge_d(edgeSoftness)) {
        float  m  = ff_sstep(rad + mf_edge_d(edgeSoftness), rad - edgeSoftness, r);
        float2 su = uv / rad;
        float  z  = sqrt(max(1.0 - dot(su, su), 0.0));
        float3 N  = float3(su, z);
        float3 V  = float3(0.0, 0.0, 1.0);

        float3 w = N * spikes + ff_knead(t, 0.18, 0.14, 0.11, 2.6) * 0.7;

        float  e  = 0.05;
        float3 gr = float3(ff_ridge(w + float3(e, 0.0, 0.0), sharpness) - ff_ridge(w - float3(e, 0.0, 0.0), sharpness),
                           ff_ridge(w + float3(0.0, e, 0.0), sharpness) - ff_ridge(w - float3(0.0, e, 0.0), sharpness),
                           ff_ridge(w + float3(0.0, 0.0, e), sharpness) - ff_ridge(w - float3(0.0, 0.0, e), sharpness));
        float3 gt = gr - N * dot(gr, N);
        float3 Nn = normalize(N - gt * relief);

        float  spk = ff_ridge(w, sharpness);
        float  ndv = max(dot(Nn, V), 0.0);
        float  fr  = ff_sch(ndv, 0.90);
        float3 R   = reflect(-V, Nn);

        float3 env = ff_env(R, t, cA, cB, cC, cD) * (0.16 + 0.84 * smoothstep(-1.0, 1.0, R.y));
        float3 K   = normalize(float3(-0.55, 0.62, 0.56));
        float  k   = max(dot(R, K), 0.0);
        float3 spc = float3(specularColor.rgb);
        env += spc * pow(k, 420.0) * 7.0 + spc * pow(k, 26.0) * 0.28;
        env *= 1.0 - 0.58 * ff_sstep(-0.15, -1.0, R.y);

        MfRamp pal = mf_ramp_of(paletteCount,
                                float3(paletteStop0.rgb), float3(paletteStop1.rgb),
                                float3(paletteStop2.rgb), float3(paletteStop3.rgb),
                                float3(paletteStop4.rgb), float3(paletteStop5.rgb),
                                float3(paletteStop6.rgb), float3(paletteStop7.rgb),
                                float3(paletteStop8.rgb), float3(paletteStop9.rgb),
                                float3(paletteStop10.rgb), float3(paletteStop11.rgb));

        float3 c = env * (paletteCount > 0.5
                            ? mf_ramp_linR(fr, pal)
                            : mix(float3(bodyColor.rgb), float3(bodyTintColor.rgb), fr));
        c += ff_env(Nn, t, cA, cB, cC, cD) * pow(spk, 2.0) * pow(1.0 - ndv, 1.5) * flank;
        c += float3(highlightColor.rgb) * pow(max(dot(Nn, normalize(K + V)), 0.0), 300.0) * 3.2;
        c *= 0.30 + 0.70 * smoothstep(-0.9, 0.45, Nn.y);
        c *= (0.35 + 0.65 * glow);
        col = mix(col, c, m);
    }

    col = pow(ff_aces(col * max(exposure, 0.0)), float3(1.0 / 2.2));
    float3 edged = mf_edge_glow(clamp(col, 0.0, 1.0), uv, float2(0.0), rad,
                                edgeSoftness, edgeGlow, float3(glowColor.rgb));
    return half4(half3(clamp(edged, 0.0, 1.0)), 1.0);
}
`)!;

export default function OrbFerrofluidView() {
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
