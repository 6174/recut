import React from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float speed = 1.0;
const float radius = 0.86;
const float flow = 0.26;
const float turbulence = 0.12;
const float scale = 1.6;
const float marble = 1.9;
const float wobble = 1.0;
const float shimmer = 0.12;
const float refraction = 0.85;
const float contrast = 1.1;
const float bias = 0.0;
const float fringe = 0.45;
const float iridescence = 0.0;
const float rim = 0.7;
const float glint = 0.85;
const float innerGlow = 0.6;
const float halo = 0.0;
const float grain = 1.0;
const float seed = 1.0;
const float exposure = 1.0;
const float edgeSoftness = 0.005;
const float edgeGlow = 0.0;
const float paletteCount = 0.0;
const float2 light = float2(-0.62, -0.78);
const half4 colorA = half4(0.054902, 0.603922, 0.654902, 1.0);
const half4 colorB = half4(0.658824, 0.941176, 0.909804, 1.0);
const half4 colorC = half4(0.94902, 1.0, 0.992157, 1.0);
const half4 rimColor = half4(1.0, 1.0, 1.0, 1.0);
const half4 glintColor = half4(1.0, 1.0, 1.0, 1.0);
const half4 iridColor = half4(0.317647, 0.184314, 0.498039, 1.0);
const half4 glowColor = half4(0.054902, 0.603922, 0.654902, 1.0);
const half4 paletteStop0 = half4(0.054902, 0.603922, 0.654902, 1.0);
const half4 paletteStop1 = half4(0.176471, 0.67451, 0.713725, 1.0);
const half4 paletteStop2 = half4(0.419608, 0.811765, 0.815686, 1.0);
const half4 paletteStop3 = half4(0.623529, 0.92549, 0.898039, 1.0);
const half4 paletteStop4 = half4(0.670588, 0.945098, 0.913725, 1.0);
const half4 paletteStop5 = half4(0.760784, 0.968627, 0.945098, 1.0);
const half4 paletteStop6 = half4(0.890196, 0.992157, 0.976471, 1.0);
const half4 paletteStop7 = half4(0.94902, 1.0, 0.992157, 1.0);
const half4 paletteStop8 = half4(0.94902, 1.0, 0.992157, 1.0);
const half4 paletteStop9 = half4(0.94902, 1.0, 0.992157, 1.0);
const half4 paletteStop10 = half4(0.94902, 1.0, 0.992157, 1.0);
const half4 paletteStop11 = half4(0.94902, 1.0, 0.992157, 1.0);

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

const float LQO_PI2 = 6.28318530718;

const float LQO_LOOP  = 8.0;
const float LQO_SOFT  = 1.6;
const float LQO_GRAIN = 0.045;

float lqo_hash(float2 p) {
    p = fract(p * float2(127.1, 311.7));
    p += float2(dot(p, p + float2(34.56)));
    return fract(p.x * p.y);
}

float lqo_noise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 w = f * f * (3.0 - 2.0 * f);
    return mix(mix(lqo_hash(i), lqo_hash(i + float2(1.0, 0.0)), w.x),
               mix(lqo_hash(i + float2(0.0, 1.0)), lqo_hash(i + float2(1.0, 1.0)), w.x),
               w.y);
}

float lqo_fbm(float2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * lqo_noise(p);
        p = float2(1.6 * p.x - 1.2 * p.y, 1.2 * p.x + 1.6 * p.y);
        a *= 0.5;
    }
    return v;
}

float3 lqo_srgb(float3 cIn) {
    float3 c = clamp(cIn, 0.0, 1.0);
    return mix(12.92 * c, 1.055 * pow(c, float3(1.0 / 2.4)) - float3(0.055),
               step(float3(0.0031308), c));
}

float3 lqo_okl(float3 cs) {
    float3 hi  = pow((cs + float3(0.055)) / 1.055, float3(2.4));
    float3 lo  = cs / 12.92;
    float3 lin = mix(hi, lo, step(cs, float3(0.04045)));
    float l = pow(dot(float3(0.4122214708, 0.5363325363, 0.0514459929), lin), 1.0 / 3.0);
    float m = pow(dot(float3(0.2119034982, 0.6806995451, 0.1073969566), lin), 1.0 / 3.0);
    float s = pow(dot(float3(0.0883024619, 0.2817188376, 0.6299787005), lin), 1.0 / 3.0);
    return float3(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
                  1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                  0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}

float3 lqo_lab2lin(float3 c) {
    float l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
    float m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
    float s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
    float3 L = float3(l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_);
    return float3(dot(float3( 4.0767416621, -3.3077115913,  0.2309699292), L),
                  dot(float3(-1.2684380046,  2.6097574011, -0.7034186147), L),
                  dot(float3(-0.0041960863, -0.7034186147,  1.7076147010), L));
}

float3 lqo_pal(float x, float3 A, float3 B, float3 C) {
    float s = clamp(x, 0.0, 1.0) * 2.0;
    float i = min(floor(s), 1.0);
    float ff = s - i;
    float f = ff * ff * (3.0 - 2.0 * ff);
    float3 a = i < 0.5 ? A : B;
    float3 b = i < 0.5 ? B : C;
    float3 c = mix(a, b, f);
    float k = 1.0 + 0.5 * f * (1.0 - f);
    return float3(c.x, c.y * k, c.z * k);
}

half4 main(float2 position) {
    float2 size = uResolution;
    float2 fc = float2(position.x, size.y - position.y);
    float  mn = max(min(size.x, size.y), 1.0);
    float2 uv = (2.0 * fc - size) / mn;

    float R0 = max(radius, 0.05);
    float rr = length(uv);

    float px = 2.0 / mn;
    float aa = px * max(1.25, LQO_SOFT);
    float haloOuter = R0 + 0.125;

    float rMax = max(R0 * (1.0 + wobble * 0.044) + aa, haloOuter) + mf_edge_d(edgeSoftness);
    if (rr > rMax) {
        float3 out0 = mf_edge_glow(float3(0.0), uv, float2(0.0), R0,
                                   edgeSoftness, edgeGlow, float3(glowColor.rgb));
        return half4(half3(clamp(out0, 0.0, 1.0)), 1.0);
    }

    float ph  = fract(uTime * speed / LQO_LOOP);
    float ANG = LQO_PI2 * ph;

    float th  = atan(uv.y, uv.x);
    float wob = wobble * (0.020 * sin(3.0 * th - ANG + 0.7)
                        + 0.014 * sin(5.0 * th + 2.0 * ANG + 2.1)
                        + 0.010 * sin(7.0 * th - 3.0 * ANG + 4.4));
    float Rl  = R0 * (1.0 + wob);

    float  sN = rr / Rl;
    float  z  = sqrt(max(1.0 - sN * sN, 0.0));
    float2 pn = uv / Rl;
    float2 pu = normalize(pn + float2(1e-5, 0.0));
    float2 Ld = normalize(light);

    float2 q0 = pn * mix(1.0, 0.55 + 0.45 * z, refraction * 0.8);
    float2 q  = q0 + float2(seed * 11.17, seed * 5.31);

    float  ph1 = LQO_PI2 * lqo_fbm(q * 1.05 + float2(3.7, 17.3));
    float  am1 = 0.55 + 0.9 * lqo_fbm(q * 0.85 + float2(27.1, 9.4));
    float2 o1  = flow * am1 * float2(cos(ANG + ph1), sin(ANG + ph1));
    float  ph2 = LQO_PI2 * lqo_fbm(q * 2.7 + float2(43.9, 5.2));
    float  am2 = 0.45 + 0.9 * lqo_fbm(q * 3.1 + float2(8.8, 31.7));
    float2 o2  = turbulence * am2 * float2(cos(ph2 - ANG), sin(ph2 - ANG));
    float2 wp  = (q + o1 + o2) * scale;
    float  n1  = lqo_fbm(wp + marble * float2(lqo_fbm(wp + float2(5.2, 1.3)),
                                              lqo_fbm(wp + float2(9.7, 8.1))));

    float x = (n1 - 0.5) * contrast + 0.5 + bias;

    float shim = shimmer * sin(ANG + LQO_PI2 * lqo_fbm(q * 0.75 + float2(61.3, 2.9)));
    float cs = cos(shim);
    float sn = sin(shim);

    float band = smoothstep(0.45, 1.0, sN);
    float fr   = fringe * band;

    float  shade = 0.045 * sN * dot(pu, Ld);
    float2 gp    = -Ld * 0.40;
    float  glow  = innerGlow * exp(-dot(pn - gp, pn - gp) * 2.6);
    float  ib    = clamp(iridescence * smoothstep(0.55, 0.95, sN)
                         * (0.6 + 0.4 * sin(2.0 * th + ANG)), 0.0, 1.0);

    MfRamp pal = mf_ramp_of(paletteCount,
                            float3(paletteStop0.rgb), float3(paletteStop1.rgb),
                            float3(paletteStop2.rgb), float3(paletteStop3.rgb),
                            float3(paletteStop4.rgb), float3(paletteStop5.rgb),
                            float3(paletteStop6.rgb), float3(paletteStop7.rgb),
                            float3(paletteStop8.rgb), float3(paletteStop9.rgb),
                            float3(paletteStop10.rgb), float3(paletteStop11.rgb));
    float3 oklA = lqo_okl(float3(colorA.rgb));
    float3 oklB = lqo_okl(float3(colorB.rgb));
    float3 oklC = lqo_okl(float3(colorC.rgb));
    float2 iridAB = lqo_okl(float3(iridColor.rgb)).yz;

    float3 lin = float3(0.0);
    float off0 = -0.05 * fr;
    float off2 =  0.05 * fr;
    float3 L3;

    L3 = lqo_pal(x + off0, oklA, oklB, oklC);
    L3 = paletteCount > 0.5 ? lqo_okl(mf_ramp_linR(x + off0, pal)) : L3;
    L3 = float3(L3.x, cs * L3.y - sn * L3.z, sn * L3.y + cs * L3.z);
    L3.x += shade + 0.10 * glow + 0.04 * ib;
    L3.y *= 1.0 - 0.45 * glow;
    L3.z *= 1.0 - 0.45 * glow;
    L3.y = mix(L3.y, iridAB.x, ib);
    L3.z = mix(L3.z, iridAB.y, ib);
    lin.x = lqo_lab2lin(L3).x;

    L3 = lqo_pal(x, oklA, oklB, oklC);
    L3 = paletteCount > 0.5 ? lqo_okl(mf_ramp_linR(x, pal)) : L3;
    L3 = float3(L3.x, cs * L3.y - sn * L3.z, sn * L3.y + cs * L3.z);
    L3.x += shade + 0.10 * glow + 0.04 * ib;
    L3.y *= 1.0 - 0.45 * glow;
    L3.z *= 1.0 - 0.45 * glow;
    L3.y = mix(L3.y, iridAB.x, ib);
    L3.z = mix(L3.z, iridAB.y, ib);
    lin.y = lqo_lab2lin(L3).y;

    L3 = lqo_pal(x + off2, oklA, oklB, oklC);
    L3 = paletteCount > 0.5 ? lqo_okl(mf_ramp_linR(x + off2, pal)) : L3;
    L3 = float3(L3.x, cs * L3.y - sn * L3.z, sn * L3.y + cs * L3.z);
    L3.x += shade + 0.10 * glow + 0.04 * ib;
    L3.y *= 1.0 - 0.45 * glow;
    L3.z *= 1.0 - 0.45 * glow;
    L3.y = mix(L3.y, iridAB.x, ib);
    L3.z = mix(L3.z, iridAB.y, ib);
    lin.z = lqo_lab2lin(L3).z;

    float3 eSc = float3(1.0) + fringe * float3(0.006, 0.0, -0.006);
    float aEdge = 1.0 - smoothstep(-aa - mf_edge_d(edgeSoftness),
                                    aa + mf_edge_d(edgeSoftness), rr - Rl);
    float3 rim3 = rim * float3(pow(smoothstep(0.55, 1.0, rr / (Rl * eSc.x)), 4.0),
                               pow(smoothstep(0.55, 1.0, rr / (Rl * eSc.y)), 4.0),
                               pow(smoothstep(0.55, 1.0, rr / (Rl * eSc.z)), 4.0));

    float3 nrm  = float3(pn.x, pn.y, z);
    float3 H    = normalize(float3(Ld * 0.85, 0.55));
    float  spec = pow(max(dot(nrm, H), 0.0), 48.0) * glint * (0.4 + 0.6 * z);
    lin += rim3 * float3(rimColor.rgb) + spec * float3(glintColor.rgb);

    float3 col = lqo_srgb(max(lin * max(exposure, 0.0), float3(0.0)));

    float grainF = floor(ph * 24.0);
    float g = lqo_hash(floor(fc) + float2(grainF * 17.13, grainF * 7.77)) - 0.5;
    col += float3(g * LQO_GRAIN * grain);

    float w = clamp(1.0 - (rr - Rl) / max(haloOuter - Rl, 1e-4), 0.0, 1.0);
    float haloA = (halo > 0.001 && rr > Rl) ? halo * 0.85 * pow(w, 2.4) : 0.0;
    float3 hc = lqo_okl(float3(colorA.rgb));
    hc = float3(min(1.0, hc.x + 0.12), hc.y * 0.85, hc.z * 0.85);
    float3 haloRGB = lqo_srgb(max(lqo_lab2lin(hc), float3(0.0)));

    float3 outc = col * aEdge + haloRGB * (haloA * (1.0 - aEdge));
    outc = mf_edge_glow(outc, uv, float2(0.0), R0,
                        edgeSoftness, edgeGlow, float3(glowColor.rgb));
    return half4(half3(clamp(outc, 0.0, 1.0)), 1.0);
}
`)!;

export default function OrbDropView() {
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
