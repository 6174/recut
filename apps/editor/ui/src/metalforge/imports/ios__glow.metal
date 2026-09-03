#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>

using namespace metal;

static inline float2 mfa_rot(float2 d, float a) {
    float c = cos(a);
    float s = sin(a);
    return float2(d.x * c - d.y * s, d.x * s + d.y * c);
}

static inline float mfa_tri(float x) {
    return abs(fract(x) * 2.0 - 1.0) * 2.0 - 1.0;
}

static inline float3 mfa_anim(float mode, float ph, float amt, float shp, float2 rest) {
    float2 d = (rest - 0.5) * 2.0;
    float z = 1.0;

    if (mode < 0.5) {
        d = mfa_rot(d, ph * 0.6 * amt);
        d.y = d.y * mix(1.0, 0.45, shp);
    } else if (mode < 1.5) {
        float w = sin(ph * 1.1);
        d = d * (1.0 + amt * 0.35 * w);
        z = 1.0 + amt * 0.8 * w;
    } else if (mode < 2.5) {
        float ax = mix(1.0, 1.8, shp);
        d = d + amt * 0.5 * float2(sin(ph * 0.7) * ax, sin(ph * 0.53 + 1.7));
    } else if (mode < 3.5) {
        float u = fract(ph * 0.45);
        float env = exp(-u * 6.0) + 0.6 * exp(-max(u - 0.18, 0.0) * 7.0);
        z = 1.0 + amt * 1.1 * (env - 0.42);
    } else {
        float s = mfa_tri(ph * 0.25);
        float k = s * amt * 1.2;
        d = float2(d.x - d.y * k, d.y + d.x * k);
        d = d * mix(1.0, 1.0 - 0.4 * abs(s), shp);
    }

    return float3(d.x, d.y, z);
}

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

constant float G_K = 2.104;

constant float3 G_CANVAS = float3(0.02745098, 0.02745098, 0.04313725);

constant float G_B1_BLUR = 1.0;       constant float G_B1_SPREAD = -0.3333333;
constant float G_B2_BLUR = 0.8235294; constant float G_B2_SPREAD = -0.2352941;
constant float G_B3_BLUR = 0.7567568; constant float G_B3_SPREAD = -0.3783784;
constant float G_B4_BLUR = 1.0;       constant float G_B4_SPREAD = -0.3333333;

constant float G_A1 = 0.42;
constant float G_A2 = 0.55;
constant float G_A3 = 1.0;
constant float G_A4 = 0.22;

constant float G_BF = 0.85;
constant float G_GAIN = 0.26;
constant float G_SEED = 17.0;

static inline float2 g_card_frame(float2 res) {
    return float2(393.0, 851.0) * max(min(res.x / 393.0, res.y / 851.0), 0.0001);
}

static inline float g_sd_round_box(float2 p, float2 ext, float r) {
    float2 q = abs(p) - ext + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

static inline float g_inset_band(float2 q, float2 ext, float r, float2 ldir,
                                 float dist, float blurK, float spreadK, float gs) {
    float spread = dist * spreadK * gs;
    float2 off = -ldir * dist * gs;
    float d = g_sd_round_box(q - off, ext - spread, max(r - spread, 0.0));
    float sigma = max(dist * blurK * gs * 0.5, 0.0001);
    return smoothstep(-G_K * sigma, G_K * sigma, d);
}

static inline float g_hash(float2 lattice, float channel) {
    float3 v = float3(lattice, channel + G_SEED);
    return fract(sin(dot(v, float3(127.1, 311.7, 74.7))) * 43758.5453123);
}

static inline float g_value_noise(float2 p, float channel) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 w = f * f * (3.0 - 2.0 * f);
    float a = g_hash(i, channel);
    float b = g_hash(i + float2(1.0, 0.0), channel);
    float c = g_hash(i + float2(0.0, 1.0), channel);
    float d = g_hash(i + float2(1.0, 1.0), channel);
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y) * 2.0 - 1.0;
}

static inline float g_fractal(float2 p, float channel) {
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

static inline float g_linear_to_srgb(float c) {
    return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

static inline float g_overlay(float base, float blend) {
    return base < 0.5 ? 2.0 * base * blend
                      : 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
}

static inline float3 g_over(float3 dst, float3 src, float a) {
    return mix(dst, src, clamp(a, 0.0, 1.0));
}

struct MFSrcArgs {
    float2 halfExt;
    float gs;
    float r;
    float rimSizeV, midSizeV, deepSizeV, topSizeV;
    float2 ldir;
    float inten;
    half4 bgTop, bgBottom, rimColor, midColor, deepColor, topColor;
};

static inline float3 mfSrc(float2 cuv, thread const MFSrcArgs& P) {
    float2 q = (cuv - 0.5) * 2.0 * P.halfExt;

    float3 cardCol = mix(float3(P.bgTop.rgb), float3(P.bgBottom.rgb),
                         clamp((q.y + P.halfExt.y) / max(2.0 * P.halfExt.y, 0.0001), 0.0, 1.0));

    float a4 = g_inset_band(q, P.halfExt, P.r, -P.ldir, P.topSizeV, G_B4_BLUR, G_B4_SPREAD, P.gs) * G_A4 * P.inten;
    cardCol = g_over(cardCol, float3(P.topColor.rgb), a4);
    float a3 = g_inset_band(q, P.halfExt, P.r,  P.ldir, P.deepSizeV, G_B3_BLUR, G_B3_SPREAD, P.gs) * G_A3 * P.inten;
    cardCol = g_over(cardCol, float3(P.deepColor.rgb), a3);
    float a2 = g_inset_band(q, P.halfExt, P.r,  P.ldir, P.midSizeV, G_B2_BLUR, G_B2_SPREAD, P.gs) * G_A2 * P.inten;
    cardCol = g_over(cardCol, float3(P.midColor.rgb), a2);
    float a1 = g_inset_band(q, P.halfExt, P.r,  P.ldir, P.rimSizeV, G_B1_BLUR, G_B1_SPREAD, P.gs) * G_A1 * P.inten;
    cardCol = g_over(cardCol, float3(P.rimColor.rgb), a1);

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

[[ stitchable ]] half4 glow(float2 position,
                                 half4 color,
                                 float4 boundingRect,
                                 float time,
                                 float anim,
                                 float animAmount,
                                 float animShape,
                                 float speed,
                                 float radius,
                                 float rimSize,
                                 float midSize,
                                 float deepSize,
                                 float topSize,
                                 float grainAmt,
                                 float intensity,
                                 float shadowAmt,
                                 float2 card,
                                 float2 light,
                                 half4 bgTop,
                                 half4 bgBottom,
                                 half4 rimColor,
                                 half4 midColor,
                                 half4 deepColor,
                                 half4 topColor,
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
    P.gs = max(min(P.halfExt.x / G_REF_X, P.halfExt.y / G_REF_Y), 0.0001);
    P.r = clamp(radius * P.gs, 0.0, min(P.halfExt.x, P.halfExt.y));
    P.rimSizeV = rimSize; P.midSizeV = midSize; P.deepSizeV = deepSize; P.topSizeV = topSize;

    float3 an = mfa_anim(anim, time * speed, animAmount, animShape, light);
    P.ldir = an.xy;
    P.inten = max(0.0f, intensity * an.z);

    P.bgTop = bgTop; P.bgBottom = bgBottom; P.rimColor = rimColor;
    P.midColor = midColor; P.deepColor = deepColor; P.topColor = topColor;

    float2 q = p - 0.5 * res;
    float3 col = G_CANVAS;

    col = mfs_card_shadow(col, q, P.halfExt, P.r, P.gs, P.ldir, shadowAmt, P.inten,
                          float3(shadowColor.rgb));

    float2 cres = 2.0 * P.halfExt;
    float2 cuv = (q + P.halfExt) / max(cres, float2(1.0));
    float3 cardCol = mfFilter(cuv, cres, filter, frame.x / 393.0,
                              fAmount, fScale, fBlur, fFade, fSoft, fAngle, fGrain, fBrightness, fContrast, fSaturation, fRound, fBevel, fInset, P);

    if (grainAmt > 0.0) {
        float2 np = q / P.gs * G_BF;
        float nr = g_linear_to_srgb(g_fractal(np, 0.0));
        float ng = g_linear_to_srgb(g_fractal(np, 101.0));
        float nb = g_linear_to_srgb(g_fractal(np, 211.0));
        float na = g_fractal(np, 307.0);
        float3 mixed = float3(g_overlay(cardCol.r, nr),
                              g_overlay(cardCol.g, ng),
                              g_overlay(cardCol.b, nb));
        cardCol = mix(cardCol, mixed, clamp(grainAmt * na, 0.0, 1.0));
    }

    float dCard = g_sd_round_box(q, P.halfExt, P.r);
    col = g_over(col, cardCol, 1.0 - smoothstep(-1.0, 1.0, dCard));

    float dth = (fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    return half4(half3(clamp(col + dth, 0.0, 1.0)), 1.0h);
}
