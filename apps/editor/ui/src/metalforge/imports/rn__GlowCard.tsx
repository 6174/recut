import React from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float anim = 0.0;
const float animAmount = 0.42;
const float animShape = 0.0;
const float speed = 1.0;
const float radius = 40.0;
const float rimSize = 18.0;
const float midSize = 34.0;
const float deepSize = 74.0;
const float topSize = 6.0;
const float grainAmt = 0.15;
const float intensity = 1.0;
const float shadowAmt = 0.1;
const float2 card = float2(0.86, 0.52);
const float2 light = float2(0.5, 1.0);
const half4 bgTop = half4(0.039216, 0.035294, 0.035294, 1.0);
const half4 bgBottom = half4(0.035294, 0.062745, 0.121569, 1.0);
const half4 rimColor = half4(1.0, 1.0, 1.0, 1.0);
const half4 midColor = half4(0.411765, 0.580392, 1.0, 1.0);
const half4 deepColor = half4(0.078431, 0.298039, 0.803922, 1.0);
const half4 topColor = half4(0.137255, 0.396078, 1.0, 1.0);
const half4 shadowColor = half4(0.078431, 0.298039, 0.803922, 1.0);
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

float2 mfa_rot(float2 d, float a) {
    float c = cos(a);
    float s = sin(a);
    return float2(d.x * c - d.y * s, d.x * s + d.y * c);
}

float mfa_tri(float x) {
    return abs(fract(x) * 2.0 - 1.0) * 2.0 - 1.0;
}

float3 mfa_anim(float mode, float ph, float amt, float shp, float2 rest) {
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

const float G_B1_BLUR = 1.0;
const float G_B1_SPREAD = -0.3333333;
const float G_B2_BLUR = 0.8235294;
const float G_B2_SPREAD = -0.2352941;
const float G_B3_BLUR = 0.7567568;
const float G_B3_SPREAD = -0.3783784;
const float G_B4_BLUR = 1.0;
const float G_B4_SPREAD = -0.3333333;

const float G_A1 = 0.42;
const float G_A2 = 0.55;
const float G_A3 = 1.0;
const float G_A4 = 0.22;

const float G_BF = 0.85;
const float G_GAIN = 0.26;
const float G_SEED = 17.0;

float2 g_card_frame(float2 res) {
    return float2(393.0, 851.0) * max(min(res.x / 393.0, res.y / 851.0), 0.0001);
}

float g_sd_round_box(float2 p, float2 ext, float r) {
    float2 q = abs(p) - ext + float2(r);
    return length(max(q, float2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

float g_inset_band(float2 q, float2 ext, float r, float2 ldir,
                   float dist, float blurK, float spreadK, float gs) {
    float spread = dist * spreadK * gs;
    float2 off = -ldir * dist * gs;
    float d = g_sd_round_box(q - off, ext - float2(spread), max(r - spread, 0.0));
    float sigma = max(dist * blurK * gs * 0.5, 0.0001);
    return smoothstep(-G_K * sigma, G_K * sigma, d);
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
    for (int i = 0; i < 3; i++) {
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

    float r = clamp(radius * gs, 0.0, min(halfExt.x, halfExt.y));

    float3 an = mfa_anim(anim, uTime * speed, animAmount, animShape, light);
    float2 ldir = an.xy;
    float inten = max(0.0, intensity * an.z);

    float3 cardCol = mix(float3(bgTop.rgb), float3(bgBottom.rgb),
                         clamp((q.y + halfExt.y) / max(2.0 * halfExt.y, 0.0001), 0.0, 1.0));

    float a4 = g_inset_band(q, halfExt, r, -ldir, topSize, G_B4_BLUR, G_B4_SPREAD, gs) * G_A4 * inten;
    cardCol = g_over(cardCol, float3(topColor.rgb), a4);
    float a3 = g_inset_band(q, halfExt, r, ldir, deepSize, G_B3_BLUR, G_B3_SPREAD, gs) * G_A3 * inten;
    cardCol = g_over(cardCol, float3(deepColor.rgb), a3);
    float a2 = g_inset_band(q, halfExt, r, ldir, midSize, G_B2_BLUR, G_B2_SPREAD, gs) * G_A2 * inten;
    cardCol = g_over(cardCol, float3(midColor.rgb), a2);
    float a1 = g_inset_band(q, halfExt, r, ldir, rimSize, G_B1_BLUR, G_B1_SPREAD, gs) * G_A1 * inten;
    cardCol = g_over(cardCol, float3(rimColor.rgb), a1);

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

    float3 anC = mfa_anim(anim, uTime * speed, animAmount, animShape, light);
    col = mfs_card_shadow(col, q, halfExt, r, gs, anC.xy, shadowAmt,
                          max(0.0, intensity * anC.z), float3(shadowColor.rgb));

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

export type GlowCardProps = {
    badge?: string;
    value?: string;
    caption?: string;
    showsContent?: boolean;
};

export default function GlowCard({
    badge = "+312 bps",
    value = "400%",
    caption = "Conversion rate",
    showsContent = true,
}: GlowCardProps) {
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
