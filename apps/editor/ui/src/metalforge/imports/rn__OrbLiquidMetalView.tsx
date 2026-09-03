import React from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float speed = 1.0;
const float radius = 0.6;
const float merge = 0.2;
const float drops = 1.0;
const float ripple = 0.03;
const float iridescence = 1.0;
const float glow = 1.0;
const float exposure = 1.0;
const float edgeSoftness = 0.005;
const float edgeGlow = 0.0;
const float paletteCount = 0.0;
const half4 tintColor = half4(0.521569, 0.678431, 1.0, 1.0);
const half4 metalColor = half4(0.701961, 0.745098, 0.831373, 1.0);
const half4 sheenColor = half4(0.901961, 0.94902, 1.0, 1.0);
const half4 bloomColor = half4(0.721569, 0.819608, 1.0, 1.0);
const half4 bounceColor = half4(0.94902, 0.619608, 0.419608, 1.0);
const half4 wallColor = half4(0.713725, 0.768627, 1.0, 1.0);
const half4 wallTopColor = half4(0.592157, 0.592157, 1.0, 1.0);
const half4 lampColor = half4(0.776471, 0.815686, 1.0, 1.0);
const half4 lamp2Color = half4(0.592157, 0.682353, 1.0, 1.0);
const half4 specularColor = half4(1.0, 0.996078, 0.988235, 1.0);
const half4 softboxColor = half4(0.94902, 0.968627, 1.0, 1.0);
const half4 glintColor = half4(0.819608, 0.901961, 1.0, 1.0);
const half4 edgeColor = half4(0.6, 0.760784, 1.0, 1.0);
const half4 rimColor = half4(0.85098, 0.921569, 1.0, 1.0);
const half4 keyColor = half4(1.0, 0.980392, 0.941176, 1.0);
const half4 iriColor = half4(0.101961, 0.258824, 0.701961, 1.0);
const half4 iriTintColor = half4(0.619608, 0.2, 0.8, 1.0);
const half4 fresnelColor = half4(1.0, 1.0, 1.0, 1.0);
const half4 glowColor = half4(0.521569, 0.678431, 1.0, 1.0);
const half4 paletteStop0 = half4(0.701961, 0.745098, 0.831373, 1.0);
const half4 paletteStop1 = half4(0.745098, 0.780392, 0.854902, 1.0);
const half4 paletteStop2 = half4(0.788235, 0.819608, 0.878431, 1.0);
const half4 paletteStop3 = half4(0.831373, 0.854902, 0.901961, 1.0);
const half4 paletteStop4 = half4(0.870588, 0.890196, 0.929412, 1.0);
const half4 paletteStop5 = half4(0.913725, 0.92549, 0.952941, 1.0);
const half4 paletteStop6 = half4(0.956863, 0.964706, 0.976471, 1.0);
const half4 paletteStop7 = half4(1.0, 1.0, 1.0, 1.0);
const half4 paletteStop8 = half4(1.0, 1.0, 1.0, 1.0);
const half4 paletteStop9 = half4(1.0, 1.0, 1.0, 1.0);
const half4 paletteStop10 = half4(1.0, 1.0, 1.0, 1.0);
const half4 paletteStop11 = half4(1.0, 1.0, 1.0, 1.0);

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

float lm_sstep(float e0, float e1, float x) {
    float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

float lm_hash(float3 p) {
    return fract(sin(dot(p, float3(127.1, 311.7, 74.7))) * 43758.5453);
}

float lm_noise(float3 p) {
    float3 i = floor(p);
    float3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = lm_hash(i);
    float b = lm_hash(i + float3(1.0, 0.0, 0.0));
    float c = lm_hash(i + float3(0.0, 1.0, 0.0));
    float d = lm_hash(i + float3(1.0, 1.0, 0.0));
    float e = lm_hash(i + float3(0.0, 0.0, 1.0));
    float g = lm_hash(i + float3(1.0, 0.0, 1.0));
    float j = lm_hash(i + float3(0.0, 1.0, 1.0));
    float k = lm_hash(i + float3(1.0, 1.0, 1.0));
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
               mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

float lm_fbm(float3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * lm_noise(p);
        p = p * 2.03 + float3(7.1, 3.7, 1.3);
        a *= 0.5;
    }
    return v;
}

float3 lm_aces(float3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

float lm_schlick(float ct, float f0) {
    return f0 + (1.0 - f0) * pow(max(1.0 - ct, 0.0), 5.0);
}

float lm_smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float lm_sphExit(float3 p, float3 d) {
    float b = dot(p, d);
    return -b + sqrt(max(1.0 - dot(p, p) + b * b, 0.0));
}

float3 lm_knead(float t, float a, float b, float c, float ph) {
    return float3(sin(t * a) + 0.55 * sin(t * a * 0.41 + ph),
                  cos(t * b) + 0.55 * cos(t * b * 0.37 + ph * 1.7),
                  sin(t * c + ph * 2.3));
}

float3 lm_studioBG(float2 p, float3 wall0, float3 wall1,
                   float3 lamp1, float3 lamp2) {
    float3 wall = mix(wall0 * 0.0112, wall1 * 0.0027,
                      smoothstep(-0.55, 1.25, p.y));
    float2 s1 = (p - float2(-0.80, 0.74)) * float2(1.00, 1.65);
    wall += lamp1 * 0.0270 * exp(-dot(s1, s1) * 1.30);
    float2 s2 = (p - float2(0.94, 0.14)) * float2(1.30, 2.05);
    wall += lamp2 * 0.0135 * exp(-dot(s2, s2) * 1.85);
    return wall;
}

float3 lm_bgThrough(float2 uv, float3 N, float3 wall0, float3 wall1,
                    float3 lamp1, float3 lamp2) {
    float3 d1 = refract(float3(0.0, 0.0, -1.0), N, 1.0 / 1.500);
    float3 d2 = refract(float3(0.0, 0.0, -1.0), N, 1.0 / 1.524);
    float3 d3 = refract(float3(0.0, 0.0, -1.0), N, 1.0 / 1.552);
    return float3(lm_studioBG(uv + d1.xy * 1.15, wall0, wall1, lamp1, lamp2).r,
                  lm_studioBG(uv + d2.xy * 1.15, wall0, wall1, lamp1, lamp2).g,
                  lm_studioBG(uv + d3.xy * 1.15, wall0, wall1, lamp1, lamp2).b) * 2.6;
}

float3 lm_glassHi(float3 N, float2 su, float z, float3 spec,
                  float3 box, float3 glint, float3 edgeC, float3 rimC) {
    float3 V = float3(0.0, 0.0, 1.0);
    float3 L1 = normalize(float3(-0.62, 0.60, 0.50));
    float3 L2 = normalize(float3(0.66, 0.16, 0.72));
    float3 H1 = normalize(L1 + V), H2 = normalize(L2 + V);
    float k = max(dot(N, H1), 0.0);
    float3 c = spec * (pow(k, 420.0) * 2.8 + pow(k, 46.0) * 0.11);
    float2 sb = (su - float2(-0.44, 0.46)) * float2(2.0, 4.4);
    c += box * exp(-dot(sb, sb) * 2.2) * 0.26;
    c += glint * pow(max(dot(N, H2), 0.0), 120.0) * 0.34;
    float e = smoothstep(0.86, 1.0, length(su));
    c += edgeC * e * pow(1.0 - z, 1.6) * 0.26;
    c += rimC * pow(smoothstep(0.972, 1.0, length(su)), 0.75) * 0.26;
    return c;
}

float lm_mb(float3 p, float t, float k, float dropScale, float dentAmp) {
    float d = length(p - float3(sin(t * 0.31) * 0.15, cos(t * 0.26) * 0.13, sin(t * 0.22) * 0.13)) - 0.29 * dropScale;
    d = lm_smin(d, length(p - float3(cos(t * 0.24 + 1.1) * 0.22, sin(t * 0.33 + 0.4) * 0.19, cos(t * 0.29) * 0.15)) - 0.21 * dropScale, k);
    d = lm_smin(d, length(p - float3(sin(t * 0.19 + 2.4) * 0.25, cos(t * 0.21 + 2.0) * 0.23, sin(t * 0.27 + 1.0) * 0.17)) - 0.16 * dropScale, k * 0.9);
    return d + (lm_fbm(p * 3.4 + float3(0.0, t * 0.11, 0.0)) - 0.5) * dentAmp;
}

float3 lm_mbN(float3 p, float t, float k, float dropScale, float dentAmp) {
    float2 e = float2(0.0035, 0.0);
    return normalize(float3(lm_mb(p + e.xyy, t, k, dropScale, dentAmp) - lm_mb(p - e.xyy, t, k, dropScale, dentAmp),
                            lm_mb(p + e.yxy, t, k, dropScale, dentAmp) - lm_mb(p - e.yxy, t, k, dropScale, dentAmp),
                            lm_mb(p + e.yyx, t, k, dropScale, dentAmp) - lm_mb(p - e.yyx, t, k, dropScale, dentAmp)));
}

half4 main(float2 position) {
    float2 size = uResolution;
    float2 fc = float2(position.x, size.y - position.y);
    float2 uv = (2.0 * fc - size) / max(min(size.x, size.y), 1.0);

    float  t     = uTime * speed;
    float  rad   = max(radius, 0.05);
    float  mrg   = max(merge, 0.005);
    float3 tint  = float3(tintColor.rgb);
    float3 wall0 = float3(wallColor.rgb);
    float3 wall1 = float3(wallTopColor.rgb);
    float3 lamp1 = float3(lampColor.rgb);
    float3 lamp2 = float3(lamp2Color.rgb);

    float2 su = (uv - float2(0.0, 0.06)) / rad;
    float  r  = length(su);

    float3 col = lm_studioBG(uv, wall0, wall1, lamp1, lamp2);
    col += tint * exp(-max(r - 1.0, 0.0) * 7.0) * 0.05 * glow;

    if (r < 1.004 + mf_edge_d(edgeSoftness)) {
        float  m = lm_sstep(1.0 + mf_edge_d(edgeSoftness), 1.0 - edgeSoftness, r);
        float  z = sqrt(max(1.0 - r * r, 0.0));
        float3 N = float3(su, z);
        float  F = lm_schlick(z, 0.045);
        float3 D = refract(float3(0.0, 0.0, -1.0), N, 1.0 / 1.52);
        float3 bg = lm_bgThrough(uv, N, wall0, wall1, lamp1, lamp2);

        float3 P0 = N * 0.997;
        float  exitT = lm_sphExit(P0, D);
        float  td = 0.012, hit = 0.0;
        float3 hp = P0;
        for (int i = 0; i < 40; i++) {
            hp = P0 + D * td;
            float d = lm_mb(hp, t, mrg, drops, ripple);
            if (d < 0.0028) { hit = 1.0; break; }
            td += max(d * 0.85, 0.006);
            if (td > exitT) break;
        }

        float3 inner = bg;
        if (hit > 0.5) {
            float3 Nm = lm_mbN(hp, t, mrg, drops, ripple);
            float3 L1 = normalize(float3(-0.60, 0.64, 0.48));
            float3 R  = reflect(D, Nm);
            float3 env = lm_studioBG(uv * 0.55 + R.xy * 0.72, wall0, wall1, lamp1, lamp2) * 7.5;
            env += float3(keyColor.rgb) * pow(max(dot(R, L1), 0.0), 900.0) * 9.0;
            env += float3(sheenColor.rgb) * pow(max(dot(R, L1), 0.0), 22.0) * 0.55;
            env += float3(bloomColor.rgb) * pow(max(dot(R, L1), 0.0), 4.0) * 0.30;
            env += mix(float3(iriColor.rgb), float3(iriTintColor.rgb), 0.5 + 0.5 * R.x)
                 * pow(1.0 - abs(R.y), 3.0) * 0.42 * iridescence;
            env += float3(bounceColor.rgb) * lm_sstep(0.2, -0.9, R.y) * 0.16;
            float fr = lm_schlick(max(dot(-D, Nm), 0.0), 0.55);
            MfRamp pal = mf_ramp_of(paletteCount,
                                    float3(paletteStop0.rgb), float3(paletteStop1.rgb),
                                    float3(paletteStop2.rgb), float3(paletteStop3.rgb),
                                    float3(paletteStop4.rgb), float3(paletteStop5.rgb),
                                    float3(paletteStop6.rgb), float3(paletteStop7.rgb),
                                    float3(paletteStop8.rgb), float3(paletteStop9.rgb),
                                    float3(paletteStop10.rgb), float3(paletteStop11.rgb));

            inner = env * (paletteCount > 0.5
                             ? mf_ramp_linR(fr, pal)
                             : mix(float3(metalColor.rgb), float3(fresnelColor.rgb), fr));
            inner *= 0.52 + 0.48 * smoothstep(-0.85, 0.35, Nm.y);
        } else {
            inner += tint * lm_fbm(hp * 2.0 + lm_knead(t, 0.15, 0.12, 0.10, 0.7) * 0.35) * 0.05;
        }

        inner *= exp(-pow(1.0 - z, 2.0) * 0.60);
        float3 c = inner * (1.0 - F) * (0.35 + 0.65 * glow);
        c += lm_glassHi(N, su, z, float3(specularColor.rgb), float3(softboxColor.rgb),
                        float3(glintColor.rgb), float3(edgeColor.rgb), float3(rimColor.rgb));
        col = mix(col, c, m);
    }

    col = pow(lm_aces(col * max(exposure, 0.0)), float3(1.0 / 2.2));
    float3 edged = mf_edge_glow(col, uv, float2(0.0, 0.06), rad,
                                edgeSoftness, edgeGlow, float3(glowColor.rgb));
    return half4(half3(clamp(edged, 0.0, 1.0)), 1.0);
}
`)!;

export default function OrbLiquidMetalView() {
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
