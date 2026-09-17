import React from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float radius = 26.0;
const float peak1Blur = 46.0;
const float peak1Dome = 0.78;
const float peak2Blur = 34.0;
const float peak2Dome = 0.8;
const float footHeight = 0.34;
const float grainAmt = 0.2;
const float intensity = 1.0;
const float shadowAmt = 0.1;
const float2 card = float2(0.86, 0.52);
const float2 light = float2(0.5, 1.0);
const half4 bgTop = half4(0.980392, 0.984314, 1.0, 1.0);
const half4 bgBottom = half4(0.0, 0.0, 0.0, 1.0);
const half4 bg3 = half4(0.905882, 0.933333, 1.0, 1.0);
const half4 bg4 = half4(0.615686, 0.733333, 1.0, 1.0);
const half4 bg5 = half4(0.180392, 0.360784, 1.0, 1.0);
const half4 bg6 = half4(0.039216, 0.062745, 0.188235, 1.0);
const half4 rimColor = half4(0.156863, 0.372549, 1.0, 1.0);
const half4 midColor = half4(0.0, 0.254902, 1.0, 1.0);
const half4 deepColor = half4(0.0, 0.011765, 0.058824, 1.0);
const half4 topColor = half4(0.0, 0.007843, 0.031373, 1.0);
const half4 accentColor = half4(0.0, 0.0, 0.0, 1.0);
const half4 shadowColor = half4(0.180392, 0.360784, 1.0, 1.0);
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

const float G_BG_1 = 0.20;
const float G_BG_2 = 0.38;
const float G_BG_3 = 0.56;
const float G_BG_4 = 0.76;

const float2 G_P1_EXT = float2(204.8, 117.6);
const float2 G_P1_CTR = float2(0.0, -33.6);
const float G_P1_MID = 0.55;
const float G_P1_A0 = 0.10;
const float G_P1_A1 = 0.85;
const float G_P1_PAR = 24.0;

const float2 G_P2_EXT = float2(153.6, 100.8);
const float2 G_P2_CTR = float2(0.0, 8.4);
const float G_P2_MID = 0.78;
const float G_P2_A0 = 0.40;
const float G_P2_PAR = 40.0;

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

float g_coverage(float d, float sigma) {
    float s = max(sigma, 0.0001);
    return 1.0 - smoothstep(-G_K * s, G_K * s, d);
}

float g_sd_ellipse(float2 p, float2 rad) {
    float k = length(p / max(rad, float2(0.0001)));
    return (k - 1.0) * min(rad.x, rad.y);
}

float g_sd_dome(float2 p, float2 ext, float domeFrac) {
    float ry = clamp(domeFrac, 0.0001, 1.0) * 2.0 * ext.y;
    float cy = -ext.y + ry;
    float arc = g_sd_ellipse(float2(p.x, min(p.y - cy, 0.0)), float2(ext.x, ry));
    return max(max(abs(p.x) - ext.x, p.y - ext.y), arc);
}

float4 g_css_mix(float3 c1, float a1, float3 c2, float a2, float f) {
    float4 p1 = float4(c1 * a1, a1);
    float4 p2 = float4(c2 * a2, a2);
    float4 pm = mix(p1, p2, clamp(f, 0.0, 1.0));
    float3 rgb = pm.a > 1e-6 ? pm.rgb / pm.a : c2;
    return float4(rgb, pm.a);
}

float2 g_parallax(float2 ldir, float k, float gs) {
    return (ldir - float2(0.0, 1.0)) * k * gs;
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

    float t = clamp(cuv.y, 0.0, 1.0);
    float3 cardCol;
    if (t < G_BG_1) {
        cardCol = mix(float3(bgTop.rgb), float3(bg3.rgb), t / G_BG_1);
    } else if (t < G_BG_2) {
        cardCol = mix(float3(bg3.rgb), float3(bg4.rgb), (t - G_BG_1) / (G_BG_2 - G_BG_1));
    } else if (t < G_BG_3) {
        cardCol = mix(float3(bg4.rgb), float3(bg5.rgb), (t - G_BG_2) / (G_BG_3 - G_BG_2));
    } else if (t < G_BG_4) {
        cardCol = mix(float3(bg5.rgb), float3(bg6.rgb), (t - G_BG_3) / (G_BG_4 - G_BG_3));
    } else {
        cardCol = mix(float3(bg6.rgb), float3(bgBottom.rgb), (t - G_BG_4) / (1.0 - G_BG_4));
    }

    float2 e1 = G_P1_EXT * gs;
    float2 l1 = q - G_P1_CTR * gs - g_parallax(ldir, G_P1_PAR, gs);
    float cov1 = g_coverage(g_sd_dome(l1, e1, peak1Dome), peak1Blur * gs);
    float v1 = clamp((l1.y + e1.y) / max(2.0 * e1.y, 0.0001), 0.0, 1.0);
    float4 g1;
    if (v1 < G_P1_MID) {
        g1 = g_css_mix(float3(rimColor.rgb), G_P1_A0, float3(rimColor.rgb), G_P1_A1, v1 / G_P1_MID);
    } else {
        g1 = g_css_mix(float3(rimColor.rgb), G_P1_A1, float3(deepColor.rgb), 1.0, (v1 - G_P1_MID) / (1.0 - G_P1_MID));
    }
    cardCol = g_over(cardCol, g1.rgb, g1.a * cov1 * inten);

    float2 e2 = G_P2_EXT * gs;
    float2 l2 = q - G_P2_CTR * gs - g_parallax(ldir, G_P2_PAR, gs);
    float cov2 = g_coverage(g_sd_dome(l2, e2, peak2Dome), peak2Blur * gs);
    float v2 = clamp((l2.y + e2.y) / max(2.0 * e2.y, 0.0001), 0.0, 1.0);
    float4 g2 = g_css_mix(float3(midColor.rgb), G_P2_A0, float3(topColor.rgb), 1.0, v2 / G_P2_MID);
    cardCol = g_over(cardCol, g2.rgb, g2.a * cov2 * inten);

    float s = clamp((cuv.y - (1.0 - footHeight)) / max(footHeight, 0.0001), 0.0, 1.0);
    cardCol = g_over(cardCol, float3(accentColor.rgb), min(s / G_FOOT_MID, 1.0));

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
    col = mfs_card_shadow(col, q, halfExt, r, gs, ldirC, shadowAmt,
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

export type PeaksCardProps = {
    badge?: string;
    value?: string;
    caption?: string;
    showsContent?: boolean;
};

export default function PeaksCard({
    badge = "+312 bps",
    value = "400%",
    caption = "Conversion rate",
    showsContent = true,
}: PeaksCardProps) {
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
