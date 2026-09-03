import React from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;

const float anim = 0.0;
const float radius = 42.0;
const float wave1Blur = 60.0;
const float wave2Blur = 45.0;
const float wave3Blur = 26.0;
const float intensity = 1.0;
const float shadowAmt = 0.1;
const float animSpeed = 1.0;
const float animAmount = 1.0;
const float animSpread = 1.0;
const float waveFreq = 2.0;
const float lightSway = 0.35;
const float glowPulse = 0.25;
const float2 card = float2(0.86, 0.52);
const float2 light = float2(0.5, 1.0);
const half4 wellColor = half4(0.039216, 0.039216, 0.054902, 1.0);
const half4 wave1Color = half4(1.0, 0.211765, 0.211765, 1.0);
const half4 wave2Color = half4(1.0, 0.894118, 0.211765, 1.0);
const half4 wave3Color = half4(1.0, 1.0, 1.0, 1.0);
const half4 shadowColor = half4(1.0, 0.211765, 0.211765, 1.0);
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

const float E_REF_X = 160.0;
const float E_REF_Y = 210.0;

const float E_K = 2.104;

const float3 E_CANVAS = float3(0.02745098, 0.02745098, 0.04313725);

const float E_VBW = 282.0;
const float E_VBH = 366.0;
const float E_SX = 310.0 / 282.0;
const float E_SY = 394.0 / 366.0;
const float E_RX = -14.0;
const float E_RY_BACK = -14.0;
const float E_RY_FRONT = 16.0;

const float2 E_W1_P0 = float2(-30.0, 180.0);
const float2 E_W1_C1 = float2(40.0, 152.0);
const float2 E_W1_C2 = float2(110.0, 150.0);
const float2 E_W1_P1 = float2(170.0, 182.0);
const float2 E_W1_C3 = float2(220.0, 208.0);
const float2 E_W1_C4 = float2(262.0, 222.0);
const float2 E_W1_P2 = float2(312.0, 232.0);

const float2 E_W2_P0 = float2(-30.0, 284.0);
const float2 E_W2_C1 = float2(30.0, 290.0);
const float2 E_W2_C2 = float2(80.0, 286.0);
const float2 E_W2_P1 = float2(140.0, 264.0);
const float2 E_W2_C3 = float2(200.0, 242.0);
const float2 E_W2_C4 = float2(256.0, 228.0);
const float2 E_W2_P2 = float2(312.0, 226.0);

const float2 E_W3_P0 = float2(-30.0, 295.0);
const float2 E_W3_C1 = float2(30.0, 278.0);
const float2 E_W3_C2 = float2(110.0, 278.0);
const float2 E_W3_P1 = float2(160.0, 306.0);
const float2 E_W3_C3 = float2(200.0, 328.0);
const float2 E_W3_C4 = float2(260.0, 322.0);
const float2 E_W3_P2 = float2(312.0, 314.0);

const float E_W3_ALPHA = 0.9;

const float E_W1_PAR = 20.0;
const float E_W2_PAR = 34.0;
const float E_W3_PAR = 48.0;

const float E_AW_MID = 0.62;
const float E_AW_BACK = 0.38;

const float E_AMP_WAVE = 15.0;
const float E_AMP_SWELL = 24.0;
const float E_AMP_DRIFT = 36.0;

const float E_TAU = 6.28318530718;

float2 e_card_frame(float2 res) {
    return float2(393.0, 851.0) * max(min(res.x / 393.0, res.y / 851.0), 0.0001);
}

float e_sd_round_box(float2 p, float2 ext, float r) {
    float2 q = abs(p) - ext + float2(r);
    return length(max(q, float2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

float e_coverage(float d, float sigma) {
    float s = max(sigma, 0.000001);
    return 1.0 - smoothstep(-E_K * s, E_K * s, d);
}

float e_bez1(float a, float b, float c, float d, float t) {
    float m = 1.0 - t;
    return m * m * m * a + 3.0 * m * m * t * b + 3.0 * m * t * t * c + t * t * t * d;
}

float e_seg_y(float x, float2 a, float2 b, float2 c, float2 d) {
    float lo = 0.0;
    float hi = 1.0;
    for (int i = 0; i < 16; i++) {
        float mid = 0.5 * (lo + hi);
        if (e_bez1(a.x, b.x, c.x, d.x, mid) < x) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    float t = 0.5 * (lo + hi);
    return e_bez1(a.y, b.y, c.y, d.y, t);
}

float e_wave_v(float u, float ry,
               float2 p0, float2 c1, float2 c2, float2 p1,
               float2 c3, float2 c4, float2 p2) {
    float px = clamp((u * E_VBW - E_RX) / E_SX, p0.x, p2.x);
    float py = px < p1.x ? e_seg_y(px, p0, c1, c2, p1)
                         : e_seg_y(px, p1, c3, c4, p2);
    return (ry + py * E_SY) / E_VBH;
}

float2 e_parallax(float2 ldir, float k, float gs) {
    return (ldir - float2(0.0, 1.0)) * k * gs;
}

float e_anim_t() {
    if (int(anim + 0.5) > 2) { return 0.0; }
    return uTime * max(animSpeed, 0.0);
}

int e_anim_depth(int layerIdx) {
    return 2 - layerIdx;
}

float e_anim_weight(int layerIdx) {
    int d = e_anim_depth(layerIdx);
    float w = 1.0;
    if (d == 1) { w = E_AW_MID; }
    else if (d == 2) { w = E_AW_BACK; }
    return mix(1.0, w, clamp(animSpread, 0.0, 2.0));
}

float2 e_anim_offset(int layerIdx, float uu, float tt) {
    int mode = int(anim + 0.5);
    float2 o = float2(0.0);
    if (mode <= 2) {
        float d = float(e_anim_depth(layerIdx));
        float w = e_anim_weight(layerIdx) * max(animAmount, 0.0);
        float rate = 1.0 - 0.22 * d;
        float ph = d * 0.9;
        if (mode == 0) {
            o.y = E_AMP_WAVE * w * sin(E_TAU * max(waveFreq, 0.0) * uu - tt * 1.1 * rate + ph);
        } else if (mode == 1) {
            o.y = E_AMP_SWELL * w * sin(tt * 0.75 * rate + ph);
            o.x = 0.45 * E_AMP_SWELL * w * sin(tt * 0.38 * rate + ph + 1.7);
        } else {
            o.x = E_AMP_DRIFT * w * sin(tt * 0.55 * rate + ph);
            o.y = 0.30 * E_AMP_DRIFT * w * sin(tt * 0.37 * rate + ph + 2.1);
        }
    }
    return o;
}

float2 e_light_dir() {
    float tt = e_anim_t();
    return (light - 0.5) * 2.0
         + float2(sin(tt * 0.31), sin(tt * 0.23)) * (0.5 * clamp(lightSway, 0.0, 1.0));
}

float e_intensity() {
    float tt = e_anim_t();
    float pulse = 1.0 + 0.35 * clamp(glowPulse, 0.0, 1.0) * sin(tt * 0.8);
    return max(0.0, intensity) * max(pulse, 0.0);
}

float3 e_over(float3 dst, float3 src, float a) {
    return mix(dst, src, clamp(a, 0.0, 1.0));
}

float3 mfSrc(float2 cuv) {
    float2 res = uResolution;

    float2 frame = e_card_frame(res);
    float2 halfExt = 0.5 * clamp(card, float2(0.02), float2(1.0)) * frame;
    float2 q = (cuv - float2(0.5)) * 2.0 * halfExt;

    float gs = max(min(halfExt.x / E_REF_X, halfExt.y / E_REF_Y), 0.0001);

    float2 ldir = e_light_dir();
    float inten = e_intensity();
    float tt = e_anim_t();

    float2 wellExt = halfExt;

    float2 wellRes = 2.0 * wellExt;

    float3 cardCol = float3(wellColor.rgb);

    float2 w1 = (q - e_parallax(ldir, E_W1_PAR, gs) + wellExt) / wellRes;
    float2 a1 = e_anim_offset(0, w1.x, tt) * gs / wellRes;
    float v1 = e_wave_v(w1.x + a1.x, E_RY_BACK, E_W1_P0, E_W1_C1, E_W1_C2, E_W1_P1,
                        E_W1_C3, E_W1_C4, E_W1_P2) + a1.y;
    float s1 = wave1Blur * gs / wellRes.y;
    float cov1 = e_coverage(v1 - w1.y, s1);
    cardCol = e_over(cardCol, float3(wave1Color.rgb), cov1 * inten);

    float2 w2 = (q - e_parallax(ldir, E_W2_PAR, gs) + wellExt) / wellRes;
    float2 a2 = e_anim_offset(1, w2.x, tt) * gs / wellRes;
    float v2 = e_wave_v(w2.x + a2.x, E_RY_BACK, E_W2_P0, E_W2_C1, E_W2_C2, E_W2_P1,
                        E_W2_C3, E_W2_C4, E_W2_P2) + a2.y;
    float s2 = wave2Blur * gs / wellRes.y;
    float cov2 = e_coverage(v2 - w2.y, s2);
    cardCol = e_over(cardCol, float3(wave2Color.rgb), cov2 * inten);

    float2 w3 = (q - e_parallax(ldir, E_W3_PAR, gs) + wellExt) / wellRes;
    float2 a3 = e_anim_offset(2, w3.x, tt) * gs / wellRes;
    float v3 = e_wave_v(w3.x + a3.x, E_RY_FRONT, E_W3_P0, E_W3_C1, E_W3_C2, E_W3_P1,
                        E_W3_C3, E_W3_C4, E_W3_P2) + a3.y;
    float s3 = wave3Blur * gs / wellRes.y;
    float cov3 = e_coverage(v3 - w3.y, s3);
    cardCol += float3(wave3Color.rgb) * (E_W3_ALPHA * cov3 * inten);

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
    float2 frame = e_card_frame(res);
    float2 halfExt = 0.5 * clamp(card, float2(0.02), float2(1.0)) * frame;
    float2 q = p - 0.5 * res;
    float gs = max(min(halfExt.x / E_REF_X, halfExt.y / E_REF_Y), 0.0001);

    float r = clamp(radius * gs, 0.0, min(halfExt.x, halfExt.y));

    float3 col = E_CANVAS;

    float2 ldirC = e_light_dir();
    col = mfs_card_shadow(col, q, halfExt, r, gs, ldirC, shadowAmt,
                          e_intensity(), float3(shadowColor.rgb));

    float2 cres = 2.0 * halfExt;
    float2 cuv = (q + halfExt) / max(cres, float2(1.0));
    float3 cardCol = mfFilter(cuv, cres, filter, frame.x / 393.0,
                              fAmount, fScale, fBlur, fFade, fSoft, fAngle, fGrain, fBrightness, fContrast, fSaturation, fRound, fBevel, fInset);

    float dCard = e_sd_round_box(q, halfExt, r);
    col = e_over(col, cardCol, 1.0 - smoothstep(-1.0, 1.0, dCard));

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
    card: { position: "absolute", alignItems: "flex-start", justifyContent: "flex-start" },
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

export type EmberCardProps = {
    badge?: string;
    value?: string;
    caption?: string;
    showsContent?: boolean;
};

export default function EmberCard({
    badge = "+312 bps",
    value = "400%",
    caption = "Conversion rate",
    showsContent = true,
}: EmberCardProps) {
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
                        paddingTop: 30.0 * card.gs,
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
