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

constant float G_K = 2.104;

constant float3 G_CANVAS = float3(0.02745098, 0.02745098, 0.04313725);

constant float2 WAVE_C = float2(0.0, 134.4);
constant float2 WAVE_E = float2(256.0, 184.8);

constant float WAVE_S1 = 0.34;
constant float WAVE_S2 = 0.74;

constant float2 WAVE_HOT_C = float2(0.0, 205.8);
constant float2 WAVE_HOT_E = float2(192.0, 71.4);

constant float WAVE_HOT_MID = 0.46;
constant float WAVE_HOT_MID_A = 0.75;
constant float WAVE_HOT_END = 0.78;

constant float WAVE_SCRIM_A = 0.9;

constant float WAVE_PAR = 30.0;

constant float G_BF = 0.80;
constant float G_GAIN = 0.26;
constant float G_SEED = 17.0;

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

static inline float g_sd_ellipse(float2 p, float2 rad) {
    float k = length(p / max(rad, float2(0.0001)));
    return (k - 1.0) * min(rad.x, rad.y);
}

static inline float g_sd_dome(float2 p, float2 ext, float domeFrac) {
    float ry = clamp(domeFrac, 0.0001, 1.0) * 2.0 * ext.y;
    float cy = -ext.y + ry;
    float arc = g_sd_ellipse(float2(p.x, min(p.y - cy, 0.0)), float2(ext.x, ry));
    return max(max(abs(p.x) - ext.x, p.y - ext.y), arc);
}

static inline float2 g_parallax(float2 ldir, float k, float gs) {
    return (ldir - float2(0.0, 1.0)) * k * gs;
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
    float waveBlurV, waveDomeV, hotBlurV, scrimHeightV;
    float2 ldir;
    float inten;
    half4 fillColor, domeFoot, domeLower, domeUpper, domeApex, hotEdge;
};

static inline float3 mfSrc(float2 cuv, thread const MFSrcArgs& P) {
    float2 q = (cuv - 0.5) * 2.0 * P.halfExt;

    float3 cardCol = float3(P.fillColor.rgb);

    float2 par = g_parallax(P.ldir, WAVE_PAR, P.gs);

    float2 dp = q - par - WAVE_C * P.gs;
    float2 dext = WAVE_E * P.gs;
    float dDome = g_sd_dome(dp, dext, P.waveDomeV);
    float aDome = g_coverage(dDome, P.waveBlurV * P.gs) * P.inten;
    float v = clamp((dp.y + dext.y) / max(2.0 * dext.y, 0.0001), 0.0, 1.0);
    float3 domeCol;
    if (v < WAVE_S1) {
        domeCol = mix(float3(P.domeApex.rgb), float3(P.domeUpper.rgb), v / WAVE_S1);
    } else if (v < WAVE_S2) {
        domeCol = mix(float3(P.domeUpper.rgb), float3(P.domeLower.rgb),
                      (v - WAVE_S1) / (WAVE_S2 - WAVE_S1));
    } else {
        domeCol = mix(float3(P.domeLower.rgb), float3(P.domeFoot.rgb),
                      (v - WAVE_S2) / (1.0 - WAVE_S2));
    }
    cardCol = g_over(cardCol, domeCol, aDome);

    float2 hp = q - par - WAVE_HOT_C * P.gs;
    float2 hext = WAVE_HOT_E * P.gs;
    float e = length(hp / max(hext, float2(0.0001)));
    float aHot;
    if (e <= WAVE_HOT_MID) {
        aHot = mix(1.0, WAVE_HOT_MID_A, e / WAVE_HOT_MID);
    } else if (e <= WAVE_HOT_END) {
        aHot = mix(WAVE_HOT_MID_A, 0.0, (e - WAVE_HOT_MID) / (WAVE_HOT_END - WAVE_HOT_MID));
    } else {
        aHot = 0.0;
    }
    float minR = min(hext.x, hext.y);
    aHot = aHot * g_coverage((e - WAVE_HOT_END) * minR, P.hotBlurV * P.gs) * P.inten;
    float3 hotCol = mix(float3(P.domeFoot.rgb), float3(P.hotEdge.rgb),
                        clamp(e / WAVE_HOT_MID, 0.0, 1.0));
    cardCol = g_over(cardCol, hotCol, aHot);

    float t = cuv.y;
    float sh = max(P.scrimHeightV, 0.0001);
    float aScrim = t >= sh ? 0.0 : mix(WAVE_SCRIM_A, 0.0, clamp(t / sh, 0.0, 1.0));
    cardCol = g_over(cardCol, float3(P.fillColor.rgb), aScrim);

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

[[ stitchable ]] half4 wave(float2 position,
                                half4 color,
                                float4 boundingRect,
                                float time,
                                float radius,
                                float waveBlur,
                                float waveDome,
                                float hotBlur,
                                float scrimHeight,
                                float grainAmt,
                                float intensity,
                                float shadowAmt,
                                float2 card,
                                float2 light,
                                half4 fillColor,
                                half4 domeFoot,
                                half4 domeLower,
                                half4 domeUpper,
                                half4 domeApex,
                                half4 hotEdge,
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
    P.waveBlurV = waveBlur; P.waveDomeV = waveDome;
    P.hotBlurV = hotBlur; P.scrimHeightV = scrimHeight;

    P.ldir = (light - 0.5f) * 2.0f;
    P.inten = max(0.0f, intensity);

    P.fillColor = fillColor; P.domeFoot = domeFoot; P.domeLower = domeLower;
    P.domeUpper = domeUpper; P.domeApex = domeApex; P.hotEdge = hotEdge;

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
