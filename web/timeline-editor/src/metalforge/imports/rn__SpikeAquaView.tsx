import React from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float style = 1.0;
const float anim = 0.0;
const float radius = 38.0;
const float mound1Blur = 26.0;
const float mound2Blur = 18.0;
const float glowAmt = 1.0;
const float baseGlow = 0.0;
const float dotSpacing = 12.0;
const float dotSize = 0.8;
const float dotAmt = 0.45;
const float dotMotion = 0.0;
const float dotSpeed = 1.6;
const float dotDepth = 0.85;
const float dotStyle = 1.0;
const float dotLayer = 0.0;
const float dotAngle = 0.0;
const float dotVary = 0.0;
const float borderAmt = 0.11;
const float intensity = 1.0;
const float shadowAmt = 0.1;
const float animSpeed = 1.0;
const float animAmount = 1.0;
const float animSpread = 1.0;
const float waveFreq = 2.0;
const float lightSway = 0.35;
const float glowPulse = 0.25;
const float2 card = float2(0.87, 0.4);
const float2 light = float2(0.5, 1.0);
const half4 bgColor = half4(0.011765, 0.019608, 0.023529, 1.0);
const half4 mound1Color = half4(0.054902, 0.482353, 0.784314, 1.0);
const half4 mound2Color = half4(0.431373, 0.847059, 1.0, 1.0);
const half4 poolTint = half4(0.470588, 0.862745, 1.0, 1.0);
const half4 dotColor = half4(1.0, 1.0, 1.0, 1.0);
const half4 borderColor = half4(1.0, 1.0, 1.0, 1.0);
const half4 shadowColor = half4(0.431373, 0.847059, 1.0, 1.0);
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
const float G_REF_Y = 150.0;

const float G_K = 2.104;

const float3 G_CANVAS = float3(0.02745098, 0.02745098, 0.04313725);

const float G_PAR_1 = 8.0;
const float G_PAR_2 = 14.0;

const float G_BASE_BOTTOM = -0.06;
const float G_BASE_HEIGHT = 0.16;
const float G_BASE_MID = 0.72;
const float G_BASE_BLUR = 12.0;

const float G_WAVE_ANGLE = 0.7853982;
const float G_WAVE_COUNT = 2.0;

const float G_AW_BACK = 0.62;

const float G_AMP_WAVE = 11.0;
const float G_AMP_SWELL = 17.0;
const float G_AMP_DRIFT = 26.0;

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

float4 g_mix_stop(float3 c1, float a1, float3 c2, float a2, float f) {
    float4 p1 = float4(c1 * a1, a1);
    float4 p2 = float4(c2 * a2, a2);
    float4 pm = mix(p1, p2, clamp(f, 0.0, 1.0));
    float3 rgb = c2;
    if (pm.a > 1e-6) { rgb = pm.rgb / pm.a; }
    return float4(rgb, pm.a);
}

float2 g_parallax(float2 ldir, float k) {
    return (ldir - float2(0.0, 1.0)) * k;
}

float g_anim_t() {
    if (int(anim + 0.5) > 2) { return 0.0; }
    return uTime * max(animSpeed, 0.0);
}

int g_anim_depth(int layerIdx) {
    return 1 - layerIdx;
}

float g_anim_weight(int layerIdx) {
    float w = 1.0;
    if (g_anim_depth(layerIdx) == 1) { w = G_AW_BACK; }
    return mix(1.0, w, clamp(animSpread, 0.0, 2.0));
}

float2 g_anim_offset(int layerIdx, float x, float tt) {
    int mode = int(anim + 0.5);
    float2 o = float2(0.0);
    if (mode <= 2) {
        float d = float(g_anim_depth(layerIdx));
        float w = g_anim_weight(layerIdx) * max(animAmount, 0.0);
        float rate = 1.0 - 0.22 * d;
        float ph = d * 0.9;
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

float g_dot_hash(float2 cell, float salt) {
    return fract(sin(dot(cell + float2(salt), float2(127.1, 311.7))) * 43758.5453123);
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

float2 mfSpkPurple1(float x) {
  float cx = clamp(x, -60.0, 360.0);
  float2 r = float2(0.0);
  if (cx < 150.0) { r = mfRidgeSeg(cx, float2(-60.0, 304.0), float2(26.0, 288.0), float2(104.0, 122.0), float2(150.0, 122.0)); }
  else { r = mfRidgeSeg(cx, float2(150.0, 122.0), float2(196.0, 122.0), float2(274.0, 288.0), float2(360.0, 304.0)); }
  return r;
}

float2 mfSpkPurple2(float x) {
  float cx = clamp(x, -60.0, 360.0);
  float2 r = float2(0.0);
  if (cx < 150.0) { r = mfRidgeSeg(cx, float2(-60.0, 306.0), float2(34.0, 298.0), float2(110.0, 168.0), float2(150.0, 168.0)); }
  else { r = mfRidgeSeg(cx, float2(150.0, 168.0), float2(190.0, 168.0), float2(266.0, 298.0), float2(360.0, 306.0)); }
  return r;
}

float2 mfSpkAqua1(float x) {
  float cx = clamp(x, -60.0, 360.0);
  float2 r = float2(0.0);
  if (cx < 92.0) { r = mfRidgeSeg(cx, float2(-60.0, 306.0), float2(-30.0, 240.0), float2(40.0, 86.0), float2(92.0, 110.0)); }
  else if (cx < 300.0) { r = mfRidgeSeg(cx, float2(92.0, 110.0), float2(150.0, 136.0), float2(214.0, 272.0), float2(300.0, 300.0)); }
  else { r = mfRidgeSeg(cx, float2(300.0, 300.0), float2(320.0, 306.6667), float2(340.0, 313.3333), float2(360.0, 320.0)); }
  return r;
}

float2 mfSpkAqua2(float x) {
  float cx = clamp(x, -60.0, 360.0);
  float2 r = float2(0.0);
  if (cx < 92.0) { r = mfRidgeSeg(cx, float2(-60.0, 308.0), float2(-26.0, 262.0), float2(44.0, 150.0), float2(92.0, 168.0)); }
  else if (cx < 300.0) { r = mfRidgeSeg(cx, float2(92.0, 168.0), float2(146.0, 188.0), float2(208.0, 282.0), float2(300.0, 304.0)); }
  else { r = mfRidgeSeg(cx, float2(300.0, 304.0), float2(320.0, 309.3333), float2(340.0, 314.6667), float2(360.0, 320.0)); }
  return r;
}

float2 mfSpkLime1(float x) {
  float cx = clamp(x, -60.0, 360.0);
  float2 r = float2(0.0);
  if (cx < 88.0) { r = mfRidgeSeg(cx, float2(-60.0, 304.0), float2(-14.0, 286.0), float2(44.0, 150.0), float2(88.0, 150.0)); }
  else if (cx < 168.0) { r = mfRidgeSeg(cx, float2(88.0, 150.0), float2(130.0, 150.0), float2(148.0, 262.0), float2(168.0, 262.0)); }
  else if (cx < 246.0) { r = mfRidgeSeg(cx, float2(168.0, 262.0), float2(190.0, 262.0), float2(208.0, 168.0), float2(246.0, 168.0)); }
  else { r = mfRidgeSeg(cx, float2(246.0, 168.0), float2(292.0, 168.0), float2(336.0, 286.0), float2(360.0, 304.0)); }
  return r;
}

float2 mfSpkLime2(float x) {
  float cx = clamp(x, -60.0, 360.0);
  float2 r = float2(0.0);
  if (cx < 90.0) { r = mfRidgeSeg(cx, float2(-60.0, 308.0), float2(-8.0, 296.0), float2(48.0, 196.0), float2(90.0, 196.0)); }
  else if (cx < 170.0) { r = mfRidgeSeg(cx, float2(90.0, 196.0), float2(130.0, 196.0), float2(150.0, 278.0), float2(170.0, 278.0)); }
  else if (cx < 246.0) { r = mfRidgeSeg(cx, float2(170.0, 278.0), float2(192.0, 278.0), float2(210.0, 212.0), float2(246.0, 212.0)); }
  else { r = mfRidgeSeg(cx, float2(246.0, 212.0), float2(290.0, 212.0), float2(338.0, 296.0), float2(360.0, 308.0)); }
  return r;
}

float2 mfRidge(int styleIdx, int layerIdx, float x) {
  float2 r = float2(0.0);
  if (styleIdx == 0) {
    if (layerIdx == 0) { r = mfSpkPurple1(x); }
    else { r = mfSpkPurple2(x); }
  }
  else if (styleIdx == 1) {
    if (layerIdx == 0) { r = mfSpkAqua1(x); }
    else { r = mfSpkAqua2(x); }
  }
  else {
    if (layerIdx == 0) { r = mfSpkLime1(x); }
    else { r = mfSpkLime2(x); }
  }
  return r;
}

float2 g_half_ext() {
    float2 frame = g_card_frame(uResolution);
    return 0.5 * clamp(card, float2(0.02), float2(1.0)) * frame;
}

float g_mound_at(int styleIdx, int layerIdx, float x, float py, float sigma, float sy,
                 float tt) {
    float2 o = g_anim_offset(layerIdx, x, tt);
    float2 r = mfRidge(styleIdx, layerIdx, x + o.x);
    return g_coverage((r.x + o.y - py) * sy, sigma);
}

float g_mound_coverage(float2 p, int styleIdx, int layerIdx, float sigma,
                     float sx, float sy, float tt) {
    float sdx = sigma / max(sx, 0.0001);
    float n1 = G_QN_1 * sdx;
    float n2 = G_QN_2 * sdx;
    return G_QW_0 * g_mound_at(styleIdx, layerIdx, p.x, p.y, sigma, sy, tt)
         + G_QW_1 * (g_mound_at(styleIdx, layerIdx, p.x + n1, p.y, sigma, sy, tt)
                   + g_mound_at(styleIdx, layerIdx, p.x - n1, p.y, sigma, sy, tt))
         + G_QW_2 * (g_mound_at(styleIdx, layerIdx, p.x + n2, p.y, sigma, sy, tt)
                   + g_mound_at(styleIdx, layerIdx, p.x - n2, p.y, sigma, sy, tt));
}

float4 g_pool_box(int styleIdx) {
    float4 b = float4(-0.14, 1.28, -0.18, 0.44);
    if (styleIdx == 1) { b = float4(-0.24, 0.70, -0.20, 0.38); }
    else if (styleIdx == 2) { b = float4(0.02, 0.96, -0.22, 0.40); }
    return b;
}

float4 g_pool_stops(int styleIdx) {
    float4 s = float4(0.46, 0.72, 0.92, 0.50);
    if (styleIdx == 1) { s = float4(0.40, 0.70, 0.90, 0.45); }
    else if (styleIdx == 2) { s = float4(0.42, 0.72, 0.82, 0.40); }
    return s;
}

float g_sd_tri(float2 p, float r) {
    float k = 1.7320508;
    p = float2(abs(p.x) - r, p.y + r / k);
    if (p.x + k * p.y > 0.0) { p = float2(p.x - k * p.y, -k * p.x - p.y) * 0.5; }
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
}

float3 g_pattern(float2 gp, float pitch, float rad, float aa, int style) {
    float2 baseCell = floor(gp / pitch);
    float2 off = gp - (baseCell + float2(0.5)) * pitch;

    if (style == 1) {
        return float3(1.0 - smoothstep(rad - aa, rad + aa, length(off)), baseCell);
    }
    if (style == 2) {
        float w = max(rad * 0.38, 0.22);
        float pick = g_dot_hash(baseCell, 53.9) * 3.0;
        float d;
        if (pick < 1.0) {
            d = abs(length(off) - rad);
        } else if (pick < 2.0) {
            d = abs(max(abs(off.x), abs(off.y)) - rad);
        } else {
            d = abs(g_sd_tri(float2(off.x, -off.y), rad));
        }
        return float3(1.0 - smoothstep(w - aa, w + aa, d), baseCell);
    }
    if (style == 3) {
        float w = max(rad * 0.38, 0.15);
        return float3(1.0 - smoothstep(w - aa, w + aa, min(abs(off.x), abs(off.y))), baseCell);
    }
    if (style == 4) {
        float w = max(rad * 0.34, 0.18);
        float d = min(max(abs(off.x) - rad, abs(off.y) - w),
                      max(abs(off.y) - rad, abs(off.x) - w));
        return float3(1.0 - smoothstep(-aa, aa, d), baseCell);
    }
    float lit = 0.1 + 0.9 * g_dot_hash(baseCell, 41.7);
    float cov = 1.0 - smoothstep(rad - aa, rad + aa, max(abs(off.x), abs(off.y)));
    return float3(cov * lit * lit, baseCell);
}

float g_dots(float2 dp, float t, float aa,
             float spacing, float size, float motion,
             float speed, float depth,
             float styleV, float angle, float vary) {
    int patStyle = int(styleV + 0.5);
    if (patStyle <= 0) { return 0.0; }
    float pitch = max(spacing, 0.5);
    float ang = angle * 0.0174532925;
    float ca = cos(ang);
    float sa = sin(ang);
    float2 gp = float2(dp.x * ca - dp.y * sa, dp.x * sa + dp.y * ca);
    float rad = max(size, 0.05);

    float3 hit = g_pattern(gp, pitch, rad, aa, patStyle);
    float cov = hit.x;
    float2 cell = hit.yz;
    if (cov <= 0.0) { return 0.0; }

    int mode = int(motion + 0.5);
    float amount = clamp(depth, 0.0, 1.0);
    float level = 1.0;
    if (mode == 1) {
        float jitter = 0.5 + g_dot_hash(cell, 0.0) * 1.3;
        float phase = g_dot_hash(cell, 61.7) * 6.2831853;
        float wv = sin(t * speed * jitter + phase);
        float pulse = pow(max(0.0, wv), 1.6);
        level = 1.0 - amount * (1.0 - pulse);
    } else if (mode == 2) {
        float along = (dp.x * cos(G_WAVE_ANGLE) + dp.y * sin(G_WAVE_ANGLE)) / (2.0 * max(G_REF_X, G_REF_Y));
        float wv = sin(along * 6.2831853 * G_WAVE_COUNT - t * speed * 2.0);
        level = 1.0 - amount * (1.0 - (0.5 + 0.5 * wv));
    } else if (mode == 3) {
        float wv = sin(t * speed);
        level = 1.0 - amount * (1.0 - (0.5 + 0.5 * wv));
    }
    level = level * (1.0 - clamp(vary, 0.0, 1.0) * g_dot_hash(cell, 19.3));
    return cov * clamp(level, 0.0, 1.0);
}

float3 mfSrc(float2 cuv) {
    float2 halfExt = g_half_ext();
    float sx = max(halfExt.x / G_REF_X, 0.0001);
    float sy = max(halfExt.y / G_REF_Y, 0.0001);
    float gs = max(min(sx, sy), 0.0001);

    float2 ldir = g_light_dir();
    float inten = g_intensity();
    float tt = g_anim_t();
    int sIdx = int(style + 0.5);

    float2 dp = cuv * float2(2.0 * G_REF_X, 2.0 * G_REF_Y);

    float3 cardCol = float3(bgColor.rgb);

    if (dotLayer > 0.5 && dotAmt > 0.0) {
        cardCol = g_over(cardCol, float3(dotColor.rgb),
                         g_dots(dp, uTime, max(0.35, 0.8 / gs),
                                dotSpacing, dotSize, dotMotion, dotSpeed, dotDepth,
                                dotStyle, dotAngle, dotVary) * dotAmt);
    }

    float2 o1 = g_parallax(ldir, G_PAR_1);
    cardCol = g_over(cardCol, float3(mound1Color.rgb),
                     g_mound_coverage(dp - o1, sIdx, 0, mound1Blur * gs, sx, sy, tt) * inten);

    float2 o2 = g_parallax(ldir, G_PAR_2);
    cardCol = g_over(cardCol, float3(mound2Color.rgb),
                     g_mound_coverage(dp - o2, sIdx, 1, mound2Blur * gs, sx, sy, tt) * inten);

    float4 box = g_pool_box(sIdx);
    float4 st = g_pool_stops(sIdx);
    float2 bx = float2(box.x + box.y * 0.5, 1.0 - box.z - box.w * 0.5);
    float2 po = g_anim_offset(1, bx.x * 2.0 * G_REF_X, tt) / float2(2.0 * G_REF_X, 2.0 * G_REF_Y);
    bx += po;
    float2 bh = max(float2(box.y, box.w) * 0.5, float2(0.0001));
    float t = length((cuv - bx) / bh);
    float3 white = float3(1.0);
    float4 g = float4(0.0);
    if (t < st.x) {
        g = g_mix_stop(white, 1.0, white, st.z, t / max(st.x, 0.0001));
    } else if (t < st.y) {
        g = g_mix_stop(white, st.z, float3(poolTint.rgb), st.w, (t - st.x) / max(st.y - st.x, 0.0001));
    } else {
        g = g_mix_stop(float3(poolTint.rgb), st.w, float3(poolTint.rgb), 0.0, (t - st.y) / max(0.90 - st.y, 0.0001));
    }
    cardCol = g_over(cardCol, g.rgb, g.a * max(0.0, glowAmt) * inten);

    if (baseGlow > 0.0) {
        float top = 1.0 - G_BASE_BOTTOM - G_BASE_HEIGHT + po.y;
        float v = clamp((cuv.y - top) / max(G_BASE_HEIGHT * G_BASE_MID, 0.0001), 0.0, 1.0);
        float ex = abs(cuv.x - 0.5) * 2.0 * G_REF_X - G_REF_X;
        float cov = g_coverage(ex * gs, G_BASE_BLUR * gs);
        cardCol = g_over(cardCol, white, v * cov * max(0.0, baseGlow) * inten);
    }

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

    float2 dp = cuv * float2(2.0 * G_REF_X, 2.0 * G_REF_Y);
    float aaDot = max(0.35, 0.8 / gs);
    if (dotLayer < 0.5 && dotAmt > 0.0) {
        cardCol = g_over(cardCol, float3(dotColor.rgb),
                         g_dots(dp, uTime, aaDot, dotSpacing, dotSize, dotMotion, dotSpeed, dotDepth,
                                dotStyle, dotAngle, dotVary) * dotAmt);
    }

    float dCard = g_sd_round_box(q, halfExt, r);
    col = g_over(col, cardCol, 1.0 - smoothstep(-1.0, 1.0, dCard));

    if (borderAmt > 0.0) {
        float w = max(1.0 * gs, 0.5);
        float band = g_coverage(dCard, 0.6) - g_coverage(dCard + w, 0.6);
        col = g_over(col, float3(borderColor.rgb), band * borderAmt);
        float topMask = clamp(1.0 - cuv.y * 2.0, 0.0, 1.0);
        col = g_over(col, float3(borderColor.rgb), band * topMask * borderAmt * 1.27);
    }

    float dth = (fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    return half4(half3(clamp(col + dth, 0.0, 1.0)), 1.0);
}
`)!;

export default function SpikeAquaView() {
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
