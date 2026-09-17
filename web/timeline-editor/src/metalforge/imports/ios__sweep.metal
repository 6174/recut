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

constant float G_REF_X = 160.0;
constant float G_REF_Y = 210.0;

constant float3 G_CANVAS = float3(0.02745098, 0.02745098, 0.04313725);

constant float G_WOBBLE_FR = 2.3;
constant float2 G_WOBBLE_OFF = float2(4.7, 2.3);

constant float2 G_RR = float2(0.68, 0.74);
constant float G_R_A0 = 0.02;
constant float G_R_A1 = 0.42;
constant float G_R_B0 = 0.34;
constant float G_R_B1 = 0.80;
constant float G_R_C0 = 0.72;
constant float G_R_C1 = 1.30;

constant float2 G_LOBE_C = float2(0.88, 0.64);
constant float2 G_LOBE_RR = float2(0.34, 0.44);
constant float G_LOBE_E0 = 0.20;
constant float G_LOBE_E1 = 1.00;
constant float G_LOBE_A = 0.55;

constant float G_TOP_AMT = 0.35;
constant float G_TOP_END = 0.52;

constant float G_SCRIM_H = 184.8;
constant float G_SCRIM_END = 0.88;

constant float G_DITHER_FR = 0.71;
constant float G_DITHER_AMP = 0.04;

static inline float2 g_card_frame(float2 res) {
    return float2(393.0, 851.0) * max(min(res.x / 393.0, res.y / 851.0), 0.0001);
}

static inline float g_sd_round_box(float2 p, float2 ext, float r) {
    float2 q = abs(p) - ext + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

static inline float3 g_over(float3 dst, float3 src, float a) {
    return mix(dst, src, clamp(a, 0.0, 1.0));
}

static inline float g_hash(float2 p) {
    return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453123);
}

static inline float g_noise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(g_hash(i), g_hash(i + float2(1.0, 0.0)), u.x),
               mix(g_hash(i + float2(0.0, 1.0)), g_hash(i + float2(1.0, 1.0)), u.x),
               u.y);
}

static inline float2 g_wobble(float2 uv, float amp, float fr) {
    float a = g_noise(uv * fr) - 0.5;
    float b = g_noise(uv * fr + G_WOBBLE_OFF) - 0.5;
    return uv + amp * float2(a, b);
}

struct MFSrcArgs {
    float wobbleV, spreadV, scrimAmtV;
    float2 lightC;
    float inten;
    half4 bgColor, coreColor, midColor, outerColor, baseColor, lobeColor;
};

static inline float3 mfSrc(float2 cuv, thread const MFSrcArgs& P) {
    float3 bg = float3(P.bgColor.rgb);

    float2 p = g_wobble(cuv, P.wobbleV, G_WOBBLE_FR);

    float2 rr = max(G_RR * P.spreadV, float2(0.0001));
    float rd = length((p - P.lightC) / rr);
    float3 col = mix(float3(P.coreColor.rgb), float3(P.midColor.rgb), smoothstep(G_R_A0, G_R_A1, rd));
    col = mix(col, float3(P.outerColor.rgb), smoothstep(G_R_B0, G_R_B1, rd));
    col = mix(col, float3(P.baseColor.rgb), smoothstep(G_R_C0, G_R_C1, rd));

    float rl = length((p - G_LOBE_C) / G_LOBE_RR);
    col = mix(col, float3(P.lobeColor.rgb),
              (1.0 - smoothstep(G_LOBE_E0, G_LOBE_E1, rl)) * G_LOBE_A);

    col *= 1.0 - G_TOP_AMT * (1.0 - smoothstep(0.0, G_TOP_END, p.y));

    col = clamp(col, 0.0, 1.0);

    float3 cardCol = clamp(bg + (col - bg) * P.inten, 0.0, 1.0);

    float st = cuv.y * 2.0 * G_REF_Y / G_SCRIM_H;
    float sa = P.scrimAmtV * clamp(1.0 - st / G_SCRIM_END, 0.0, 1.0);
    cardCol = g_over(cardCol, float3(0.0), sa);

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

[[ stitchable ]] half4 sweep(float2 position,
                             half4 color,
                             float4 boundingRect,
                             float time,
                             float radius,
                             float spread,
                             float wobble,
                             float scrimAmt,
                             float intensity,
                             float shadowAmt,
                             float2 card,
                             float2 light,
                             half4 bgColor,
                             half4 coreColor,
                             half4 midColor,
                             half4 outerColor,
                             half4 baseColor,
                             half4 lobeColor,
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

    float2 frame = g_card_frame(res);
    float2 halfExt = 0.5 * clamp(card, 0.02, 1.0) * frame;
    float gs = max(min(halfExt.x / G_REF_X, halfExt.y / G_REF_Y), 0.0001);
    float r = clamp(radius * gs, 0.0, min(halfExt.x, halfExt.y));

    MFSrcArgs P;
    P.wobbleV = wobble;
    P.spreadV = spread;
    P.scrimAmtV = scrimAmt;
    P.lightC = light;
    P.inten = max(0.0f, intensity);
    P.bgColor = bgColor; P.coreColor = coreColor; P.midColor = midColor;
    P.outerColor = outerColor; P.baseColor = baseColor; P.lobeColor = lobeColor;

    float2 q = p - 0.5 * res;
    float3 col = G_CANVAS;

    float2 ldir = (light - 0.5f) * 2.0f;
    col = mfs_card_shadow(col, q, halfExt, r, gs, ldir, shadowAmt, P.inten,
                          float3(shadowColor.rgb));

    float2 cres = 2.0 * halfExt;
    float2 cuv = (q + halfExt) / max(cres, float2(1.0));
    float3 cardCol = mfFilter(cuv, cres, filter, frame.x / 393.0,
                              fAmount, fScale, fBlur, fFade, fSoft, fAngle, fGrain, fBrightness, fContrast, fSaturation, fRound, fBevel, fInset, P);

    float2 dp = (q / gs + float2(G_REF_X, G_REF_Y)) * G_DITHER_FR;
    cardCol = clamp(cardCol + (g_hash(dp) - 0.5) * G_DITHER_AMP, 0.0, 1.0);

    float dCard = g_sd_round_box(q, halfExt, r);
    col = g_over(col, cardCol, 1.0 - smoothstep(-1.0, 1.0, dCard));

    return half4(half3(clamp(col, 0.0, 1.0)), 1.0h);
}
