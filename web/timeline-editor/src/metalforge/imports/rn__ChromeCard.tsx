import React from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float radius = 40.0;
const float rimAmt = 0.5;
const float haloBlur = 34.0;
const float haloSize = 1.0;
const float washAmt = 1.0;
const float footHeight = 0.56;
const float grainAmt = 0.2;
const float intensity = 1.0;
const float shadowAmt = 0.1;
const float2 card = float2(0.86, 0.52);
const float2 light = float2(0.5, 0.0);
const half4 bgColor = half4(0.0, 0.0, 0.0, 1.0);
const half4 rimColor = half4(1.0, 1.0, 1.0, 1.0);
const half4 haloColor = half4(1.0, 1.0, 1.0, 1.0);
const half4 haloMidColor = half4(0.839216, 0.886275, 0.94902, 1.0);
const half4 washTop = half4(0.768627, 0.831373, 0.921569, 1.0);
const half4 washMid = half4(0.470588, 0.533333, 0.627451, 1.0);
const half4 footColor = half4(0.0, 0.0, 0.0, 1.0);
const half4 shadowColor = half4(0.823529, 0.882353, 1.0, 1.0);
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

const float G_REF_X = 160.0;
const float G_REF_Y = 210.0;

const float G_K = 2.104;

const float3 G_CANVAS = float3(0.02745098, 0.02745098, 0.04313725);

const float G_RIM_DIST = 1.0;
const float G_RIM_SIGMA = 0.5;
const float G_RIM_SPREAD = 0.0;

const float2 G_HALO_EXT = float2(230.4, 130.2);
const float2 G_HALO_CTR = float2(0.0, -205.8);
const float G_HALO_S1 = 0.44;
const float G_HALO_S2 = 0.76;
const float G_HALO_A1 = 0.60;
const float G_HALO_M0 = -(1.0 - G_HALO_A1) / G_HALO_S1;
const float G_HALO_M1 = -G_HALO_A1 / (G_HALO_S2 - G_HALO_S1);
const float G_HALO_NEAR = 1.45;
const float G_HALO_FAR = 0.85;
const float G_HALO_BLEND = 2.0;

const float G_WASH_S1 = 0.22;
const float G_WASH_S2 = 0.48;
const float G_WASH_A0 = 0.30;
const float G_WASH_A1 = 0.12;

const float G_FOOT_MID = 0.62;

const float G_BF = 0.75;
const float G_GAIN = 0.26;
const float G_SEED = 17.0;

float2 g_card_frame(float2 res) {
    return float2(393.0, 851.0) * max(min(res.x / 393.0, res.y / 851.0), 0.0001);
}

float g_sd_round_box(float2 p, float2 ext, float r) {
    float2 q = abs(p) - ext + float2(r);
    return length(max(q, float2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

float g_soft_ramp(float x, float a) {
    float aa = max(a, 1e-6);
    float u = clamp((x + aa) / (2.0 * aa), 0.0, 1.0);
    return 2.0 * aa * (u * u * u - 0.5 * u * u * u * u) + max(x - aa, 0.0);
}

float g_inset_band(float2 q, float2 ext, float r, float2 ldir,
                   float dist, float sigmaRef, float spreadRef, float gs) {
    float spread = spreadRef * gs;
    float2 off = -ldir * dist * gs;
    float d = g_sd_round_box(q - off, ext - float2(spread), max(r - spread, 0.0));
    float sigma = max(sigmaRef * gs, 0.0001);
    float sIn = smoothstep(-G_K * sigma, G_K * sigma, -g_sd_round_box(q, ext, r));
    float sOut = smoothstep(-G_K * sigma, G_K * sigma, -d);
    return max(sIn - sOut, 0.0);
}

float4 g_css_mix(float3 c1, float a1, float3 c2, float a2, float f) {
    float4 p1 = float4(c1 * a1, a1);
    float4 p2 = float4(c2 * a2, a2);
    float4 pm = mix(p1, p2, clamp(f, 0.0, 1.0));
    float3 rgb = pm.a > 1e-6 ? pm.rgb / pm.a : c2;
    return float4(rgb, pm.a);
}

float2 g_halo_offset(float2 ldir, float2 halfExt) {
    return (ldir - float2(0.0, -1.0)) * halfExt;
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
    for (int i = 0; i < 4; i++) {
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
    return base < 0.5 ? 2.0 * base * blend
                      : 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
}

float3 g_over(float3 dst, float3 src, float a) {
    return mix(dst, src, clamp(a, 0.0, 1.0));
}

float3 mfSrc(float2 cuv) {
    float2 res = uResolution;

    float2 frame = g_card_frame(res);
    float2 halfExt = 0.5 * clamp(card, float2(0.02), float2(1.0)) * frame;
    float2 q = (cuv - float2(0.5)) * 2.0 * halfExt;

    float gs = max(min(halfExt.x / G_REF_X, halfExt.y / G_REF_Y), 0.0001);

    float2 ldir = (light - 0.5) * 2.0;
    float inten = max(0.0, intensity);

    float3 cardCol = float3(bgColor.rgb);

    float2 hext = G_HALO_EXT * gs * max(haloSize, 0.0001);
    float2 hp = q - (G_HALO_CTR * gs + g_halo_offset(ldir, halfExt));
    float2 hs = hp / max(hext, float2(0.0001));
    float t2 = dot(hs, hs);

    float2 hk = (haloBlur * gs) / max(hext, float2(0.0001));
    float2 hk2 = hk * hk;
    float hq = 0.5 * (hk2.x + hk2.y);
    float he = G_HALO_BLEND * hq;
    float hInv = 1.0 / max(t2 + he, 1e-8);
    float hMix = he * hInv;

    float sr2 = (hk2.x * hs.x * hs.x + hk2.y * hs.y * hs.y + hq * he) * hInv;
    float st2 = 2.0 * hq - sr2;

    float te = sqrt(t2 + mix(G_HALO_FAR, G_HALO_NEAR, hMix) * st2);
    float hw = G_K * sqrt(sr2);
    float aHaloRamp = max(1.0
                          + G_HALO_M0 * te
                          + (G_HALO_M1 - G_HALO_M0) * g_soft_ramp(te - G_HALO_S1, hw)
                          - G_HALO_M1 * g_soft_ramp(te - G_HALO_S2, hw), 0.0);

    float wExcess = g_soft_ramp(G_HALO_S1 - te, hw) / G_HALO_S1;
    float3 haloMid = float3(haloMidColor.rgb);
    float3 haloPre = haloMid * aHaloRamp + (float3(haloColor.rgb) - haloMid) * wExcess;
    float3 haloRGB = aHaloRamp > 1e-6 ? haloPre / aHaloRamp : haloMid;
    cardCol = g_over(cardCol, haloRGB, aHaloRamp * inten);

    float tw = clamp(cuv.y, 0.0, 1.0);
    float4 wash;
    if (tw < G_WASH_S1) {
        wash = g_css_mix(float3(washTop.rgb), G_WASH_A0,
                         float3(washMid.rgb), G_WASH_A1, tw / G_WASH_S1);
    } else {
        wash = g_css_mix(float3(washMid.rgb), G_WASH_A1,
                         float3(washMid.rgb), 0.0,
                         (tw - G_WASH_S1) / (G_WASH_S2 - G_WASH_S1));
    }
    cardCol = g_over(cardCol, wash.rgb, wash.a * washAmt * inten);

    float s = clamp((cuv.y - (1.0 - footHeight)) / max(footHeight, 0.0001), 0.0, 1.0);
    cardCol = g_over(cardCol, float3(footColor.rgb), min(s / G_FOOT_MID, 1.0));

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
    float2 halfExt = 0.5 * clamp(card, float2(0.02), float2(1.0)) * frame;
    float2 q = p - 0.5 * res;
    float gs = max(min(halfExt.x / G_REF_X, halfExt.y / G_REF_Y), 0.0001);

    float r = clamp(radius * gs, 0.0, min(halfExt.x, halfExt.y));

    float3 col = G_CANVAS;

    float2 ldirC = (light - 0.5) * 2.0;
    col = mfs_card_shadow(col, q, halfExt, r, gs, -ldirC, shadowAmt,
                          max(0.0, intensity), float3(shadowColor.rgb));

    float2 cres = 2.0 * halfExt;
    float2 cuv = (q + halfExt) / max(cres, float2(1.0));
    float3 cardCol = mfFilter(cuv, cres, filter, frame.x / 393.0,
                              fAmount, fScale, fBlur, fFade, fSoft, fAngle, fGrain, fBrightness, fContrast, fSaturation, fRound, fBevel, fInset);

    if (grainAmt > 0.0) {
        float2 np = q / gs * G_BF;
        float nr = g_linear_to_srgb(g_fractal(np, 0.0));
        float ng = g_linear_to_srgb(g_fractal(np, 101.0));
        float nb = g_linear_to_srgb(g_fractal(np, 211.0));
        float na = g_fractal(np, 307.0);
        float3 mixed = float3(g_overlay(cardCol.r, nr),
                              g_overlay(cardCol.g, ng),
                              g_overlay(cardCol.b, nb));
        cardCol = mix(cardCol, mixed, clamp(grainAmt * na, 0.0, 1.0));
    }

    float dCard = g_sd_round_box(q, halfExt, r);
    col = g_over(col, cardCol, 1.0 - smoothstep(-1.0, 1.0, dCard));

    float aRim = g_inset_band(q, halfExt, r, ldirC,
                              G_RIM_DIST, G_RIM_SIGMA, G_RIM_SPREAD, gs)
                 * rimAmt * max(0.0, intensity);
    col = g_over(col, float3(rimColor.rgb), aRim);

    float dth = (fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    return half4(half3(clamp(col + float3(dth), float3(0.0), float3(1.0))), 1.0);
}
`)!;

const CARD = { width: 0.86, height: 0.52 };

function statCardRect(w: number, h: number) {
    const s = Math.max(Math.min(w / 393, h / 851), 0.0001);
    const cw = Math.min(Math.max(CARD.width, 0.02), 1) * 393 * s;
    const ch = Math.min(Math.max(CARD.height, 0.02), 1) * 851 * s;
    const gs = Math.max(Math.min(cw / 320, ch / 420), 0.0001);
    return { left: (w - cw) / 2, top: (h - ch) / 2, width: cw, height: ch, gs };
}

const styles = StyleSheet.create({
    card: { position: "absolute", alignItems: "flex-start", justifyContent: "flex-end" },
    pill: {
        flexDirection: "row",
        alignItems: "center",
        borderColor: "rgba(255, 255, 255, 0.28)",
        borderRadius: 9999,
    },
    pillText: { color: "#ffffff", fontWeight: "500" },
    value: { color: "#ffffff", fontWeight: "500" },
    caption: { color: "rgba(255, 255, 255, 0.85)", fontWeight: "400" },
});

export type ChromeCardProps = {
    badge?: string;
    value?: string;
    caption?: string;
    showsContent?: boolean;
};

export default function ChromeCard({
    badge = "+312 bps",
    value = "400%",
    caption = "Conversion rate",
    showsContent = true,
}: ChromeCardProps) {
    const { width, height } = useWindowDimensions();
    const clock = useClock();
    const uniforms = useDerivedValue(() => ({
        uResolution: [width, height],
        uTime: clock.value / 1000,
    }));
    const card = statCardRect(width, height);

    return (
        <View style={{ flex: 1 }}>
            <Canvas style={StyleSheet.absoluteFill}>
                <Fill>
                    <Shader source={SOURCE} uniforms={uniforms} />
                </Fill>
            </Canvas>
            {showsContent && (
                <View
                    pointerEvents="none"
                    style={[styles.card, {
                        left: card.left,
                        top: card.top,
                        width: card.width,
                        height: card.height,
                        paddingHorizontal: 36.0 * card.gs,
                        paddingBottom: 24.0 * card.gs,
                    }]}
                >
                    <View style={[styles.pill, {
                        height: 30.0 * card.gs,
                        paddingHorizontal: 14.0 * card.gs,
                        borderWidth: Math.max(1.0 * card.gs, 1),
                        marginBottom: 16.0 * card.gs,
                    }]}>
                        <Text style={[styles.pillText, {
                            fontSize: 13.0 * card.gs,
                            marginRight: 6.0 * card.gs,
                            opacity: 0.9,
                        }]}>↗</Text>
                        <Text style={[styles.pillText, { fontSize: 13.0 * card.gs }]}>{badge}</Text>
                    </View>
                    <Text style={[styles.value, {
                        fontSize: 66.0 * card.gs,
                        lineHeight: 72.6 * card.gs,
                        letterSpacing: -1.32 * card.gs,
                        marginBottom: 6.0 * card.gs,
                    }]}>{value}</Text>
                    <Text style={[styles.caption, { fontSize: 15.0 * card.gs }]}>{caption}</Text>
                </View>
            )}
        </View>
    );
}
