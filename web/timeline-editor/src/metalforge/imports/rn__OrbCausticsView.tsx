import React from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float speed = 1.0;
const float radius = 0.74;
const float density = 1.3;
const float thickness = 0.1;
const float refraction = 0.28;
const float warp = 2.1;
const float rim = 1.0;
const float glow = 1.0;
const float exposure = 1.0;
const float spectrum = 1.0;
const float edgeSoftness = 0.005;
const float edgeGlow = 0.0;
const float paletteCount = 0.0;
const half4 haloColor = half4(0.05098, 0.039216, 0.2, 1.0);
const half4 tintColor = half4(0.058824, 0.031373, 0.180392, 1.0);
const half4 bodyColor = half4(0.070588, 0.023529, 0.2, 1.0);
const half4 ambientColor = half4(0.007843, 0.011765, 0.05098, 1.0);
const half4 rimColor = half4(0.121569, 0.419608, 1.0, 1.0);
const half4 rimTintColor = half4(0.780392, 0.258824, 1.0, 1.0);
const half4 specColor = half4(1.0, 1.0, 1.0, 1.0);
const half4 filmColor = half4(1.0, 1.0, 1.0, 1.0);
const half4 glowColor = half4(0.121569, 0.419608, 1.0, 1.0);
const half4 paletteStop0 = half4(0.0, 0.0, 0.0, 1.0);
const half4 paletteStop1 = half4(0.145098, 0.247059, 0.384314, 1.0);
const half4 paletteStop2 = half4(0.498039, 0.741176, 0.945098, 1.0);
const half4 paletteStop3 = half4(0.854902, 1.0, 0.823529, 1.0);
const half4 paletteStop4 = half4(1.0, 0.768627, 0.207843, 1.0);
const half4 paletteStop5 = half4(0.854902, 0.27451, 0.039216, 1.0);
const half4 paletteStop6 = half4(0.501961, 0.0, 0.576471, 1.0);
const half4 paletteStop7 = half4(0.145098, 0.219608, 1.0, 1.0);
const half4 paletteStop8 = half4(0.145098, 0.219608, 1.0, 1.0);
const half4 paletteStop9 = half4(0.145098, 0.219608, 1.0, 1.0);
const half4 paletteStop10 = half4(0.145098, 0.219608, 1.0, 1.0);
const half4 paletteStop11 = half4(0.145098, 0.219608, 1.0, 1.0);

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

float ca_sstep(float e0, float e1, float x) {
    float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

float ca_hash(float3 p) {
    return fract(sin(dot(p, float3(127.1, 311.7, 74.7))) * 43758.5453);
}

float ca_noise(float3 p) {
    float3 i = floor(p);
    float3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = ca_hash(i);
    float b = ca_hash(i + float3(1.0, 0.0, 0.0));
    float c = ca_hash(i + float3(0.0, 1.0, 0.0));
    float d = ca_hash(i + float3(1.0, 1.0, 0.0));
    float e = ca_hash(i + float3(0.0, 0.0, 1.0));
    float g = ca_hash(i + float3(1.0, 0.0, 1.0));
    float j = ca_hash(i + float3(0.0, 1.0, 1.0));
    float k = ca_hash(i + float3(1.0, 1.0, 1.0));
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
               mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

float ca_fbm(float3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * ca_noise(p);
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

    float3 col = float3(haloColor.rgb) * exp(-max(r - rad, 0.0) * 11.0) * 0.30 * glow;

    if (r < rad + 0.01 + mf_edge_d(edgeSoftness)) {
        float  m   = ca_sstep(rad + mf_edge_d(edgeSoftness), rad - edgeSoftness, r);
        float2 su  = uv / rad;
        float  z   = sqrt(max(1.0 - dot(su, su), 0.0));
        float3 nrm = float3(su, z);

        float3 o1 = float3(sin(t * 0.17) + 0.6 * sin(t * 0.073 + 1.2),
                           cos(t * 0.15) + 0.6 * cos(t * 0.067 + 2.8),
                           sin(t * 0.11 + 4.1)) * 0.6;
        float3 o2 = float3(cos(t * 0.13 + 0.7),
                           sin(t * 0.10 + 2.2),
                           cos(t * 0.08 + 5.0)) * 0.45;

        float sw = max(thickness, 0.005);

        float3 baseF = float3(1.0, 1.32, 1.70);
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
            float  fz   = z - (float(i) + 0.5) * dl;
            float2 lens = su * (1.0 - refraction * (z - fz));
            float3 p    = float3(lens, fz);
            float  rr   = length(p);
            float  g    = ca_fbm(p * 1.9 + o1);
            float  f    = ca_fbm(p * 1.3 + g * (warp + 0.3 * sin(t * 0.19)) + o2);
            float  sheet = pow(ca_sstep(sw, 0.0, abs(f - 0.48)), 2.0)
                         + 0.7 * pow(ca_sstep(sw * 0.7, 0.0, abs(g - 0.55)), 2.0);
            float  dens = sheet * ca_sstep(1.0, 0.6, rr) * density;
            float  aa   = 1.0 - exp(-dens * 5.5 * dl);
            float  th   = f * 2.4 + g * 1.4 + fz * 0.8 + sin(t * 0.12) * 0.3;
            float3 c    = (paletteCount > 0.5
                             ? mf_ramp_cycR(th, pal)
                             : 0.5 - 0.5 * cos(6.2831 * th * freq)) * float3(filmColor.rgb)
                        * (0.5 + 0.5 * ca_sstep(0.9, 0.3, rr));
            c += float3(tintColor.rgb);
            acc += T * c * aa * 1.7;
            T   *= 1.0 - aa * 0.8;
        }

        float  bw   = 0.5 + 0.5 * su.x - 0.4 * su.y;
        float3 dark = float3(ambientColor.rgb);
        float3 base = dark + (float3(bodyColor.rgb) - dark) * bw;
        acc += T * base;

        float fres = pow(1.0 - z, 2.2);
        acc += mix(float3(rimColor.rgb), float3(rimTintColor.rgb), 0.5 + 0.5 * su.x) * fres * 1.1 * rim;

        float3 L = normalize(float3(-0.5, 0.6, 0.62));
        acc += float3(specColor.rgb) * pow(max(dot(nrm, L), 0.0), 40.0) * 0.9;
        acc *= (0.2 + 0.8 * glow);
        col = mix(col, acc, m);
    }

    col = 1.0 - exp(-col * 1.7 * max(exposure, 0.0));
    float3 edged = mf_edge_glow(clamp(col, 0.0, 1.0), uv, float2(0.0), rad,
                                edgeSoftness, edgeGlow, float3(glowColor.rgb));
    return half4(half3(clamp(edged, 0.0, 1.0)), 1.0);
}
`)!;

export default function OrbCausticsView() {
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
