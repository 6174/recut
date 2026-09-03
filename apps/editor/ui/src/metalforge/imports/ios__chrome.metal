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

constant float G_RIM_DIST = 1.0;
constant float G_RIM_SIGMA = 0.5;
constant float G_RIM_SPREAD = 0.0;

constant float2 G_HALO_EXT = float2(230.4, 130.2);
constant float2 G_HALO_CTR = float2(0.0, -205.8);
constant float G_HALO_S1 = 0.44;
constant float G_HALO_S2 = 0.76;
constant float G_HALO_A1 = 0.60;
constant float G_HALO_M0 = -(1.0 - G_HALO_A1) / G_HALO_S1;
constant float G_HALO_M1 = -G_HALO_A1 / (G_HALO_S2 - G_HALO_S1);
constant float G_HALO_NEAR = 1.45;
constant float G_HALO_FAR = 0.85;
constant float G_HALO_BLEND = 2.0;

constant float G_WASH_S1 = 0.22;
constant float G_WASH_S2 = 0.48;
constant float G_WASH_A0 = 0.30;
constant float G_WASH_A1 = 0.12;

constant float G_FOOT_MID = 0.62;

constant float G_BF = 0.75;
constant float G_GAIN = 0.26;
constant float G_SEED = 17.0;

static inline float2 g_card_frame(float2 res) {
    return float2(393.0, 851.0) * max(min(res.x / 393.0, res.y / 851.0), 0.0001);
}

static inline float g_sd_round_box(float2 p, float2 ext, float r) {
    float2 q = abs(p) - ext + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

static inline float g_soft_ramp(float x, float a) {
    float aa = max(a, 1e-6);
    float u = clamp((x + aa) / (2.0 * aa), 0.0, 1.0);
    return 2.0 * aa * (u * u * u - 0.5 * u * u * u * u) + max(x - aa, 0.0);
}

static inline float g_inset_band(float2 q, float2 ext, float r, float2 ldir,
                                 float dist, float sigmaRef, float spreadRef, float gs) {
    float spread = spreadRef * gs;
    float2 off = -ldir * dist * gs;
    float d = g_sd_round_box(q - off, ext - spread, max(r - spread, 0.0));
    float sigma = max(sigmaRef * gs, 0.0001);
    float sIn = smoothstep(-G_K * sigma, G_K * sigma, -g_sd_round_box(q, ext, r));
    float sOut = smoothstep(-G_K * sigma, G_K * sigma, -d);
    return max(sIn - sOut, 0.0);
}

static inline float4 g_css_mix(float3 c1, float a1, float3 c2, float a2, float f) {
    float4 p1 = float4(c1 * a1, a1);
    float4 p2 = float4(c2 * a2, a2);
    float4 pm = mix(p1, p2, clamp(f, 0.0, 1.0));
    float3 rgb = pm.a > 1e-6 ? pm.rgb / pm.a : c2;
    return float4(rgb, pm.a);
}

static inline float2 g_halo_offset(float2 ldir, float2 halfExt) {
    return (ldir - float2(0.0, -1.0)) * halfExt;
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
    for (int i = 0; i < 4; ++i) {
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
    float rimAmtV, haloBlurV, haloSizeV, washAmtV, footHeightV;
    float2 ldir;
    float inten;
    half4 bgColor, rimColor, haloColor, haloMidColor, washTop, washMid, footColor;
};

static inline float3 mfSrc(float2 cuv, thread const MFSrcArgs& P) {
    float2 q = (cuv - 0.5) * 2.0 * P.halfExt;

    float3 cardCol = float3(P.bgColor.rgb);

    float2 hext = G_HALO_EXT * P.gs * max(P.haloSizeV, 0.0001);
    float2 hp = q - (G_HALO_CTR * P.gs + g_halo_offset(P.ldir, P.halfExt));
    float2 hs = hp / max(hext, float2(0.0001));
    float t2 = dot(hs, hs);

    float2 hk = (P.haloBlurV * P.gs) / max(hext, float2(0.0001));
    float2 hk2 = hk * hk;
    float hq = 0.5 * (hk2.x + hk2.y);
    float he = G_HALO_BLEND * hq;
    float hInv = 1.0 / max(t2 + he, 1e-8);
    float hMix = he * hInv;

    float sr2 = (hk2.x * hs.x * hs.x + hk2.y * hs.y * hs.y + hq * he) * hInv;
    float st2 = 2.0 * hq - sr2;

    float te = sqrt(t2 + mix(G_HALO_FAR, G_HALO_NEAR, hMix) * st2);
    float hw = G_K * sqrt(sr2);
    float aHaloRamp = 1.0
                    + G_HALO_M0 * te
                    + (G_HALO_M1 - G_HALO_M0) * g_soft_ramp(te - G_HALO_S1, hw)
                    - G_HALO_M1 * g_soft_ramp(te - G_HALO_S2, hw);
    aHaloRamp = max(aHaloRamp, 0.0);

    float wExcess = g_soft_ramp(G_HALO_S1 - te, hw) / G_HALO_S1;
    float3 haloMid = float3(P.haloMidColor.rgb);
    float3 haloPre = haloMid * aHaloRamp + (float3(P.haloColor.rgb) - haloMid) * wExcess;
    float3 haloRGB = aHaloRamp > 1e-6 ? haloPre / aHaloRamp : haloMid;
    cardCol = g_over(cardCol, haloRGB, aHaloRamp * P.inten);

    float tw = clamp(cuv.y, 0.0, 1.0);
    float4 wash;
    if (tw < G_WASH_S1) {
        wash = g_css_mix(float3(P.washTop.rgb), G_WASH_A0,
                         float3(P.washMid.rgb), G_WASH_A1, tw / G_WASH_S1);
    } else {
        wash = g_css_mix(float3(P.washMid.rgb), G_WASH_A1,
                         float3(P.washMid.rgb), 0.0,
                         (tw - G_WASH_S1) / (G_WASH_S2 - G_WASH_S1));
    }
    cardCol = g_over(cardCol, wash.rgb, wash.a * P.washAmtV * P.inten);

    float s = clamp((cuv.y - (1.0 - P.footHeightV)) / max(P.footHeightV, 0.0001), 0.0, 1.0);
    cardCol = g_over(cardCol, float3(P.footColor.rgb), min(s / G_FOOT_MID, 1.0));

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

[[ stitchable ]] half4 chrome(float2 position,
                                 half4 color,
                                 float4 boundingRect,
                                 float time,
                                 float radius,
                                 float rimAmt,
                                 float haloBlur,
                                 float haloSize,
                                 float washAmt,
                                 float footHeight,
                                 float grainAmt,
                                 float intensity,
                                 float shadowAmt,
                                 float2 card,
                                 float2 light,
                                 half4 bgColor,
                                 half4 rimColor,
                                 half4 haloColor,
                                 half4 haloMidColor,
                                 half4 washTop,
                                 half4 washMid,
                                 half4 footColor,
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
    P.rimAmtV = rimAmt;
    P.haloBlurV = haloBlur; P.haloSizeV = haloSize;
    P.washAmtV = washAmt; P.footHeightV = footHeight;

    P.ldir = (light - 0.5f) * 2.0f;
    P.inten = max(0.0f, intensity);

    P.bgColor = bgColor; P.rimColor = rimColor;
    P.haloColor = haloColor; P.haloMidColor = haloMidColor;
    P.washTop = washTop; P.washMid = washMid; P.footColor = footColor;

    float2 q = p - 0.5 * res;
    float3 col = G_CANVAS;

    col = mfs_card_shadow(col, q, P.halfExt, P.r, P.gs, -P.ldir, shadowAmt, P.inten,
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

    float aRim = g_inset_band(q, P.halfExt, P.r, P.ldir,
                              G_RIM_DIST, G_RIM_SIGMA, G_RIM_SPREAD, P.gs)
                 * rimAmt * P.inten;
    col = g_over(col, float3(rimColor.rgb), aRim);

    float dth = (fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    return half4(half3(clamp(col + dth, 0.0, 1.0)), 1.0h);
}
