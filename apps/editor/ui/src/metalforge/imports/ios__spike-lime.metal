#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>

using namespace metal;

constant float MFS_K = 2.104;

constant float MFS_OFF = 34.0;
constant float MFS_BLUR = 70.0;
constant float MFS_SPREAD = -24.0;

constant float MFS_ALPHA = 0.55;

static inline float mfs_sd_round_box(float2 p, float2 ext, float r) {
    float2 q = abs(p) - ext + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

static inline float3 mfs_card_shadow(float3 dst, float2 q, float2 ext, float r, float gs,
                                     float2 ldir, float amt, float inten, float3 tint) {
    float spread = MFS_SPREAD * gs;
    float2 sext = max(ext + spread, 0.0);
    float sr = clamp(r + spread, 0.0, min(sext.x, sext.y));
    float2 off = ldir * MFS_OFF * gs;
    float sigma = max(MFS_BLUR * gs * 0.5, 0.0001);
    float d = mfs_sd_round_box(q - off, sext, sr);
    float cov = 1.0 - smoothstep(-MFS_K * sigma, MFS_K * sigma, d);
    return mix(dst, tint, clamp(cov * MFS_ALPHA * amt * inten, 0.0, 1.0));
}

constant float G_REF_X = 150.0;
constant float G_REF_Y = 150.0;

constant float G_K = 2.104;

constant float3 G_CANVAS = float3(0.02745098, 0.02745098, 0.04313725);

constant float G_PAR_1 = 8.0;
constant float G_PAR_2 = 14.0;

constant float G_BASE_BOTTOM = -0.06;
constant float G_BASE_HEIGHT = 0.16;
constant float G_BASE_MID = 0.72;
constant float G_BASE_BLUR = 12.0;

constant float G_WAVE_ANGLE = 0.7853982;
constant float G_WAVE_COUNT = 2.0;

constant float G_AW_BACK = 0.62;

constant float G_AMP_WAVE = 11.0;
constant float G_AMP_SWELL = 17.0;
constant float G_AMP_DRIFT = 26.0;

constant float G_TAU = 6.28318530718;

constant float G_QN_1 = 0.9;
constant float G_QN_2 = 1.8;
constant float G_QW_0 = 0.36633;
constant float G_QW_1 = 0.24434;
constant float G_QW_2 = 0.07249;

static inline float2 g_card_frame(float2 res) {
    return float2(393.0, 851.0) * max(min(res.x / 393.0, res.y / 851.0), 0.0001);
}

static inline float g_sd_round_box(float2 p, float2 ext, float r) {
    float2 q = abs(p) - ext + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

static inline float g_coverage(float d, float sigma) {
    float s = max(sigma, 0.0001);
    return 1.0 - smoothstep(-G_K * s, G_K * s, d);
}

static inline float3 g_over(float3 dst, float3 src, float a) {
    return mix(dst, src, clamp(a, 0.0, 1.0));
}

static inline float4 g_mix_stop(float3 c1, float a1, float3 c2, float a2, float f) {
    float4 p1 = float4(c1 * a1, a1);
    float4 p2 = float4(c2 * a2, a2);
    float4 pm = mix(p1, p2, clamp(f, 0.0, 1.0));
    float3 rgb = c2;
    if (pm.a > 1e-6) { rgb = pm.rgb / pm.a; }
    return float4(rgb, pm.a);
}

static inline float2 g_parallax(float2 ldir, float k) {
    return (ldir - float2(0.0, 1.0)) * k;
}

static inline float g_anim_t(float anim, float time, float animSpeed) {
    return int(anim + 0.5) > 2 ? 0.0 : time * max(animSpeed, 0.0);
}

static inline int g_anim_depth(int layerIdx) {
    return 1 - layerIdx;
}

static inline float g_anim_weight(int layerIdx, float spread) {
    float w = 1.0;
    if (g_anim_depth(layerIdx) == 1) { w = G_AW_BACK; }
    return mix(1.0, w, clamp(spread, 0.0, 2.0));
}

static inline float2 g_light_dir(float2 light, float lightSway, float tt) {
    return (light - 0.5f) * 2.0f
         + float2(sin(tt * 0.31), sin(tt * 0.23)) * (0.5 * clamp(lightSway, 0.0, 1.0));
}

static inline float g_intensity(float intensity, float glowPulse, float tt) {
    float pulse = 1.0 + 0.35 * clamp(glowPulse, 0.0, 1.0) * sin(tt * 0.8);
    return max(0.0f, intensity) * max(pulse, 0.0f);
}

static inline float g_dot_hash(float2 cell, float salt) {
    return fract(sin(dot(cell + salt, float2(127.1, 311.7))) * 43758.5453123);
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

struct MFSrcArgs {
    float2 halfExt;
    float gs, sx, sy, r;
    float styleV, mound1BlurV, mound2BlurV, glowAmtV, baseGlowV;
    float2 ldir;
    float inten;
    half4 bgColor, mound1Color, mound2Color, poolTint;
    int animMode;
    float tt, animAmountV, animSpreadV, waveFreqV;
    float timeV, dotStyleV, dotLayerV, dotSpacingV, dotSizeV, dotAmtV;
    float dotMotionV, dotSpeedV, dotDepthV, dotAngleV, dotVaryV;
    half4 dotColorV;
};

static inline float2 g_anim_offset(int layerIdx, float x, thread const MFSrcArgs& P) {
    float2 o = float2(0.0);
    if (P.animMode <= 2) {
        float d = float(g_anim_depth(layerIdx));
        float w = g_anim_weight(layerIdx, P.animSpreadV) * max(P.animAmountV, 0.0);
        float rate = 1.0 - 0.22 * d;
        float ph = d * 0.9;
        if (P.animMode == 0) {
            float k = G_TAU * max(P.waveFreqV, 0.0) / (2.0 * G_REF_X);
            o.y = G_AMP_WAVE * w * sin(k * x - P.tt * 1.1 * rate + ph);
        } else if (P.animMode == 1) {
            o.y = G_AMP_SWELL * w * sin(P.tt * 0.75 * rate + ph);
            o.x = 0.45 * G_AMP_SWELL * w * sin(P.tt * 0.38 * rate + ph + 1.7);
        } else {
            o.x = G_AMP_DRIFT * w * sin(P.tt * 0.55 * rate + ph);
            o.y = 0.30 * G_AMP_DRIFT * w * sin(P.tt * 0.37 * rate + ph + 2.1);
        }
    }
    return o;
}

static inline float g_mound_at(int styleIdx, int layerIdx, float x, float py, float sigma, float sy,
                               thread const MFSrcArgs& P) {
    float2 o = g_anim_offset(layerIdx, x, P);
    float2 r = mfRidge(styleIdx, layerIdx, x + o.x);
    return g_coverage((r.x + o.y - py) * sy, sigma);
}

static inline float g_mound_coverage(float2 p, int styleIdx, int layerIdx, float sigma,
                     float sx, float sy, thread const MFSrcArgs& P) {
    float sdx = sigma / max(sx, 0.0001);
    float n1 = G_QN_1 * sdx;
    float n2 = G_QN_2 * sdx;
    return G_QW_0 * g_mound_at(styleIdx, layerIdx, p.x, p.y, sigma, sy, P)
         + G_QW_1 * (g_mound_at(styleIdx, layerIdx, p.x + n1, p.y, sigma, sy, P)
                   + g_mound_at(styleIdx, layerIdx, p.x - n1, p.y, sigma, sy, P))
         + G_QW_2 * (g_mound_at(styleIdx, layerIdx, p.x + n2, p.y, sigma, sy, P)
                   + g_mound_at(styleIdx, layerIdx, p.x - n2, p.y, sigma, sy, P));
}

static inline float4 g_pool_box(int styleIdx) {
    float4 b = float4(-0.14, 1.28, -0.18, 0.44);
    if (styleIdx == 1) { b = float4(-0.24, 0.70, -0.20, 0.38); }
    else if (styleIdx == 2) { b = float4(0.02, 0.96, -0.22, 0.40); }
    return b;
}

static inline float4 g_pool_stops(int styleIdx) {
    float4 s = float4(0.46, 0.72, 0.92, 0.50);
    if (styleIdx == 1) { s = float4(0.40, 0.70, 0.90, 0.45); }
    else if (styleIdx == 2) { s = float4(0.42, 0.72, 0.82, 0.40); }
    return s;
}

static inline float g_sd_tri(float2 p, float r) {
    float k = 1.7320508;
    p = float2(abs(p.x) - r, p.y + r / k);
    if (p.x + k * p.y > 0.0) { p = float2(p.x - k * p.y, -k * p.x - p.y) * 0.5; }
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
}

static inline float3 g_pattern(float2 gp, float pitch, float rad, float aa, int style) {
    float2 baseCell = floor(gp / pitch);
    float2 off = gp - (baseCell + 0.5) * pitch;

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

static inline float g_dots(float2 dp, float t, float aa,
                           float spacing, float size, float motion,
                           float speed, float depth,
                           float styleV, float angle, float vary) {
    int style = int(styleV + 0.5);
    if (style <= 0) { return 0.0; }
    float pitch = max(spacing, 0.5);
    float ang = angle * 0.0174532925;
    float ca = cos(ang);
    float sa = sin(ang);
    float2 gp = float2(dp.x * ca - dp.y * sa, dp.x * sa + dp.y * ca);
    float rad = max(size, 0.05);

    float3 hit = g_pattern(gp, pitch, rad, aa, style);
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

static inline float3 mfSrc(float2 cuv, thread const MFSrcArgs& P) {
    int sIdx = int(P.styleV + 0.5);

    float2 dp = cuv * float2(2.0 * G_REF_X, 2.0 * G_REF_Y);

    float3 cardCol = float3(P.bgColor.rgb);

    if (P.dotLayerV > 0.5 && P.dotAmtV > 0.0) {
        cardCol = g_over(cardCol, float3(P.dotColorV.rgb),
                         g_dots(dp, P.timeV, max(0.35, 0.8 / P.gs),
                                P.dotSpacingV, P.dotSizeV, P.dotMotionV, P.dotSpeedV,
                                P.dotDepthV, P.dotStyleV, P.dotAngleV, P.dotVaryV) * P.dotAmtV);
    }

    float2 o1 = g_parallax(P.ldir, G_PAR_1);
    cardCol = g_over(cardCol, float3(P.mound1Color.rgb),
                     g_mound_coverage(dp - o1, sIdx, 0, P.mound1BlurV * P.gs, P.sx, P.sy, P) * P.inten);

    float2 o2 = g_parallax(P.ldir, G_PAR_2);
    cardCol = g_over(cardCol, float3(P.mound2Color.rgb),
                     g_mound_coverage(dp - o2, sIdx, 1, P.mound2BlurV * P.gs, P.sx, P.sy, P) * P.inten);

    float4 box = g_pool_box(sIdx);
    float4 st = g_pool_stops(sIdx);
    float2 bx = float2(box.x + box.y * 0.5, 1.0 - box.z - box.w * 0.5);
    float2 bh = max(float2(box.y, box.w) * 0.5, float2(0.0001));
    float2 po = g_anim_offset(1, bx.x * 2.0 * G_REF_X, P) / float2(2.0 * G_REF_X, 2.0 * G_REF_Y);
    bx += po;
    float t = length((cuv - bx) / bh);
    float3 white = float3(1.0);
    float4 g = float4(0.0);
    if (t < st.x) {
        g = g_mix_stop(white, 1.0, white, st.z, t / max(st.x, 0.0001));
    } else if (t < st.y) {
        g = g_mix_stop(white, st.z, float3(P.poolTint.rgb), st.w, (t - st.x) / max(st.y - st.x, 0.0001));
    } else {
        g = g_mix_stop(float3(P.poolTint.rgb), st.w, float3(P.poolTint.rgb), 0.0, (t - st.y) / max(0.90 - st.y, 0.0001));
    }
    cardCol = g_over(cardCol, g.rgb, g.a * max(0.0, P.glowAmtV) * P.inten);

    if (P.baseGlowV > 0.0) {
        float top = 1.0 - G_BASE_BOTTOM - G_BASE_HEIGHT + po.y;
        float v = clamp((cuv.y - top) / max(G_BASE_HEIGHT * G_BASE_MID, 0.0001), 0.0, 1.0);
        float ex = abs(cuv.x - 0.5) * 2.0 * G_REF_X - G_REF_X;
        float cov = g_coverage(ex * P.gs, G_BASE_BLUR * P.gs);
        cardCol = g_over(cardCol, white, v * cov * max(0.0, P.baseGlowV) * P.inten);
    }

    return cardCol;
}

static inline float3 mfTap(float2 uv, thread const MFSrcArgs& P) {
    return mfSrc(clamp(uv, 0.0, 1.0), P);
}

static inline float3 mfBlurAt(float2 uv, float2 res, float radiusPx,
                              thread const MFSrcArgs& P) {
    if (radiusPx < 0.35) { return mfTap(uv, P); }
    float2 step = radiusPx / max(res, float2(1.0));
    float3 sum = mfTap(uv, P) * 0.18;
    for (int i = 0; i < 8; ++i) {
        float ang = (float(i) / 8.0) * 6.2831853;
        float2 d = float2(cos(ang), sin(ang));
        sum += mfTap(uv + d * step * 0.55, P) * 0.075;
        sum += mfTap(uv + d * step, P) * 0.0275;
    }
    return sum;
}

static inline float3 mfMotionAt(float2 uv, float2 res, float radiusPx, float angleDeg,
                                thread const MFSrcArgs& P) {
    if (radiusPx < 0.35) { return mfTap(uv, P); }
    float th = angleDeg * 0.017453292;
    float2 d = float2(cos(th), sin(th)) * radiusPx / max(res, float2(1.0));
    float3 sum = float3(0.0);
    for (int i = -8; i <= 8; ++i) {
        sum += mfTap(uv + d * (float(i) / 8.0), P);
    }
    return sum / 17.0;
}

static inline float mfLuma(float3 c) {
    return dot(c, float3(0.2126, 0.7152, 0.0722));
}

static inline float mfFilmGrain(float2 uv) {
    float x = (uv.x + 4.0) * (uv.y + 4.0) * 10.0;
    return fmod((fmod(x, 13.0) + 1.0) * (fmod(x, 123.0) + 1.0), 0.01) - 0.005;
}

static inline float mfHash21(float2 p) {
    return fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
}

static inline float mfVnoise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mfHash21(i), mfHash21(i + float2(1.0, 0.0)), u.x),
        mix(mfHash21(i + float2(0.0, 1.0)), mfHash21(i + float2(1.0, 1.0)), u.x),
        u.y);
}

static inline float2 mfAspect(float2 res) {
    return float2(res.x / max(res.y, 1.0), 1.0);
}

static inline float3 mfFilter(float2 uv, float2 res, float mode, float ppp,
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
                              float fInset,
                              thread const MFSrcArgs& P) {
    int m = int(mode + 0.5);
    float3 col = mfTap(uv, P);

    if (m == 5) {
        float a = fBlur;
        col = mfBlurAt(uv, res, a * ppp, P);
    } else if (m == 6) {
        float a = fBlur;
        float b = fFade;
        float k = smoothstep(clamp(1.0 - b, 0.0, 0.999), 1.0, uv.y);
        col = mix(col, mfBlurAt(uv, res, a * ppp, P), k);
    } else if (m == 11) {
        col = mfMotionAt(uv, res, fBlur * ppp, fAngle, P);
    } else if (m == 7) {
        float a = fAmount;
        float b = fSoft;
        float halfDiag = length(res) * 0.5;
        float r = length((uv - 0.5) * res) / max(halfDiag, 1.0);
        float inner = mix(0.95, 0.15, clamp(b, 0.0, 1.0));
        float k = clamp((r - inner) / max(1.05 - inner, 0.001), 0.0, 1.0);
        col = col * (1.0 - clamp(a, 0.0, 1.0) * k);
    } else if (m == 8) {
        float a = fBrightness;
        col = clamp(col + a, 0.0, 1.0);
    } else if (m == 9) {
        float a = fContrast;
        col = clamp((col - 0.5) * a + 0.5, 0.0, 1.0);
    } else if (m == 10) {
        float a = fSaturation;
        col = clamp(mix(float3(mfLuma(col)), col, a), 0.0, 1.0);
    } else if (m == 1) {
        float a = fGrain;
        col = clamp(col + mfFilmGrain(uv) * a, 0.0, 1.0);
    } else if (m == 2) {
        float a = fAmount;
        float b = fScale;
        float s = max(b, 0.5);
        float2 w = float2(
            sin(uv.y * s * 6.2831853 + 1.3) + 0.5 * sin(uv.y * s * 12.9 + 0.7),
            cos(uv.x * s * 6.2831853 + 2.1) + 0.5 * cos(uv.x * s * 11.3 + 1.9));
        col = mfTap(uv + w * a * 0.02, P);
    } else if (m == 4) {
        float a = fAmount;
        float b = fScale;
        float2 asp = mfAspect(res);
        float2 cell = floor(uv * asp * max(b, 1.0));
        float h1 = mfHash21(cell);
        float h2 = mfHash21(cell + float2(37.0, 17.0));
        float2 off = (float2(h1, h2) - 0.5) * a * 0.06 / asp;
        col = clamp(mfTap(uv + off, P) * (1.0 + (h1 - 0.5) * a * 0.35), 0.0, 1.0);
    } else if (m == 3) {
        float a = fAmount;
        float b = fBlur;
        float2 asp = mfAspect(res);
        float2 p = uv * asp * 42.0;
        float2 n = float2(mfVnoise(p), mfVnoise(p + float2(7.3, 2.1))) - 0.5;
        col = mfBlurAt(uv + n * a * 0.05 / asp, res, b * ppp, P);
    }
    return col;
}

[[ stitchable ]] half4 spikeLime(float2 position,
                             half4 color,
                             float4 boundingRect,
                             float time,
                             float style,
                             float anim,
                             float radius,
                             float mound1Blur,
                             float mound2Blur,
                             float glowAmt,
                             float baseGlow,
                             float dotSpacing,
                             float dotSize,
                             float dotAmt,
                             float dotMotion,
                             float dotSpeed,
                             float dotDepth,
                             float dotStyle,
                             float dotLayer,
                             float dotAngle,
                             float dotVary,
                             float borderAmt,
                             float intensity,
                             float shadowAmt,
                             float animSpeed,
                             float animAmount,
                             float animSpread,
                             float waveFreq,
                             float lightSway,
                             float glowPulse,
                             float2 card,
                             float2 light,
                             half4 bgColor,
                             half4 mound1Color,
                             half4 mound2Color,
                             half4 poolTint,
                             half4 dotColor,
                             half4 borderColor,
                             half4 shadowColor,
                             float filter,
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
    float2 res = boundingRect.zw;
    float2 p = position;

    MFSrcArgs P;
    float2 frame = g_card_frame(res);
    P.halfExt = 0.5 * clamp(card, 0.02, 1.0) * frame;
    P.sx = max(P.halfExt.x / G_REF_X, 0.0001);
    P.sy = max(P.halfExt.y / G_REF_Y, 0.0001);
    P.gs = max(min(P.sx, P.sy), 0.0001);
    P.r = clamp(radius * P.gs, 0.0, min(P.halfExt.x, P.halfExt.y));
    P.styleV = style;
    P.mound1BlurV = mound1Blur;
    P.mound2BlurV = mound2Blur;
    P.glowAmtV = glowAmt;
    P.baseGlowV = baseGlow;
    P.animMode = int(anim + 0.5);
    P.tt = g_anim_t(anim, time, animSpeed);
    P.animAmountV = animAmount;
    P.animSpreadV = animSpread;
    P.waveFreqV = waveFreq;
    P.timeV = time;
    P.dotStyleV = dotStyle;
    P.dotLayerV = dotLayer;
    P.dotSpacingV = dotSpacing;
    P.dotSizeV = dotSize;
    P.dotAmtV = dotAmt;
    P.dotMotionV = dotMotion;
    P.dotSpeedV = dotSpeed;
    P.dotDepthV = dotDepth;
    P.dotAngleV = dotAngle;
    P.dotVaryV = dotVary;
    P.dotColorV = dotColor;

    P.ldir = g_light_dir(light, lightSway, P.tt);
    P.inten = g_intensity(intensity, glowPulse, P.tt);
    P.bgColor = bgColor;
    P.mound1Color = mound1Color;
    P.mound2Color = mound2Color;
    P.poolTint = poolTint;

    float2 q = p - 0.5 * res;
    float3 col = G_CANVAS;

    col = mfs_card_shadow(col, q, P.halfExt, P.r, P.gs, P.ldir, shadowAmt, P.inten,
                          float3(shadowColor.rgb));

    float2 cres = 2.0 * P.halfExt;
    float2 cuv = (q + P.halfExt) / max(cres, float2(1.0));
    float3 cardCol = mfFilter(cuv, cres, filter, frame.x / 393.0,
                              fAmount, fScale, fBlur, fFade, fSoft, fAngle, fGrain, fBrightness, fContrast, fSaturation, fRound, fBevel, fInset, P);

    float2 dp = cuv * float2(2.0 * G_REF_X, 2.0 * G_REF_Y);
    float aaDot = max(0.35, 0.8 / P.gs);
    if (dotLayer < 0.5 && dotAmt > 0.0) {
        cardCol = g_over(cardCol, float3(dotColor.rgb),
                         g_dots(dp, time, aaDot, dotSpacing, dotSize, dotMotion, dotSpeed, dotDepth,
                                dotStyle, dotAngle, dotVary) * dotAmt);
    }

    float dCard = g_sd_round_box(q, P.halfExt, P.r);
    col = g_over(col, cardCol, 1.0 - smoothstep(-1.0, 1.0, dCard));

    if (borderAmt > 0.0) {
        float w = max(1.0 * P.gs, 0.5);
        float band = g_coverage(dCard, 0.6) - g_coverage(dCard + w, 0.6);
        col = g_over(col, float3(borderColor.rgb), band * borderAmt);
        float topMask = clamp(1.0 - cuv.y * 2.0, 0.0, 1.0);
        col = g_over(col, float3(borderColor.rgb), band * topMask * borderAmt * 1.27);
    }

    float dth = (fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    return half4(half3(clamp(col + dth, 0.0, 1.0)), 1.0h);
}
