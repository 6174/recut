import React from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue, useSharedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float speed = 1.0;
const float cycle = 5.0;
const float tunnelTime = 2.5;
const float pause = 2.0;
const float start = 0.0;
const float repeats = 1.0;
const float stars = 1.5;
const float starDensity = 1.0;
const float starLayers = 3.0;
const float starSize = 1.0;
const float starLength = 1.0;
const float starSpeed = 1.0;
const float starSpread = 1.0;
const float twinkle = 1.0;
const float warpGlow = 0.7;
const float tunnelBright = 1.0;
const float tunnelGlow = 1.0;
const float exposure = 1.7;
const float vignette = 0.3;
const float style = 0.0;
const half4 tint = half4(0.498039, 0.823529, 1.0, 1.0);
const half4 starTint = half4(0.8, 0.878431, 1.0, 1.0);
const half4 core = half4(1.0, 1.0, 1.0, 1.0);
const half4 flare = half4(1.0, 1.0, 1.0, 1.0);

const float HS_TAU = 6.28318530718;

float hs_sstep(float e0, float e1, float x) {
    float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

float hs_h1(float n) {
    return fract(sin(n * 127.1) * 43758.5453);
}

float hs_h13(float3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}

float hs_n3(float3 p) {
    float3 i = floor(p);
    float3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hs_h13(i);
    float b = hs_h13(i + float3(1.0, 0.0, 0.0));
    float c = hs_h13(i + float3(0.0, 1.0, 0.0));
    float d = hs_h13(i + float3(1.0, 1.0, 0.0));
    float e = hs_h13(i + float3(0.0, 0.0, 1.0));
    float g = hs_h13(i + float3(1.0, 0.0, 1.0));
    float h = hs_h13(i + float3(0.0, 1.0, 1.0));
    float k = hs_h13(i + float3(1.0, 1.0, 1.0));
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
               mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}

float hs_fbm(float3 p) {
    float s = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) { s += amp * hs_n3(p); p *= 2.03; amp *= 0.5; }
    return s;
}

float hs_vn1(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hs_h1(i), hs_h1(i + 1.0), f);
}

float hs_ringNoise(float a01, float L, float seed) {
    float x = a01 * L;
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hs_h1(mod(i, L) + seed), hs_h1(mod(i + 1.0, L) + seed), f);
}

float3 hs_colorize(float lum, float3 tnt, float3 cre) {
    float3 deep = tnt * 0.16;
    float3 col = mix(deep, tnt * 0.9, clamp(lum, 0.0, 1.0));
    return mix(col, mix(tnt, cre, 0.75),
               clamp(pow(max(lum, 0.0), 3.0) * 0.65, 0.0, 1.0));
}

float3 hs_tunnelTail(float3 col, float r, float3 tnt, float3 cre, float glow) {
    col += (tnt * 0.5 + 0.5) * exp(-r * 3.5) * 1.1 * glow;
    col += cre * exp(-r * 10.0) * 1.3 * glow;
    return col * (0.8 + 0.5 * hs_sstep(1.6, 0.2, r));
}

float3 hs_starField(float r, float a01, float time, float stretch, float warpT,
                    float3 tnt, float3 stt, float3 cre,
                    float bright, float density, float layers, float size,
                    float lengthK, float speedK, float spread, float twk, float glow) {
    float3 col = float3(0.0);
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float lw = clamp(layers - fi, 0.0, 1.0);
        float L = max(floor((120.0 + fi * 70.0) * density + 0.5), 4.0);
        float x = a01 * L + fi * 0.37 * L;
        float id = mod(floor(x), L);
        float fa = fract(x) - 0.5;
        float rnd  = hs_h1(id + fi * 57.7 + L * 1.3);
        float rnd2 = hs_h1(id * 2.3 + fi * 11.7 + 5.0);
        float spd = mix(0.04, 0.22, rnd2) * (1.0 + stretch * 6.0) * speedK;
        float ph = fract(rnd + warpT * spd);
        float rr = pow(ph, 1.8) * 1.7 * spread + 0.015;
        float head = 0.004 * size;
        float len = 0.006 * size + stretch * (0.05 + rr * 1.1) * lengthK;
        float dr = r - rr;
        float radial = hs_sstep(head, -head, dr) * hs_sstep(-len, -len * 0.1, dr);
        float along = clamp((dr + len) / len, 0.0, 1.0);
        radial *= along * along;
        float w = (0.003 + 0.004 * rnd2) * (0.35 + r * 0.8) * size;
        float lat = abs(fa) * (HS_TAU / L) * r;
        float lateral = hs_sstep(w, w * 0.2, lat);
        float tw = 1.0 - 0.25 * twk + 0.25 * twk * sin(time * (1.5 + rnd * 3.0) + rnd * 40.0);
        float b = radial * lateral * tw * hs_sstep(0.02, 0.12, r);
        float3 scol = mix(stt, mix(tnt, cre, 0.6), rnd2);
        col += scol * b * (1.1 - 0.22 * fi) * bright * lw;
    }
    col += tnt * exp(-r * 4.5) * stretch * glow;
    return col;
}

float3 hs_tunnelKessel(float r, float a, float a01, float warpT, float3 tnt, float3 cre,
                       float bright, float glow) {
    float z = 0.3 / (r + 0.07);
    float ca = a + z * 0.45 - warpT * 0.12;
    float3 q = float3(cos(ca), sin(ca), 0.0) * 1.1;
    q.z = z * 0.8 - warpT * 1.35;
    float n = hs_fbm(q * 2.2);
    n += 0.5 * hs_fbm(q * 5.0 + float3(n * 1.5));
    n *= 0.72;
    float rays = pow(hs_ringNoise(a01, 110.0, 31.7), 3.0);
    rays *= 0.45 + 0.85 * hs_vn1(z * 2.5 - warpT * 3.0 + rays * 9.0);
    float lum = n * n * 1.9 + rays * 0.55 * hs_sstep(0.12, 0.5, r) * n;
    return hs_tunnelTail(hs_colorize(lum * bright, tnt, cre), r, tnt, cre, glow);
}

float3 hs_tunnelRays(float r, float a, float a01, float warpT, float3 tnt, float3 cre,
                     float bright, float glow) {
    float z = 0.3 / (r + 0.07);
    float wide = pow(hs_ringNoise(a01, 64.0, 4.1), 5.0);
    wide *= 0.25 + 1.1 * hs_vn1(z * 1.2 - warpT * 4.6 + wide * 5.0);
    float fine = pow(hs_ringNoise(a01, 300.0, 19.7), 9.0);
    fine *= 0.3 + 1.2 * hs_vn1(z * 2.6 - warpT * 8.5 + fine * 9.0);
    float lum = (wide * 2.6 + fine * 3.2) * hs_sstep(0.02, 0.35, r);
    return hs_tunnelTail(hs_colorize(lum * bright, tnt, cre), r, tnt, cre, glow);
}

float3 hs_tunnelStorm(float r, float a, float a01, float warpT, float3 tnt, float3 cre,
                      float bright, float glow) {
    float z = 0.3 / (r + 0.07);
    float3 q = float3(cos(a), sin(a), 0.0) * 1.2;
    q.z = z * 1.1 - warpT * 2.6;

    float n = hs_fbm(q * 2.6);
    float arc = pow(1.0 - min(abs(n - 0.5) * 3.4, 1.0), 8.0);
    float flick = 0.55 + 0.45 * hs_vn1(warpT * 24.0 + floor(a01 * 20.0) * 3.7);

    float lum = arc * 3.2 * flick * hs_sstep(0.02, 0.32, r) + exp(-r * 2.2) * 0.45;
    return hs_tunnelTail(hs_colorize(lum * bright, tnt, cre), r, tnt, cre, glow);
}

float3 hs_tunnelShards(float r, float a, float a01, float warpT, float3 tnt, float3 cre,
                       float bright, float glow) {
    float z = 0.3 / (r + 0.07);
    float lum = 0.0;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float L = 42.0 + fi * 30.0;
        float x = a01 * L + fi * 0.41 * L;
        float id = mod(floor(x), L);
        float lat = abs(fract(x) - 0.5) * 2.0;
        float rnd = hs_h1(id + fi * 23.1);

        float travel = fract(z * 0.45 - warpT * (1.5 + rnd * 1.2) + rnd);
        float dash = hs_sstep(0.22, 0.02, travel) * hs_sstep(0.0, 0.05, travel);
        float thin = hs_sstep(0.45 + 0.3 * rnd, 0.05, lat);
        lum += dash * thin * (1.5 - 0.3 * fi);
    }
    lum = lum * 1.5 * hs_sstep(0.03, 0.30, r) + exp(-r * 3.0) * 0.25;
    return hs_tunnelTail(hs_colorize(lum * bright, tnt, cre), r, tnt, cre, glow);
}

float3 hs_pickTunnel(int s, float r, float a, float a01, float warpT, float3 tnt, float3 cre,
                     float bright, float glow) {
    if (s == 1) return hs_tunnelRays(r, a, a01, warpT, tnt, cre, bright, glow);
    if (s == 2) return hs_tunnelStorm(r, a, a01, warpT, tnt, cre, bright, glow);
    if (s == 3) return hs_tunnelShards(r, a, a01, warpT, tnt, cre, bright, glow);
    return hs_tunnelKessel(r, a, a01, warpT, tnt, cre, bright, glow);
}

half4 main(float2 position) {
    float2 size = max(uResolution, float2(1.0));

    float tunnelLen = clamp(tunnelTime, 0.0, max(cycle - 0.2, 0.0));
    float rest  = max(cycle - tunnelLen, 0.0);
    float accel = rest * 0.48;
    float fIn   = rest * 0.10;
    float fOut  = rest * 0.10;
    float decel = rest * 0.32;

    float tA = accel;
    float tB = tA + fIn;
    float tC = tB + tunnelLen;
    float tD = tC + fOut;
    float tE = tD + decel;

    float period = max(tE + pause, 0.0001);
    float clock  = uTime + start;
    float loops  = repeats > 0.5 ? floor(clock / period) : 0.0;
    float lt     = clock - loops * period;

    float accelDist = accel * 0.25;
    float base = accelDist + fIn + 3.2 * (tunnelLen + fOut);
    float wEnd = base + decel / 3.5;

    float warped;
    if (lt < tA) {
        float k = accel > 0.0 ? lt / accel : 1.0;
        warped = accel * pow(k, 4.0) * 0.25;
    } else if (lt < tB) {
        warped = accelDist + (lt - tA);
    } else if (lt < tD) {
        warped = accelDist + fIn + 3.2 * (lt - tB);
    } else if (lt < tE) {
        float k = decel > 0.0 ? (lt - tD) / decel : 1.0;
        warped = base + decel * (1.0 - pow(1.0 - k, 3.5)) / 3.5;
    } else {
        warped = wEnd;
    }
    float warpT = (0.10 * clock + loops * wEnd + warped) * speed;

    float fadeIn  = max(fIn * 2.0, 0.12);
    float fadeOut = max(fOut * 2.0, 0.12);
    float stretch = 0.0;
    float flash = 0.0;
    float tunnelMix = 0.0;
    if (lt < tA) {
        float k = accel > 0.0 ? lt / accel : 1.0;
        stretch = k * k * k;
    } else if (lt < tB) {
        stretch = 1.0;
        flash = fIn > 0.0 ? (lt - tA) / fIn : 1.0;
    } else if (lt < tC) {
        stretch = 1.0;
        tunnelMix = 1.0;
        flash = max(0.0, 1.0 - (lt - tB) / fadeIn);
    } else if (lt < tD) {
        stretch = 1.0;
        tunnelMix = 1.0;
        flash = fOut > 0.0 ? (lt - tC) / fOut : 1.0;
    } else if (lt < tE) {
        float k = decel > 0.0 ? (lt - tD) / decel : 1.0;
        stretch = pow(1.0 - k, 2.5);
        flash = max(0.0, 1.0 - (lt - tD) / fadeOut);
    }

    float3 tintC  = float3(tint.rgb);
    float3 starC  = float3(starTint.rgb);
    float3 coreC  = float3(core.rgb);
    float3 flashC = float3(flare.rgb) * float3(1.03, 1.03, 1.06);

    float2 p = (2.0 * position - size) / size.y;
    p += float2(sin(clock * 43.7), cos(clock * 37.3)) * 0.006 * (stretch * 0.7 + tunnelMix * 0.35);

    float r = length(p);
    float a = atan(p.y, p.x);
    float a01 = a / HS_TAU + 0.5;

    float3 sc = hs_starField(r, a01, clock, stretch, warpT, tintC, starC, coreC,
                             stars, starDensity, starLayers, starSize, starLength,
                             starSpeed, starSpread, twinkle, warpGlow);

    float3 tc = float3(0.0);
    if (tunnelMix > 0.0) {
        tc = hs_pickTunnel(int(style + 0.5), r, a, a01, warpT, tintC, coreC,
                           tunnelBright, tunnelGlow);
    }

    float3 col = mix(sc, tc, tunnelMix) + sc * tunnelMix * 0.22;
    col *= 1.0 - vignette * hs_sstep(0.85, 1.5, r);
    col = mix(col, flashC, clamp(flash, 0.0, 1.0));
    col = 1.0 - exp(-col * exposure);
    col = pow(max(col, float3(0.0)), float3(0.85));
    return half4(half3(col), 1.0);
}
`)!;

const RUN_SECONDS = 5;

function runTime(startedAt: number, clock: number) {
    "worklet";
    const epoch = startedAt < 0 ? -RUN_SECONDS * 1000 : startedAt;
    return (clock - epoch) / 1000;
}

const triggerStyles = StyleSheet.create({
    button: {
        position: "absolute",
        alignSelf: "center",
        bottom: 44,
        borderRadius: 999,
        paddingHorizontal: 26,
        paddingVertical: 14,
        backgroundColor: "#FFFFFF",
    },
    label: { fontSize: 17, fontWeight: "600", color: "#000000" },
});

export default function HyperspaceView() {
    const { width, height } = useWindowDimensions();
    const clock = useClock();
    const startedAt = useSharedValue(-1);
    const uniforms = useDerivedValue(() => ({
        uResolution: [width, height],
        uTime: runTime(startedAt.value, clock.value),
    }));

    return (
        <View style={{ flex: 1 }}>
            <Canvas style={StyleSheet.absoluteFill}>
                <Fill>
                    <Shader source={SOURCE} uniforms={uniforms} />
                </Fill>
            </Canvas>
            <Pressable
                style={triggerStyles.button}
                onPress={() => {
                    startedAt.value = clock.value;
                }}
            >
                <Text numberOfLines={1} style={triggerStyles.label}>Jump to lightspeed</Text>
            </Pressable>
        </View>
    );
}
