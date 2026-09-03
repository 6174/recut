import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue, useSharedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;
uniform float style;
uniform float progress;
uniform float alive;
uniform float warp;
uniform float scale;
uniform float amount;
uniform float lag;
uniform float echo;
uniform float bloom;
uniform float jitter;
uniform float frontIn;
uniform float frontOut;
uniform float pulse;
uniform float pulseRate;
uniform float stagger;
uniform half4 background;
uniform half4 color1;
uniform half4 color2;
uniform half4 color3;
uniform half4 color4;
uniform half4 color5;
uniform half4 color6;
uniform half4 color7;

const float grain = 0.01;
const float feather = 1.0;
const float churn = 1.0;
const float ripple = 1.0;
const float falloff = 1.0;
const float trails = 3.0;
const float trailGlow = 1.0;
const float haze = 1.0;
const float vignette = 1.0;
const float cellSize = 1.0;
const float fill = 1.0;
const float density = 1.0;
const float turbulence = 1.0;
const float sparkle = 1.0;

float mfp_h21(float2 p0) {
    float2 p = fract(p0 * float2(123.34, 345.45));
    p += float2(dot(p, p + float2(34.345, 34.345)));
    return fract(p.x * p.y);
}

float mfp_vn(float2 p0) {
    float2 i = floor(p0);
    float2 f = fract(p0);
    float2 w = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mfp_h21(i), mfp_h21(i + float2(1.0, 0.0)), w.x),
        mix(mfp_h21(i + float2(0.0, 1.0)), mfp_h21(i + float2(1.0, 1.0)), w.x),
        w.y);
}

float mfp_fbm(float2 p0) {
    float v = 0.0;
    float a = 0.5;
    float2 p = p0;
    for (int i = 0; i < 4; i++) {
        v += a * mfp_vn(p);
        p = p * 2.03 + float2(11.7, 11.7);
        a *= 0.5;
    }
    return v;
}

float mfp_mod(float x, float y) {
    return x - y * floor(x / y);
}

float mfp_sstep(float e0, float e1, float x) {
    float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

float mfp_wave(int sid, float y, float tt, float amp) {
    if (sid == 1) {
        float slosh = sin(y * 3.0 * ripple + tt * 0.50 * churn) * 0.95;
        slosh += (y - 0.5) * sin(tt * 0.38 * churn) * 1.30;
        return slosh * amp;
    }
    if (sid == 3) {
        float env = sin(y * 3.14159);
        float w = sin(y * 24.0 * ripple + tt * 1.70 * churn) * 0.70 + sin(y * 11.0 * ripple - tt * 0.95 * churn) * 0.45;
        return w * env * env * amp;
    }
    if (sid == 5) {
        float q = floor(y * scale);
        float s1 = sin(q * 2.10 * ripple + tt * 1.50 * churn);
        float s2 = sin(q * 0.90 * ripple - tt * 0.85 * churn);
        return (s1 * 0.72 + s2 * 0.34) * amp;
    }
    float w = sin(y * 19.0 * ripple + tt * 1.55 * churn) * 0.55
            + sin(y * 31.0 * ripple - tt * 1.05 * churn + 1.3) * 0.24
            + sin(y * 8.5 * ripple + tt * 0.62 * churn) * 0.46;
    w += (mfp_fbm(float2(y * 2.6 * ripple, tt * 0.42 * churn)) - 0.5) * 1.15;
    return w * amp;
}

float3 mfp_liquid(int sid, float2 p, float2 uv, float asp, float t,
                  float uP, float uA, float2 res) {
    float amp = amount * uA;
    float ex = mix(frontIn, asp + frontOut, uP);
    float off = mfp_wave(sid, uv.y, t, amp);
    float d = p.x - (ex + off);
    float px = 1.6 * feather / res.y;
    float inside = 1.0 - smoothstep(-px, px, d);
    float dl = max(0.0, -d);
    float prot = clamp(off / max(amp, 0.0001) * 0.5 + 0.5, 0.0, 1.0);
    float lum = bloom;

    float3 col = float3(color1.rgb);
    col = mix(col, float3(color2.rgb), exp(-dl * 2.1 * falloff));
    col = mix(col, float3(color3.rgb), exp(-dl * 5.2 * falloff) * 0.9);
    col = mix(col, float3(color4.rgb), exp(-dl * 9.0 * falloff) * (0.72 + 0.28 * prot) * lum);
    col = mix(col, float3(color5.rgb), exp(-dl * 17.0 * falloff) * (0.55 + 0.45 * prot) * lum);

    for (int k = 1; k < 7; k++) {
        if (k > int(trails + 0.5)) { break; }
        float fk = float(k);
        float ok = mfp_wave(sid, uv.y, t - fk * lag, amp * (1.0 + fk * 0.22));
        float dk = p.x - (ex + ok - fk * (echo + 0.030 * uA));
        col += float3(color6.rgb) * exp(-abs(dk) * max(0.5, 15.0 - fk * 3.2) * falloff) * (0.34 / fk) * trailGlow;
        col += float3(color7.rgb) * exp(-abs(dk) * max(0.5, 40.0 - fk * 7.0) * falloff) * (0.16 / fk) * lum * trailGlow;
    }

    float hz = mfp_fbm(float2(p.x * 1.6 - t * 0.06 * uA * churn, uv.y * 1.9 + t * 0.05 * uA * churn));
    col *= mix(1.0, 0.86 + 0.28 * hz, haze);
    float vig = smoothstep(0.0, 0.42, uv.y) * mfp_sstep(1.0, 0.58, uv.y);
    col *= mix(1.0, mix(0.78, 1.06, vig), vignette);
    return mix(float3(background.rgb), col, inside);
}

float3 mfp_hex(float2 p, float2 uv, float asp, float t, float uP, float uA) {
    float sc = scale;
    float2 q = float2(p.x * sc, uv.y * sc * 1.15);
    q.x += mfp_mod(floor(q.y), 2.0) * 0.5;
    float2 ci = floor(q);
    float2 cf = fract(q) - 0.5;
    float cell = max(abs(cf.x) * 1.15 + abs(cf.y) * 0.66, abs(cf.y) * 1.32);
    float body = 1.0 - smoothstep(0.46 - 0.04 * feather, 0.46 + 0.04 * feather, cell / cellSize);
    float inner = 1.0 - smoothstep(0.35 - 0.05 * feather, 0.35 + 0.05 * feather, cell / cellSize);
    float cx = (ci.x + 0.5) / sc;
    float front = mix(frontIn, asp + frontOut, uP);
    float lit = smoothstep(0.0, 0.12, front - cx - (mfp_h21(ci) - 0.5) * stagger);
    float puls = (1.0 - pulse) + pulse * sin(t * pulseRate * uA * churn + mfp_h21(ci) * 30.0);
    float3 col = float3(background.rgb);
    col += float3(color1.rgb) * body * 0.85;
    col += float3(color3.rgb) * body * lit * puls;
    col += float3(color2.rgb) * inner * lit * 0.45;
    return col;
}

float3 mfp_smoke(float2 p, float2 uv, float asp, float t, float uP, float uA) {
    float front = mix(frontIn, asp + frontOut, uP);
    float2 w = float2(p.x * scale - t * 0.12 * uA * churn, uv.y * 2.00 + t * 0.05 * uA * churn);
    float n = mfp_fbm(w + float2(mfp_fbm(w * 1.70) * 1.60 * turbulence));
    float dens = mfp_sstep(0.62, 0.05, (p.x - front) * 1.40 * density + (0.5 - n) * 1.50 * turbulence);
    float3 col = float3(background.rgb);
    col += float3(color1.rgb) * dens;
    col += float3(color2.rgb) * pow(dens, 2.20) * 0.80;
    col += float3(color3.rgb) * pow(dens, 7.00) * 0.65;
    return col;
}

float3 mfp_drops(float2 p, float2 uv, float asp, float t, float uP, float uA) {
    float front = mix(frontIn, asp + frontOut, uP);
    float grade = mfp_sstep(front + 0.34, front - 0.30, p.x);
    float g = scale;
    float2 cell = floor(float2(p.x, uv.y) * g);
    float2 cf = fract(float2(p.x, uv.y) * g) - 0.5;
    float rnd = mfp_h21(cell);
    float rnd2 = mfp_h21(cell + float2(13.0, 13.0));
    float jit = uA * jitter;
    float2 off = float2(sin(t * 4.0 * churn + rnd * 40.0), cos(t * 3.1 * churn + rnd2 * 40.0)) * jit;
    float on = step(1.0 - grade * fill, rnd);
    float rad = (0.16 + 0.26 * grade) * cellSize;
    float disc = 1.0 - mfp_sstep(rad - 0.12 * feather, rad + 0.04 * feather, length(cf - off));
    float3 col = float3(background.rgb);
    col += float3(color1.rgb) * grade * 0.55;
    col += mix(float3(color2.rgb), float3(color3.rgb), grade) * disc * on;
    return col;
}

float3 mfp_threads(float2 p, float2 uv, float asp, float t, float uP, float uA, float2 res) {
    float n = scale;
    float ti = floor(uv.y * n);
    float tf = fract(uv.y * n) - 0.5;
    float strand = 1.0 - smoothstep(0.18 * cellSize, 0.42 * cellSize, abs(tf));
    float len = mix(frontIn, asp + frontOut, uP)
              + (mfp_h21(float2(ti, 5.0)) - 0.5) * stagger
              + sin(t * 2.20 * churn + ti * 0.70) * 0.055 * uA;
    float d = p.x - len;
    float px = 1.6 * feather / res.y;
    float on = 1.0 - smoothstep(-px * 2.0, px * 2.0, d);
    float dd = max(0.0, -d);
    float3 col = float3(background.rgb);
    col += float3(color1.rgb) * on * strand;
    col += float3(color2.rgb) * exp(-dd * 3.00 * falloff) * on * strand;
    col += float3(color3.rgb) * exp(-dd * 14.0 * falloff) * on * strand;
    return col;
}

float3 mfp_diamond(float2 p, float2 uv, float asp, float t, float uP, float uA) {
    float sc = scale;
    float2 q = float2((p.x + uv.y) * 0.7071, (uv.y - p.x) * 0.7071) * sc;
    float2 ci = floor(q);
    float2 cf = fract(q) - 0.5;
    float dia = abs(cf.x) + abs(cf.y);
    float cxw = (ci.x - ci.y) * 0.7071 / sc;
    float front = mix(frontIn, asp + frontOut, uP);
    float rnd = mfp_h21(ci);
    float appear = smoothstep(0.02, 0.14, front - cxw - (rnd - 0.5) * stagger);
    float size = mix(0.06, 0.44, appear) * cellSize;
    float tile = 1.0 - mfp_sstep(size - 0.05 * feather, size + 0.02 * feather, dia);
    float puls = (1.0 - pulse) + pulse * sin(t * pulseRate * uA * churn + rnd * 30.0);
    float3 col = float3(background.rgb);
    col += float3(color1.rgb) * mfp_sstep(front + 0.10, front - 0.20, p.x);
    float3 tint = mix(float3(color2.rgb), float3(color3.rgb), rnd);
    col += tint * tile * appear * puls;
    float rim = (1.0 - smoothstep(0.0, 0.06 * feather, abs(dia - size))) * appear;
    col += float3(color4.rgb) * rim * 0.40;
    return col;
}

float3 mfp_grain(float2 p, float2 uv, float asp, float t, float uP, float uA) {
    float front = mix(frontIn, asp + frontOut, uP);
    float grade = mfp_sstep(front + 0.30, front - 0.35, p.x);
    float g = scale;
    float2 cell = floor(float2(p.x, uv.y) * g);
    float rnd = mfp_h21(cell);
    float rnd2 = mfp_h21(cell + float2(9.0, 9.0));
    float flick = mfp_h21(cell + float2(floor(t * 7.0 * uA * churn) * 3.0));
    float on = step(1.0 - grade * fill, rnd * 0.85 + flick * 0.15);
    float3 tint = mix(float3(color1.rgb), float3(color2.rgb), rnd2);
    float3 col = float3(background.rgb) + tint * on * (0.30 + 0.70 * grade);
    col += float3(color3.rgb) * on * step(1.0 - 0.015 * sparkle, rnd2) * grade * 0.85;
    return col;
}

half4 main(float2 position) {
    float2 res = max(uResolution, float2(1.0, 1.0));
    float2 fc = floor(float2(position.x, res.y - position.y)) + float2(0.5, 0.5);
    float2 uv = fc / res;
    float asp = res.x / res.y;
    float2 p = float2(uv.x * asp, uv.y);

    float uP = clamp(progress * 0.01, 0.0, 1.0);
    float uA = clamp(alive, 0.0, 1.0);
    float t = warp;
    int sid = int(style + 0.5);

    float3 col;
    if (sid == 0) { col = mfp_hex(p, uv, asp, t, uP, uA); }
    else if (sid == 2) { col = mfp_smoke(p, uv, asp, t, uP, uA); }
    else if (sid == 4) { col = mfp_drops(p, uv, asp, t, uP, uA); }
    else if (sid == 6) { col = mfp_threads(p, uv, asp, t, uP, uA, res); }
    else if (sid == 7) { col = mfp_diamond(p, uv, asp, t, uP, uA); }
    else if (sid == 8) { col = mfp_grain(p, uv, asp, t, uP, uA); }
    else { col = mfp_liquid(sid, p, uv, asp, t, uP, uA, res); }

    col += float3(mfp_h21(fc) - 0.5) * grain;
    return half4(half3(max(col, float3(0.0))), 1.0);
}
`)!;

const SPEED = 1.0;
const ASPECT = 3.6;
const CORNER = 0.144;

const PALETTES = [
    { scale: 9.5, amount: 0.085, lag: 0.55, echo: 0.055, bloom: 1.0, jitter: 0.3, frontIn: -0.15, frontOut: 0.25, pulse: 0.28, pulseRate: 3.0, stagger: 0.18, background: [0.0745, 0.0627, 0.1255, 1], color1: [0.102, 0.0588, 0.2784, 1], color2: [0.298, 0.2, 0.6, 1], color3: [0.6588, 0.549, 1.0, 1], color4: [0.2784, 0.5804, 1.0, 1], color5: [0.7804, 0.902, 1.0, 1], color6: [0.0588, 0.2392, 0.698, 1], color7: [0.2784, 0.5804, 1.0, 1], caption: "#94808C", behaviour: "seismic" },
    { scale: 9.5, amount: 0.135, lag: 1.4, echo: 0.082, bloom: 0.95, jitter: 0.3, frontIn: -0.12, frontOut: 0.12, pulse: 0.28, pulseRate: 3.0, stagger: 0.18, background: [0.0627, 0.0745, 0.1059, 1], color1: [0.0157, 0.0314, 0.098, 1], color2: [0.0235, 0.0863, 0.2706, 1], color3: [0.0588, 0.2392, 0.698, 1], color4: [0.2784, 0.5804, 1.0, 1], color5: [0.7804, 0.902, 1.0, 1], color6: [0.0588, 0.2392, 0.698, 1], color7: [0.2784, 0.5804, 1.0, 1], caption: "#7D8797", behaviour: "sweep" },
    { scale: 1.3, amount: 0.085, lag: 0.55, echo: 0.055, bloom: 1.0, jitter: 0.3, frontIn: -0.35, frontOut: 0.55, pulse: 0.28, pulseRate: 3.0, stagger: 0.18, background: [0.0745, 0.0627, 0.098, 1], color1: [0.102, 0.0706, 0.1608, 1], color2: [0.4196, 0.2196, 0.7216, 1], color3: [0.8784, 0.7804, 1.0, 1], color4: [0.2784, 0.5804, 1.0, 1], color5: [0.7804, 0.902, 1.0, 1], color6: [0.0588, 0.2392, 0.698, 1], color7: [0.2784, 0.5804, 1.0, 1], caption: "#848D7C", behaviour: "breath" },
    { scale: 9.5, amount: 0.105, lag: 0.42, echo: 0.055, bloom: 1.0, jitter: 0.3, frontIn: -0.12, frontOut: 0.12, pulse: 0.28, pulseRate: 3.0, stagger: 0.18, background: [0.0941, 0.0745, 0.0667, 1], color1: [0.098, 0.0235, 0.0078, 1], color2: [0.251, 0.0706, 0.0157, 1], color3: [0.6784, 0.2, 0.0314, 1], color4: [1.0, 0.4784, 0.1412, 1], color5: [1.0, 0.8392, 0.6196, 1], color6: [0.6784, 0.2, 0.0314, 1], color7: [1.0, 0.4784, 0.1412, 1], caption: "#8F817A", behaviour: "spring" },
    { scale: 110.0, amount: 0.085, lag: 0.55, echo: 0.055, bloom: 1.0, jitter: 0.3, frontIn: -0.3, frontOut: 0.3, pulse: 0.28, pulseRate: 3.0, stagger: 0.18, background: [0.0706, 0.0863, 0.0588, 1], color1: [0.0549, 0.1412, 0.0196, 1], color2: [0.1804, 0.5216, 0.0588, 1], color3: [0.698, 1.0, 0.349, 1], color4: [0.2784, 0.5804, 1.0, 1], color5: [0.7804, 0.902, 1.0, 1], color6: [0.0588, 0.2392, 0.698, 1], color7: [0.2784, 0.5804, 1.0, 1], caption: "#847F94", behaviour: "jitter" },
    { scale: 9.0, amount: 0.072, lag: 0.5, echo: 0.048, bloom: 1.0, jitter: 0.3, frontIn: -0.12, frontOut: 0.12, pulse: 0.28, pulseRate: 3.0, stagger: 0.18, background: [0.1059, 0.1098, 0.1176, 1], color1: [0.0431, 0.0549, 0.0863, 1], color2: [0.1098, 0.149, 0.2392, 1], color3: [0.3216, 0.4196, 0.6196, 1], color4: [0.7216, 0.851, 1.0, 1], color5: [0.9608, 0.9882, 1.0, 1], color6: [0.3216, 0.4196, 0.6196, 1], color7: [0.7216, 0.851, 1.0, 1], caption: "#8B9099", behaviour: "metro" },
    { scale: 64.0, amount: 0.085, lag: 0.55, echo: 0.055, bloom: 1.0, jitter: 0.3, frontIn: -0.1, frontOut: 0.3, pulse: 0.28, pulseRate: 3.0, stagger: 0.32, background: [0.0902, 0.0588, 0.0784, 1], color1: [0.1608, 0.0314, 0.0902, 1], color2: [1.0, 0.3686, 0.6902, 1], color3: [1.0, 0.851, 0.949, 1], color4: [0.2784, 0.5804, 1.0, 1], color5: [0.7804, 0.902, 1.0, 1], color6: [0.0588, 0.2392, 0.698, 1], color7: [0.2784, 0.5804, 1.0, 1], caption: "#8F8083", behaviour: "attract" },
    { scale: 7.5, amount: 0.085, lag: 0.55, echo: 0.055, bloom: 1.0, jitter: 0.3, frontIn: -0.18, frontOut: 0.3, pulse: 0.25, pulseRate: 2.8, stagger: 0.16, background: [0.0941, 0.0627, 0.0706, 1], color1: [0.0745, 0.0431, 0.0549, 1], color2: [0.7216, 0.2, 0.3294, 1], color3: [1.0, 0.5608, 0.4314, 1], color4: [1.0, 0.8, 0.7216, 1], color5: [0.7804, 0.902, 1.0, 1], color6: [0.0588, 0.2392, 0.698, 1], color7: [0.2784, 0.5804, 1.0, 1], caption: "#7C8D85", behaviour: "hop" },
    { scale: 150.0, amount: 0.085, lag: 0.55, echo: 0.055, bloom: 1.0, jitter: 0.3, frontIn: -0.3, frontOut: 0.4, pulse: 0.28, pulseRate: 3.0, stagger: 0.18, background: [0.0784, 0.0667, 0.0941, 1], color1: [0.298, 0.1412, 0.549, 1], color2: [0.698, 0.502, 1.0, 1], color3: [0.9216, 0.851, 1.0, 1], color4: [0.2784, 0.5804, 1.0, 1], color5: [0.7804, 0.902, 1.0, 1], color6: [0.0588, 0.2392, 0.698, 1], color7: [0.2784, 0.5804, 1.0, 1], caption: "#8A8C92", behaviour: "steps" },
    { scale: 9.5, amount: 0.085, lag: 0.55, echo: 0.055, bloom: 1.0, jitter: 0.3, frontIn: -0.12, frontOut: 0.12, pulse: 0.28, pulseRate: 3.0, stagger: 0.18, background: [0.1294, 0.1294, 0.1412, 1], color1: [0.0353, 0.0431, 0.0863, 1], color2: [0.0431, 0.098, 0.2902, 1], color3: [0.0549, 0.3098, 0.7804, 1], color4: [0.2588, 0.7216, 0.9804, 1], color5: [0.6392, 0.9294, 1.0, 1], color6: [0.0745, 0.3294, 0.7608, 1], color7: [0.2, 0.5608, 0.8784, 1], caption: "#84868C", behaviour: "liquid" },
];

function PAL(s: number) {
    "worklet";
    return PALETTES[Math.min(Math.max(Math.round(s), 0), PALETTES.length - 1)];
}

export type ProgressBarColors = {
    track?: string;
    deep?: string;
    mid?: string;
    glow?: string;
    bright?: string;
    core?: string;
    trail?: string;
    trailHot?: string;
};

function HEX(v: string) {
    "worklet";
    const h = v.replace("#", "");
    const c = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return [c(0), c(2), c(4), 1];
}

type ProgressSim = {
    p: number;
    activity: number;
    wt: number;
    frames: number;
    target: number;
    from: number;
    u: number;
    vel: number;
    rate: number;
    mode: string;
    wait: number;
    burst: number;
    clock: number;
    shocks: number;
    seed: number;
    index: number;
};

function rand(s: ProgressSim): number {
    s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0;
    return s.seed / 4294967296;
}

function rnd(s: ProgressSim, a: number, b: number): number {
    return a + rand(s) * (b - a);
}

function b_seismic(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'reset') return bDrain(s, dt, sp);
    s.wait -= dt * sp;
    if (s.wait <= 0) {
      if (s.p >= 0.999) { s.mode = 'reset'; return true; }
      s.shocks = (s.shocks || 0);
      s.p = Math.min(1, s.p + 0.075);
      s.shocks += 1;
      s.burst = 0.45;
      if (s.shocks >= 3) { s.shocks = 0; s.wait = 2.4; } else { s.wait = 0.20; }
    }
    s.burst = Math.max(0, s.burst - dt);
    return s.burst > 0;
}
function b_sweep(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'reset') return bDrain(s, dt, sp);
    if (s.mode !== 'move') {
      s.wait -= dt * sp;
      if (s.wait <= 0) {
        if (s.p >= 0.999) { s.mode = 'reset'; return true; }
        s.from = s.p; s.target = Math.min(1, s.p + 0.25); s.u = 0; s.mode = 'move';
      }
      return false;
    }
    s.u = Math.min(1, s.u + dt * sp / 2.6);
    const e = 0.5 - 0.5 * Math.cos(Math.PI * s.u);
    s.p = s.from + (s.target - s.from) * e;
    if (s.u >= 1) { s.mode = 'pause'; s.wait = 0.9; return false; }
    return true;
}
function b_breath(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'reset') return bDrain(s, dt, sp);
    if (s.p >= 0.999) {
      s.wait -= dt * sp;
      if (s.wait <= 0) s.mode = 'reset';
      return false;
    }
    if (s.mode === 'rest') {
      s.wait -= dt * sp;
      if (s.wait <= 0) s.mode = 'go';
      return false;
    }
    s.p = Math.min(1, s.p + 0.030 * sp * dt);
    s.clock -= dt * sp;
    if (s.clock <= 0) { s.mode = 'rest'; s.wait = rnd(s, 0.8, 1.4); s.clock = rnd(s, 2.5, 4.0); }
    if (s.p >= 0.999) s.wait = 1.5;
    return true;
}
function b_spring(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'reset') return bDrain(s, dt, sp);
    if (s.mode !== 'move') {
      s.wait -= dt * sp;
      if (s.wait <= 0) {
        if (s.p >= 0.995) { s.mode = 'reset'; return true; }
        s.target = Math.min(1, s.p + 0.22); s.vel = 0; s.mode = 'move';
      }
      return false;
    }
    s.vel += ((s.target - s.p) * 7.5 - s.vel * 3.4) * dt * sp;
    s.p += s.vel * dt * sp;
    if (Math.abs(s.vel) < 0.010 && Math.abs(s.target - s.p) < 0.004) {
      s.p = s.target; s.vel = 0; s.mode = 'pause'; s.wait = 1.1;
      return false;
    }
    return true;
}
function b_jitter(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'reset') return bDrain(s, dt, sp);
    s.wait -= dt * sp;
    if (s.wait <= 0) {
      if (s.p >= 0.999) { s.mode = 'reset'; return true; }
      s.target = Math.min(1, s.p + rnd(s, 0.01, 0.035));
      s.wait = rnd(s, 0.08, 0.22);
      s.burst = 0.3;
    }
    const gap = s.target - s.p;
    s.p += gap * Math.min(1, 6.5 * sp * dt);
    s.burst = Math.max(0, s.burst - dt);
    return s.burst > 0;
}
function b_metro(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'reset') return bDrain(s, dt, sp);
    s.wait -= dt * sp;
    if (s.wait <= 0) {
      if (s.p >= 0.999) { s.mode = 'reset'; return true; }
      s.target = Math.min(1, Math.round(s.p * 10 + 1) / 10);
      s.wait = 1.35;
    }
    const gap = s.target - s.p;
    s.p += gap * Math.min(1, 3.4 * sp * dt);
    return Math.abs(gap) > 0.002;
}
function b_attract(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'reset') return bDrain(s, dt, sp);
    if (s.mode !== 'move') {
      s.wait -= dt * sp;
      if (s.wait <= 0) {
        if (s.p >= 0.995) { s.mode = 'reset'; return true; }
        s.target = Math.min(1, s.p + 0.22); s.mode = 'move';
      }
      return false;
    }
    const gap = s.target - s.p;
    s.p += gap * Math.min(1, (0.55 + 5.5 * Math.abs(gap)) * sp * dt);
    if (Math.abs(gap) < 0.0025) { s.p = s.target; s.mode = 'pause'; s.wait = 0.6; return false; }
    return true;
}
function b_hop(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'reset') return bDrain(s, dt, sp);
    s.wait -= dt * sp;
    if (s.wait <= 0) {
      if (s.p >= 0.999) { s.mode = 'reset'; return true; }
      s.target = Math.min(1, s.target + 0.08);
      s.wait = 0.42;
    }
    const gap = s.target - s.p;
    s.p += gap * Math.min(1, 5.0 * sp * dt);
    return Math.abs(gap) > 0.002;
}
function b_steps(s: ProgressSim, dt: number, sp: number): boolean {
    if (s.mode === 'pause') {
      s.wait -= dt * sp;
      if (s.wait <= 0) {
        if (s.p >= 0.999) { s.mode = 'reset'; }
        else { s.target = Math.min(1, s.p + rnd(s, 0.17, 0.23)); s.mode = 'move'; }
      }
      return false;
    }
    if (s.mode === 'reset') {
      s.p -= 1.0 * sp * dt;
      if (s.p <= 0) { s.p = 0; s.target = 0; s.mode = 'pause'; s.wait = 0.8; }
      return true;
    }
    const gap = s.target - s.p;
    s.p += gap * Math.min(1, 1.7 * sp * dt);
    if (Math.abs(gap) < 0.004) {
      s.p = s.target; s.mode = 'pause';
      s.wait = s.p >= 0.999 ? 1.9 : rnd(s, 0.9, 1.5);
      return false;
    }
    return true;
}

function bDrain(s: ProgressSim, dt: number, sp: number): boolean {
    s.p -= 1.0 * sp * dt;
    if (s.p <= 0) { s.p = 0; s.target = 0; s.vel = 0; s.mode = 'pause'; s.wait = 0.8; }
    return true;
}

function b_liquid(s: ProgressSim, dt: number, sp: number): boolean {
    let moved = false;
    if (s.mode === 'pause') {
      s.wait -= dt * sp;
      if (s.wait <= 0) {
        if (s.p >= 0.999) { s.target = 0; s.rate = 1.2; }
        else { s.target = Math.min(1, s.p + rnd(s, 0.06, 0.22)); s.rate = rnd(s, 0.05, 0.16); }
        s.mode = 'move';
      }
    }
    if (s.mode === 'move') {
      const dir = Math.sign(s.target - s.p);
      s.p += dir * s.rate * sp * dt;
      moved = true;
      if ((dir >= 0 && s.p >= s.target) || (dir < 0 && s.p <= s.target)) {
        s.p = s.target; s.mode = 'pause';
        s.wait = s.p >= 0.999 ? 1.8 : (s.p <= 0.001 ? 0.6 : rnd(s, 0.7, 2.0));
      }
    }
    return moved;
}

function stepBeh(s: ProgressSim, dt: number, sp: number, beh: string): boolean {
    switch (beh) {
        case "seismic": return b_seismic(s, dt, sp);
        case "sweep": return b_sweep(s, dt, sp);
        case "breath": return b_breath(s, dt, sp);
        case "spring": return b_spring(s, dt, sp);
        case "jitter": return b_jitter(s, dt, sp);
        case "metro": return b_metro(s, dt, sp);
        case "attract": return b_attract(s, dt, sp);
        case "hop": return b_hop(s, dt, sp);
        case "steps": return b_steps(s, dt, sp);
        case "liquid": return b_liquid(s, dt, sp);
        default: return b_steps(s, dt, sp);
    }
}

const RATES: Record<string, { up: number; dn: number; wB: number; wG: number }> = {
    liquid: { up: 3.0, dn: 0.75, wB: 0.35, wG: 1.35 },
};
const RATES_DEFAULT = { up: 1.8, dn: 0.7, wB: 0.45, wG: 0.85 };

function newSim(index: number): ProgressSim {
    return {
        p: 0,
        activity: 0,
        wt: ((index * 2654435761) % 600) / 10,
        frames: 0,
        target: 0,
        from: 0,
        u: 0,
        vel: 0,
        rate: 0.08,
        mode: "pause",
        wait: 0.5,
        burst: 0,
        clock: 0,
        shocks: 0,
        seed: (index * 2246822519 + 374761393) >>> 0,
        index,
    };
}

function simStep(s: ProgressSim, dt: number, sp: number, beh: string, manual: number): void {
    const r = RATES[beh] ?? RATES_DEFAULT;
    let moving = false;
    if (manual >= 0) {
        const gap = Math.min(Math.max(manual, 0), 1) - s.p;
        if (Math.abs(gap) > 0.002) { s.p += Math.sign(gap) * Math.min(Math.abs(gap), 0.5 * sp * dt); moving = true; }
    } else {
        moving = stepBeh(s, dt, sp, beh);
    }
    s.p = Math.max(0, Math.min(1, s.p));
    s.activity += ((moving ? 1 : 0) - s.activity) * (1 - Math.exp(-(moving ? r.up : r.dn) * dt));
    s.wt += dt * (r.wB + s.activity * r.wG);
    s.frames += 1;
}

const SIM_STEP = 1 / 60;

function simTo(s: ProgressSim, t: number, sp: number, beh: string, manual: number): ProgressSim {
    const want = Math.max(0, Math.floor(t / SIM_STEP));
    if (want < s.frames) {
        const fresh = newSim(s.index);
        for (const k of Object.keys(fresh) as (keyof ProgressSim)[]) {
            (s[k] as number | string) = fresh[k];
        }
    }
    let steps = want - s.frames;
    if (steps > 600) {
        s.frames = want - 600;
        steps = 600;
    }
    for (let i = 0; i < steps; i++) simStep(s, SIM_STEP, sp, beh, manual);
    return s;
}

function simPercent(s: ProgressSim): number {
    return Math.round(Math.min(Math.max(s.p, 0), 1) * 100);
}

const styles = StyleSheet.create({
    content: {
        position: "absolute",
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    title: { color: "#FFFFFF", fontWeight: "800" },
    subtitle: { fontWeight: "700" },
    pct: { color: "#FFFFFF", fontWeight: "700", fontVariant: ["tabular-nums"] },
});

export type ProgressBarProps = {
    progress?: number;
    style?: number;
    colors?: ProgressBarColors;
    title?: string;
    subtitle?: string;
    showsContent?: boolean;
};

export default function ProgressBar({
    progress = -1,
    style = 0.0,
    colors = {},
    title = "SYNCING LIBRARY",
    subtitle = "PREPARING YOUR FILES",
    showsContent = true,
}: ProgressBarProps) {
    const [{ width, height }, setBox] = React.useState({ width: 1, height: 1 });
    const clock = useClock();
    const drive = useSharedValue({ p: 0, alive: 0, warp: 0 });
    const uniforms = useDerivedValue(() => ({
        uResolution: [width, height],
        uTime: clock.value / 1000,
        style: style,
        progress: drive.value.p * 100,
        alive: drive.value.alive,
        warp: drive.value.warp,
        scale: PAL(style).scale,
        amount: PAL(style).amount,
        lag: PAL(style).lag,
        echo: PAL(style).echo,
        bloom: PAL(style).bloom,
        jitter: PAL(style).jitter,
        frontIn: PAL(style).frontIn,
        frontOut: PAL(style).frontOut,
        pulse: PAL(style).pulse,
        pulseRate: PAL(style).pulseRate,
        stagger: PAL(style).stagger,
        background: colors.track ? HEX(colors.track) : PAL(style).background,
        color1: colors.deep ? HEX(colors.deep) : PAL(style).color1,
        color2: colors.mid ? HEX(colors.mid) : PAL(style).color2,
        color3: colors.glow ? HEX(colors.glow) : PAL(style).color3,
        color4: colors.bright ? HEX(colors.bright) : PAL(style).color4,
        color5: colors.core ? HEX(colors.core) : PAL(style).color5,
        color6: colors.trail ? HEX(colors.trail) : PAL(style).color6,
        color7: colors.trailHot ? HEX(colors.trailHot) : PAL(style).color7,
    }));
    const gs = width / 1040;
    const idx = Math.min(Math.max(Math.round(style), 0), PALETTES.length - 1);
    const pal = PALETTES[idx];
    const [pct, setPct] = React.useState(0);
    React.useEffect(() => {
        const sim = newSim(idx);
        const t0 = Date.now();
        let shown = -1;
        let raf = 0;
        const loop = () => {
            simTo(sim, (Date.now() - t0) / 1000, SPEED, pal.behaviour, progress);
            drive.value = { p: sim.p, alive: sim.activity, warp: sim.wt };
            const v = simPercent(sim);
            if (v !== shown) { shown = v; setPct(v); }
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [idx, progress, pal]);

    return (
        <View
            style={{ width: "100%", aspectRatio: ASPECT, borderRadius: CORNER * height, overflow: "hidden" }}
            onLayout={(e) => setBox(e.nativeEvent.layout)}
        >
            <Canvas style={StyleSheet.absoluteFill}>
                <Fill>
                    <Shader source={SOURCE} uniforms={uniforms} />
                </Fill>
            </Canvas>
            {showsContent && (
                <View pointerEvents="none" style={[styles.content, { paddingHorizontal: 87.36 * gs }]}>
                    <View style={{ minWidth: 0 }}>
                        <Text style={[styles.title, {
                            fontSize: 32.0 * gs,
                            lineHeight: 33.6 * gs,
                        }]}>{title}</Text>
                        <Text style={[styles.subtitle, {
                            color: pal.caption,
                            fontSize: 16.0 * gs,
                            letterSpacing: 2.4 * gs,
                            marginTop: 8.0 * gs,
                        }]}>{subtitle}</Text>
                    </View>
                    <Text style={[styles.pct, { fontSize: 60.0 * gs }]}>{pct}%</Text>
                </View>
            )}
        </View>
    );
}
