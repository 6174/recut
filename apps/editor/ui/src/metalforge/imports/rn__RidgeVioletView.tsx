import React from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float style = 0.0;
const float anim = 0.0;
const float radius = 28.0;
const float layer1Blur = 40.0;
const float layer2Blur = 26.0;
const float layer3Blur = 20.0;
const float grainAmt = 0.2;
const float grainFreq = 0.85;
const float intensity = 1.0;
const float shadowAmt = 0.1;
const float animSpeed = 1.0;
const float animAmount = 1.0;
const float animSpread = 1.0;
const float waveFreq = 2.0;
const float lightSway = 0.35;
const float grainDrift = 0.4;
const float glowPulse = 0.25;
const float2 card = float2(0.88, 0.52);
const float2 light = float2(0.5, 1.0);
const half4 bgColor = half4(1.0, 1.0, 1.0, 1.0);
const half4 layer1Color = half4(0.611765, 0.454902, 1.0, 1.0);
const half4 layer2Color = half4(0.227451, 0.086275, 0.658824, 1.0);
const half4 layer3Color = half4(0.019608, 0.007843, 0.031373, 1.0);
const half4 shadowColor = half4(0.419608, 0.227451, 0.909804, 1.0);
const float filter = 0.0;
const float fAmount = 0.5;
const float fScale = 5.0;
const float fBlur = 8.0;
const float fFade = 0.45;
const float fSoft = 0.5;
const float fAngle = 0.0;
const float fGrain = 16.0;
const float fBrightness = 0.0;
const float fContrast = 1.0;
const float fSaturation = 1.0;
const float fRound = 0.45;
const float fBevel = 0.3;
const float fInset = 0.08;

const float MFS_K = 2.104;

const float MFS_OFF = 34.0;
const float MFS_BLUR = 70.0;
const float MFS_SPREAD = -24.0;

const float MFS_ALPHA = 0.55;

float mfs_sd_round_box(float2 p, float2 ext, float r) {
    float2 q = abs(p) - ext + float2(r);
    return length(max(q, float2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

float3 mfs_card_shadow(float3 dst, float2 q, float2 ext, float r, float gs,
                       float2 ldir, float amt, float inten, float3 tint) {
    float spread = MFS_SPREAD * gs;
    float2 sext = max(ext + float2(spread), float2(0.0));
    float sr = clamp(r + spread, 0.0, min(sext.x, sext.y));
    float2 off = ldir * MFS_OFF * gs;
    float sigma = max(MFS_BLUR * gs * 0.5, 0.0001);
    float d = mfs_sd_round_box(q - off, sext, sr);
    float cov = 1.0 - smoothstep(-MFS_K * sigma, MFS_K * sigma, d);
    return mix(dst, tint, clamp(cov * MFS_ALPHA * amt * inten, 0.0, 1.0));
}

const float G_REF_X = 150.0;
const float G_REF_Y = 192.0;

const float G_K = 2.104;

const float3 G_CANVAS = float3(0.02745098, 0.02745098, 0.04313725);

const float G_PAR_1 = 10.0;
const float G_PAR_2 = 16.0;
const float G_PAR_3 = 22.0;

const float G_GAIN = 0.26;
const float G_SEED = 17.0;

const float G_AW_2 = 0.62;
const float G_AW_3 = 0.38;

const float G_AMP_WAVE = 14.0;
const float G_AMP_SWELL = 22.0;
const float G_AMP_DRIFT = 34.0;

const float G_TAU = 6.28318530718;

const float G_QN_1 = 0.9;
const float G_QN_2 = 1.8;
const float G_QW_0 = 0.36633;
const float G_QW_1 = 0.24434;
const float G_QW_2 = 0.07249;

float2 g_card_frame(float2 res) {
    return float2(393.0, 851.0) * max(min(res.x / 393.0, res.y / 851.0), 0.0001);
}

float g_sd_round_box(float2 p, float2 ext, float r) {
    float2 q = abs(p) - ext + float2(r);
    return length(max(q, float2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

float g_coverage(float d, float sigma) {
    float s = max(sigma, 0.0001);
    return 1.0 - smoothstep(-G_K * s, G_K * s, d);
}

float3 g_over(float3 dst, float3 src, float a) {
    return mix(dst, src, clamp(a, 0.0, 1.0));
}

float2 g_parallax(float2 ldir, float k) {
    return (ldir - float2(0.0, 1.0)) * k;
}

float g_anim_t() {
    if (int(anim + 0.5) > 2) { return 0.0; }
    return uTime * max(animSpeed, 0.0);
}

float g_anim_weight(int layerIdx) {
    float w = 1.0;
    if (layerIdx == 1) { w = G_AW_2; }
    else if (layerIdx == 2) { w = G_AW_3; }
    return mix(1.0, w, clamp(animSpread, 0.0, 2.0));
}

float2 g_anim_offset(int layerIdx, float x, float tt) {
    int mode = int(anim + 0.5);
    float2 o = float2(0.0);
    if (mode <= 2) {
        float w = g_anim_weight(layerIdx) * max(animAmount, 0.0);
        float rate = 1.0 - 0.22 * float(layerIdx);
        float ph = float(layerIdx) * 0.9;
        if (mode == 0) {
            float k = G_TAU * max(waveFreq, 0.0) / (2.0 * G_REF_X);
            o.y = G_AMP_WAVE * w * sin(k * x - tt * 1.1 * rate + ph);
        } else if (mode == 1) {
            o.y = G_AMP_SWELL * w * sin(tt * 0.75 * rate + ph);
            o.x = 0.45 * G_AMP_SWELL * w * sin(tt * 0.38 * rate + ph + 1.7);
        } else {
            o.x = G_AMP_DRIFT * w * sin(tt * 0.55 * rate + ph);
            o.y = 0.30 * G_AMP_DRIFT * w * sin(tt * 0.37 * rate + ph + 2.1);
        }
    }
    return o;
}

float2 g_light_dir() {
    float tt = g_anim_t();
    return (light - 0.5) * 2.0
         + float2(sin(tt * 0.31), sin(tt * 0.23)) * (0.5 * clamp(lightSway, 0.0, 1.0));
}

float g_intensity() {
    float tt = g_anim_t();
    float pulse = 1.0 + 0.35 * clamp(glowPulse, 0.0, 1.0) * sin(tt * 0.8);
    return max(0.0, intensity) * max(pulse, 0.0);
}

float g_grain_phase(float tt) {
    float fr = floor(tt * 14.0 * clamp(grainDrift, 0.0, 1.0));
    return fract(sin(fr * 12.9898) * 43758.5453) * 97.0;
}

float g_hash(float2 lattice, float channel) {
    float3 v = float3(lattice, channel + G_SEED);
    return fract(sin(dot(v, float3(127.1, 311.7, 74.7))) * 43758.5453123);
}

float g_value_noise(float2 p, float channel) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 w = f * f * (3.0 - 2.0 * f);
    float a = g_hash(i, channel);
    float b = g_hash(i + float2(1.0, 0.0), channel);
    float c = g_hash(i + float2(0.0, 1.0), channel);
    float d = g_hash(i + float2(1.0, 1.0), channel);
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y) * 2.0 - 1.0;
}

float g_fractal(float2 p, float channel) {
    float sum = 0.0;
    float amp = 1.0;
    float freq = 1.0;
    for (int i = 0; i < 3; ++i) {
        sum += g_value_noise(p * freq, channel + float(i) * 37.0) * amp;
        freq *= 2.0;
        amp *= 0.5;
    }
    return clamp(0.5 + G_GAIN * sum, 0.0, 1.0);
}

float g_linear_to_srgb(float c) {
    return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

float g_overlay(float base, float blend) {
    if (base < 0.5) { return 2.0 * base * blend; }
    return 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
}

float2 mfRidgeSeg(float x, float2 p0, float2 p1, float2 p2, float2 p3) {
  float xa = p3.x - 3.0 * p2.x + 3.0 * p1.x - p0.x;
  float xb = 3.0 * p2.x - 6.0 * p1.x + 3.0 * p0.x;
  float xc = 3.0 * p1.x - 3.0 * p0.x;
  float t = clamp((x - p0.x) / max(p3.x - p0.x, 0.0001), 0.0, 1.0);
  for (int i = 0; i < 4; ++i) {
    float f = ((xa * t + xb) * t + xc) * t + p0.x - x;
    float df = (3.0 * xa * t + 2.0 * xb) * t + xc;
    t = clamp(t - f / max(df, 0.0001), 0.0, 1.0);
  }
  float ya = p3.y - 3.0 * p2.y + 3.0 * p1.y - p0.y;
  float yb = 3.0 * p2.y - 6.0 * p1.y + 3.0 * p0.y;
  float yc = 3.0 * p1.y - 3.0 * p0.y;
  float y = ((ya * t + yb) * t + yc) * t + p0.y;
  float dy = (3.0 * ya * t + 2.0 * yb) * t + yc;
  float dx = (3.0 * xa * t + 2.0 * xb) * t + xc;
  return float2(y, dy / max(dx, 0.0001));
}

float2 mfRdgViolet1(float x) {
  float cx = clamp(x, -70.0, 370.0);
  float2 r = float2(0.0);
  if (cx < 96.0) { r = mfRidgeSeg(cx, float2(-70.0, 330.0), float2(-10.0, 240.0), float2(60.0, 150.0), float2(96.0, 150.0)); }
  else if (cx < 190.0) { r = mfRidgeSeg(cx, float2(96.0, 150.0), float2(132.0, 150.0), float2(152.0, 262.0), float2(190.0, 262.0)); }
  else if (cx < 282.0) { r = mfRidgeSeg(cx, float2(190.0, 262.0), float2(226.0, 262.0), float2(250.0, 196.0), float2(282.0, 196.0)); }
  else { r = mfRidgeSeg(cx, float2(282.0, 196.0), float2(316.0, 196.0), float2(344.0, 270.0), float2(370.0, 330.0)); }
  return r;
}

float2 mfRdgViolet2(float x) {
  float cx = clamp(x, -70.0, 370.0);
  float2 r = float2(0.0);
  if (cx < 98.0) { r = mfRidgeSeg(cx, float2(-70.0, 356.0), float2(0.0, 286.0), float2(62.0, 212.0), float2(98.0, 212.0)); }
  else if (cx < 192.0) { r = mfRidgeSeg(cx, float2(98.0, 212.0), float2(134.0, 212.0), float2(154.0, 300.0), float2(192.0, 300.0)); }
  else if (cx < 284.0) { r = mfRidgeSeg(cx, float2(192.0, 300.0), float2(228.0, 300.0), float2(252.0, 254.0), float2(284.0, 254.0)); }
  else { r = mfRidgeSeg(cx, float2(284.0, 254.0), float2(318.0, 254.0), float2(346.0, 300.0), float2(370.0, 356.0)); }
  return r;
}

float2 mfRdgViolet3(float x) {
  float cx = clamp(x, -70.0, 370.0);
  float2 r = float2(0.0);
  if (cx < 100.0) { r = mfRidgeSeg(cx, float2(-70.0, 386.0), float2(10.0, 340.0), float2(66.0, 296.0), float2(100.0, 296.0)); }
  else if (cx < 194.0) { r = mfRidgeSeg(cx, float2(100.0, 296.0), float2(136.0, 296.0), float2(156.0, 344.0), float2(194.0, 344.0)); }
  else if (cx < 288.0) { r = mfRidgeSeg(cx, float2(194.0, 344.0), float2(230.0, 344.0), float2(256.0, 312.0), float2(288.0, 312.0)); }
  else { r = mfRidgeSeg(cx, float2(288.0, 312.0), float2(320.0, 312.0), float2(348.0, 346.0), float2(370.0, 386.0)); }
  return r;
}

float2 mfRdgIndigo1(float x) {
  float cx = clamp(x, -70.0, 370.0);
  float2 r = float2(0.0);
  if (cx < 176.0) { r = mfRidgeSeg(cx, float2(-70.0, 392.0), float2(40.0, 368.0), float2(110.0, 300.0), float2(176.0, 214.0)); }
  else { r = mfRidgeSeg(cx, float2(176.0, 214.0), float2(216.0, 162.0), float2(250.0, 120.0), float2(370.0, 96.0)); }
  return r;
}

float2 mfRdgIndigo2(float x) {
  float cx = clamp(x, -70.0, 370.0);
  float2 r = float2(0.0);
  if (cx < 184.0) { r = mfRidgeSeg(cx, float2(-70.0, 404.0), float2(50.0, 386.0), float2(118.0, 330.0), float2(184.0, 254.0)); }
  else { r = mfRidgeSeg(cx, float2(184.0, 254.0), float2(222.0, 210.0), float2(256.0, 176.0), float2(370.0, 152.0)); }
  return r;
}

float2 mfRdgIndigo3(float x) {
  float cx = clamp(x, -70.0, 370.0);
  float2 r = float2(0.0);
  if (cx < 192.0) { r = mfRidgeSeg(cx, float2(-70.0, 424.0), float2(60.0, 412.0), float2(126.0, 372.0), float2(192.0, 314.0)); }
  else { r = mfRidgeSeg(cx, float2(192.0, 314.0), float2(230.0, 280.0), float2(262.0, 254.0), float2(370.0, 238.0)); }
  return r;
}

float2 mfRdgGraphite1(float x) {
  float cx = clamp(x, -70.0, 370.0);
  float2 r = float2(0.0);
  if (cx < 96.0) { r = mfRidgeSeg(cx, float2(-70.0, 330.0), float2(-4.0, 290.0), float2(44.0, 206.0), float2(96.0, 206.0)); }
  else if (cx < 210.0) { r = mfRidgeSeg(cx, float2(96.0, 206.0), float2(142.0, 206.0), float2(168.0, 150.0), float2(210.0, 150.0)); }
  else { r = mfRidgeSeg(cx, float2(210.0, 150.0), float2(262.0, 150.0), float2(336.0, 278.0), float2(370.0, 330.0)); }
  return r;
}

float2 mfRdgGraphite2(float x) {
  float cx = clamp(x, -70.0, 370.0);
  float2 r = float2(0.0);
  if (cx < 100.0) { r = mfRidgeSeg(cx, float2(-70.0, 356.0), float2(4.0, 324.0), float2(52.0, 254.0), float2(100.0, 254.0)); }
  else if (cx < 214.0) { r = mfRidgeSeg(cx, float2(100.0, 254.0), float2(146.0, 254.0), float2(172.0, 208.0), float2(214.0, 208.0)); }
  else { r = mfRidgeSeg(cx, float2(214.0, 208.0), float2(264.0, 208.0), float2(338.0, 306.0), float2(370.0, 356.0)); }
  return r;
}

float2 mfRdgGraphite3(float x) {
  float cx = clamp(x, -70.0, 370.0);
  float2 r = float2(0.0);
  if (cx < 104.0) { r = mfRidgeSeg(cx, float2(-70.0, 386.0), float2(14.0, 358.0), float2(60.0, 310.0), float2(104.0, 310.0)); }
  else if (cx < 218.0) { r = mfRidgeSeg(cx, float2(104.0, 310.0), float2(150.0, 310.0), float2(178.0, 278.0), float2(218.0, 278.0)); }
  else { r = mfRidgeSeg(cx, float2(218.0, 278.0), float2(266.0, 278.0), float2(344.0, 344.0), float2(370.0, 386.0)); }
  return r;
}

float2 mfRidge(int styleIdx, int layerIdx, float x) {
  float2 r = float2(0.0);
  if (styleIdx == 0) {
    if (layerIdx == 0) { r = mfRdgViolet1(x); }
    else if (layerIdx == 1) { r = mfRdgViolet2(x); }
    else { r = mfRdgViolet3(x); }
  }
  else if (styleIdx == 1) {
    if (layerIdx == 0) { r = mfRdgIndigo1(x); }
    else if (layerIdx == 1) { r = mfRdgIndigo2(x); }
    else { r = mfRdgIndigo3(x); }
  }
  else {
    if (layerIdx == 0) { r = mfRdgGraphite1(x); }
    else if (layerIdx == 1) { r = mfRdgGraphite2(x); }
    else { r = mfRdgGraphite3(x); }
  }
  return r;
}

float2 g_half_ext() {
    float2 frame = g_card_frame(uResolution);
    return 0.5 * clamp(card, float2(0.02), float2(1.0)) * frame;
}

float g_ridge_at(int styleIdx, int layerIdx, float x, float py, float sigma, float sy,
                 float tt) {
    float2 o = g_anim_offset(layerIdx, x, tt);
    float2 r = mfRidge(styleIdx, layerIdx, x + o.x);
    return g_coverage((r.x + o.y - py) * sy, sigma);
}

float g_ridge_coverage(float2 p, int styleIdx, int layerIdx, float sigma,
                     float sx, float sy, float tt) {
    float sdx = sigma / max(sx, 0.0001);
    float n1 = G_QN_1 * sdx;
    float n2 = G_QN_2 * sdx;
    return G_QW_0 * g_ridge_at(styleIdx, layerIdx, p.x, p.y, sigma, sy, tt)
         + G_QW_1 * (g_ridge_at(styleIdx, layerIdx, p.x + n1, p.y, sigma, sy, tt)
                   + g_ridge_at(styleIdx, layerIdx, p.x - n1, p.y, sigma, sy, tt))
         + G_QW_2 * (g_ridge_at(styleIdx, layerIdx, p.x + n2, p.y, sigma, sy, tt)
                   + g_ridge_at(styleIdx, layerIdx, p.x - n2, p.y, sigma, sy, tt));
}

float3 mfSrc(float2 cuv) {
    float2 halfExt = g_half_ext();
    float sx = max(halfExt.x / G_REF_X, 0.0001);
    float sy = max(halfExt.y / G_REF_Y, 0.0001);
    float gs = max(min(sx, sy), 0.0001);

    float2 dp = cuv * float2(2.0 * G_REF_X, 2.0 * G_REF_Y);

    int sIdx = int(style + 0.5);
    float2 ldir = g_light_dir();
    float inten = g_intensity();
    float tt = g_anim_t();

    float3 cardCol = float3(bgColor.rgb);

    float2 o1 = g_parallax(ldir, G_PAR_1);
    cardCol = g_over(cardCol, float3(layer1Color.rgb),
                     g_ridge_coverage(dp - o1, sIdx, 0, layer1Blur * gs, sx, sy, tt) * inten);

    float2 o2 = g_parallax(ldir, G_PAR_2);
    cardCol = g_over(cardCol, float3(layer2Color.rgb),
                     g_ridge_coverage(dp - o2, sIdx, 1, layer2Blur * gs, sx, sy, tt) * inten);

    float2 o3 = g_parallax(ldir, G_PAR_3);
    cardCol = g_over(cardCol, float3(layer3Color.rgb),
                     g_ridge_coverage(dp - o3, sIdx, 2, layer3Blur * gs, sx, sy, tt) * inten);

    return cardCol;
}

float3 mfTap(float2 uv) {
    return mfSrc(clamp(uv, float2(0.0), float2(1.0)));
}

float3 mfBlurAt(float2 uv, float2 res, float radiusPx) {
    if (radiusPx < 0.35) { return mfTap(uv); }
    float2 stp = radiusPx / max(res, float2(1.0));
    float3 sum = mfTap(uv) * 0.18;
    for (int i = 0; i < 8; i++) {
        float ang = (float(i) / 8.0) * 6.2831853;
        float2 d = float2(cos(ang), sin(ang));
        sum += mfTap(uv + d * stp * 0.55) * 0.075;
        sum += mfTap(uv + d * stp) * 0.0275;
    }
    return sum;
}

float3 mfMotionAt(float2 uv, float2 res, float radiusPx, float angleDeg) {
    if (radiusPx < 0.35) { return mfTap(uv); }
    float th = angleDeg * 0.017453292;
    float2 d = float2(cos(th), sin(th)) * radiusPx / max(res, float2(1.0));
    float3 sum = float3(0.0);
    for (int i = -8; i <= 8; i++) {
        sum += mfTap(uv + d * (float(i) / 8.0));
    }
    return sum / 17.0;
}

float mfLuma(float3 c) {
    return dot(c, float3(0.2126, 0.7152, 0.0722));
}

float mfFilmGrain(float2 uv) {
    float x = (uv.x + 4.0) * (uv.y + 4.0) * 10.0;
    return mod((mod(x, 13.0) + 1.0) * (mod(x, 123.0) + 1.0), 0.01) - 0.005;
}

float mfHash21(float2 p) {
    return fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
}

float mfVnoise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mfHash21(i), mfHash21(i + float2(1.0, 0.0)), u.x),
        mix(mfHash21(i + float2(0.0, 1.0)), mfHash21(i + float2(1.0, 1.0)), u.x),
        u.y);
}

float2 mfAspect(float2 res) {
    return float2(res.x / max(res.y, 1.0), 1.0);
}

float3 mfFilter(float2 uv, float2 res, float mode, float ppp,
                float fAmount,
                float fScale,
                float fBlur,
                float fFade,
                float fSoft,
                float fAngle,
                float fGrain,
                float fBrightness,
                float fContrast,
                float fSaturation,
                float fRound,
                float fBevel,
                float fInset) {
    int m = int(mode + 0.5);
    float3 col = mfTap(uv);

    if (m == 5) {
        float a = fBlur;
        col = mfBlurAt(uv, res, a * ppp);
    } else if (m == 6) {
        float a = fBlur;
        float b = fFade;
        float k = smoothstep(clamp(1.0 - b, 0.0, 0.999), 1.0, uv.y);
        col = mix(col, mfBlurAt(uv, res, a * ppp), k);
    } else if (m == 11) {
        col = mfMotionAt(uv, res, fBlur * ppp, fAngle);
    } else if (m == 7) {
        float a = fAmount;
        float b = fSoft;
        float halfDiag = length(res) * 0.5;
        float r = length((uv - float2(0.5)) * res) / max(halfDiag, 1.0);
        float inner = mix(0.95, 0.15, clamp(b, 0.0, 1.0));
        float k = clamp((r - inner) / max(1.05 - inner, 0.001), 0.0, 1.0);
        col = col * (1.0 - clamp(a, 0.0, 1.0) * k);
    } else if (m == 8) {
        float a = fBrightness;
        col = clamp(col + float3(a), float3(0.0), float3(1.0));
    } else if (m == 9) {
        float a = fContrast;
        col = clamp((col - float3(0.5)) * a + float3(0.5), float3(0.0), float3(1.0));
    } else if (m == 10) {
        float a = fSaturation;
        col = clamp(mix(float3(mfLuma(col)), col, a), float3(0.0), float3(1.0));
    } else if (m == 1) {
        float a = fGrain;
        col = clamp(col + float3(mfFilmGrain(uv) * a), float3(0.0), float3(1.0));
    } else if (m == 2) {
        float a = fAmount;
        float b = fScale;
        float s = max(b, 0.5);
        float2 w = float2(
            sin(uv.y * s * 6.2831853 + 1.3) + 0.5 * sin(uv.y * s * 12.9 + 0.7),
            cos(uv.x * s * 6.2831853 + 2.1) + 0.5 * cos(uv.x * s * 11.3 + 1.9));
        col = mfTap(uv + w * a * 0.02);
    } else if (m == 4) {
        float a = fAmount;
        float b = fScale;
        float2 asp = mfAspect(res);
        float2 cell = floor(uv * asp * max(b, 1.0));
        float h1 = mfHash21(cell);
        float h2 = mfHash21(cell + float2(37.0, 17.0));
        float2 off = (float2(h1, h2) - float2(0.5)) * a * 0.06 / asp;
        col = clamp(mfTap(uv + off) * (1.0 + (h1 - 0.5) * a * 0.35), float3(0.0), float3(1.0));
    } else if (m == 3) {
        float a = fAmount;
        float b = fBlur;
        float2 asp = mfAspect(res);
        float2 p = uv * asp * 42.0;
        float2 n = float2(mfVnoise(p), mfVnoise(p + float2(7.3, 2.1))) - float2(0.5);
        col = mfBlurAt(uv + n * a * 0.05 / asp, res, b * ppp);
    }
    return col;
}

half4 main(float2 position) {
    float2 res = uResolution;
    float2 p = position;
    float2 frame = g_card_frame(res);
    float2 halfExt = g_half_ext();
    float2 q = p - 0.5 * res;
    float gs = max(min(halfExt.x / G_REF_X, halfExt.y / G_REF_Y), 0.0001);
    float r = clamp(radius * gs, 0.0, min(halfExt.x, halfExt.y));

    float3 col = G_CANVAS;

    float2 ldirC = g_light_dir();
    col = mfs_card_shadow(col, q, halfExt, r, gs, ldirC, shadowAmt,
                          g_intensity(), float3(shadowColor.rgb));

    float2 cres = 2.0 * halfExt;
    float2 cuv = (q + halfExt) / max(cres, float2(1.0));
    float3 cardCol = mfFilter(cuv, cres, filter, frame.x / 393.0,
                              fAmount, fScale, fBlur, fFade, fSoft, fAngle, fGrain, fBrightness, fContrast, fSaturation, fRound, fBevel, fInset);

    if (grainAmt > 0.0) {
        float2 np = q / gs * max(grainFreq, 0.0001);
        float gp = g_grain_phase(g_anim_t());
        float nr = g_linear_to_srgb(g_fractal(np, 0.0 + gp));
        float ng = g_linear_to_srgb(g_fractal(np, 101.0 + gp));
        float nb = g_linear_to_srgb(g_fractal(np, 211.0 + gp));
        float na = g_fractal(np, 307.0 + gp);
        float3 mixed = float3(g_overlay(cardCol.r, nr),
                              g_overlay(cardCol.g, ng),
                              g_overlay(cardCol.b, nb));
        cardCol = mix(cardCol, mixed, clamp(grainAmt * na, 0.0, 1.0));
    }

    float dCard = g_sd_round_box(q, halfExt, r);
    col = g_over(col, cardCol, 1.0 - smoothstep(-1.0, 1.0, dCard));

    float dth = (fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    return half4(half3(clamp(col + dth, 0.0, 1.0)), 1.0);
}
`)!;

export default function RidgeVioletView() {
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
