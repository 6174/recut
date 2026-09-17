#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float mf_edge_d(float soft) {
    return soft - 0.005;
}

static float3 mf_edge_glow(float3 col, float2 uv, float2 ctr, float rad,
                           float soft, float glow, float3 glowRGB) {
    if (glow <= 0.0) { return col; }
    float r = length(uv - ctr);
    float e = max(soft, 0.0005);
    float outside = smoothstep(rad - e, rad + e, r);
    return col + glowRGB * (glow * exp(-max(r - rad, 0.0) * 11.0) * outside);
}

static float3 mf_ramp_pick(float idx,
                           float3 s0, float3 s1, float3 s2,  float3 s3,
                           float3 s4, float3 s5, float3 s6,  float3 s7,
                           float3 s8, float3 s9, float3 s10, float3 s11) {
    float3 r = s0;
    r = select(r, s1,  idx == 1.0);
    r = select(r, s2,  idx == 2.0);
    r = select(r, s3,  idx == 3.0);
    r = select(r, s4,  idx == 4.0);
    r = select(r, s5,  idx == 5.0);
    r = select(r, s6,  idx == 6.0);
    r = select(r, s7,  idx == 7.0);
    r = select(r, s8,  idx == 8.0);
    r = select(r, s9,  idx == 9.0);
    r = select(r, s10, idx == 10.0);
    r = select(r, s11, idx == 11.0);
    return r;
}

static float3 mf_ramp_cyc(float t, float n,
                          float3 s0, float3 s1, float3 s2,  float3 s3,
                          float3 s4, float3 s5, float3 s6,  float3 s7,
                          float3 s8, float3 s9, float3 s10, float3 s11) {
    float k  = clamp(floor(n + 0.5), 1.0, 12.0);
    float x  = fract(t) * k;
    float i0 = min(floor(x), k - 1.0);
    float i1 = select(i0 + 1.0, 0.0, i0 + 1.0 >= k);
    return mix(mf_ramp_pick(i0, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
               mf_ramp_pick(i1, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
               x - i0);
}

static float3 mf_ramp_lin(float t, float n,
                          float3 s0, float3 s1, float3 s2,  float3 s3,
                          float3 s4, float3 s5, float3 s6,  float3 s7,
                          float3 s8, float3 s9, float3 s10, float3 s11) {
    float k  = clamp(floor(n + 0.5), 1.0, 12.0);
    float x  = clamp(t, 0.0, 1.0) * (k - 1.0);
    float i0 = clamp(floor(x), 0.0, max(k - 2.0, 0.0));
    return mix(mf_ramp_pick(i0,     s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
               mf_ramp_pick(i0 + 1.0, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11),
               x - i0);
}

struct MfRamp {
    float  n;
    float3 s0, s1, s2,  s3;
    float3 s4, s5, s6,  s7;
    float3 s8, s9, s10, s11;
};

static MfRamp mf_ramp_of(float n,
                         float3 s0, float3 s1, float3 s2,  float3 s3,
                         float3 s4, float3 s5, float3 s6,  float3 s7,
                         float3 s8, float3 s9, float3 s10, float3 s11) {
    return MfRamp{ n, s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11 };
}

static float3 mf_ramp_cycR(float t, MfRamp r) {
    return mf_ramp_cyc(t, r.n, r.s0, r.s1, r.s2, r.s3, r.s4, r.s5,
                       r.s6, r.s7, r.s8, r.s9, r.s10, r.s11);
}

static float3 mf_ramp_linR(float t, MfRamp r) {
    return mf_ramp_lin(t, r.n, r.s0, r.s1, r.s2, r.s3, r.s4, r.s5,
                       r.s6, r.s7, r.s8, r.s9, r.s10, r.s11);
}

static float sf_sstep(float e0, float e1, float x) {
    float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

static float sf_hash(float3 p) {
    return fract(sin(dot(p, float3(127.1, 311.7, 74.7))) * 43758.5453);
}

static float sf_noise(float3 p) {
    float3 i = floor(p);
    float3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = sf_hash(i);
    float b = sf_hash(i + float3(1.0, 0.0, 0.0));
    float c = sf_hash(i + float3(0.0, 1.0, 0.0));
    float d = sf_hash(i + float3(1.0, 1.0, 0.0));
    float e = sf_hash(i + float3(0.0, 0.0, 1.0));
    float g = sf_hash(i + float3(1.0, 0.0, 1.0));
    float j = sf_hash(i + float3(0.0, 1.0, 1.0));
    float k = sf_hash(i + float3(1.0, 1.0, 1.0));
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
               mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

static float sf_fbm(float3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * sf_noise(p);
        p = p * 2.03 + float3(7.1, 3.7, 1.3);
        a *= 0.5;
    }
    return v;
}

static float3 sf_interf(float th, float ca, float spec) {
    float d = th * (1.0 + (1.0 - ca) * 0.9);
    float3 baseF = float3(1.0, 1.31, 1.68);
    float3 freq  = float3(1.0) + (baseF - float3(1.0)) * spec;
    return 0.5 - 0.5 * cos(6.2831 * d * freq);
}

static float3 sf_dropPt(float seed) {
    float a = fract(sin(seed * 12.9898) * 43758.5453) * 6.2831;
    float b = fract(sin(seed * 39.3468) * 24634.6345) * 1.7 - 0.85;
    float s = sqrt(max(1.0 - b * b, 0.0));
    return float3(s * cos(a), b, s * sin(a));
}

[[ stitchable ]] half4 orbStruckFilm(float2 position,
                                     half4  color,
                                     float4 boundingRect,
                                     float  time,
                                     float  speed,
                                     float  radius,
                                     float  detail,
                                     float  ripple,
                                     float  impact,
                                     float  rim,
                                     float  glow,
                                     float  exposure,
                                     float  spectrum,
                                     float  edgeSoftness,
                                     float  edgeGlow,
                                     float  paletteCount,
                                     half4  haloColor,
                                     half4  deepColor,
                                     half4  bodyColor,
                                     half4  rimColor,
                                     half4  rimTint,
                                     half4  specColor,
                                     half4  filmColor,
                                     half4  glowColor,
                                     half4  paletteStop0,
                                     half4  paletteStop1,
                                     half4  paletteStop2,
                                     half4  paletteStop3,
                                     half4  paletteStop4,
                                     half4  paletteStop5,
                                     half4  paletteStop6,
                                     half4  paletteStop7,
                                     half4  paletteStop8,
                                     half4  paletteStop9,
                                     half4  paletteStop10,
                                     half4  paletteStop11) {
    float2 size = boundingRect.zw;
    float2 fc = float2(position.x, size.y - position.y);
    float2 uv = (2.0 * fc - size) / max(min(size.x, size.y), 1.0);

    float t   = time * speed;
    float rad = max(radius, 0.05);
    float r   = length(uv);

    float3 col = float3(haloColor.rgb) * exp(-max(r - rad, 0.0) * 12.0) * 0.30 * glow;

    float  m   = sf_sstep(rad + mf_edge_d(edgeSoftness), rad - edgeSoftness, r);
    float  z   = sqrt(max(rad * rad - r * r, 0.0));
    float3 nrm = float3(uv, z) / rad;
    float  ca  = nrm.z;

    float3 o1 = float3(sin(t * 0.16) + 0.6 * sin(t * 0.071 + 1.3),
                       cos(t * 0.13) + 0.6 * cos(t * 0.062 + 0.8),
                       sin(t * 0.10 + 3.1)) * 0.5;
    float base = sf_fbm(nrm * detail + o1) * 1.5;
    float th   = base + sin(t * 0.12) * 0.3;

    float ringE = 0.0;
    for (int i = 0; i < 4; i++) {
        float  fi   = float(i);
        float  per  = 7.0 + fi * 2.3;
        float  ph   = t / per + fi * 0.41;
        float  lt   = fract(ph);
        float  seed = floor(ph) * 3.7 + fi * 11.0;
        float3 cp   = sf_dropPt(seed);
        float  d    = acos(clamp(dot(nrm, cp), -1.0, 1.0));
        float  R    = lt * 2.4;
        float  amp  = exp(-lt * 2.6) * smoothstep(0.0, 0.05, lt);
        th   += cos((d - R) * ripple) * exp(-abs(d - R) * (4.5 - 2.5 * lt)) * amp * impact;
        ringE = max(ringE, exp(-abs(d - R) * 9.0) * amp);
    }

    float  crease = clamp(fwidth(th) * 6.0, 0.0, 1.0);
    float3 film   = sf_interf(th, ca, spectrum) * float3(filmColor.rgb);
    float  fres   = pow(1.0 - ca, 2.1);
    float  glint  = pow(crease, 1.5) * (0.25 + 1.8 * fres) + ringE * 0.95;

    MfRamp pal = mf_ramp_of(paletteCount,
                            float3(paletteStop0.rgb), float3(paletteStop1.rgb),
                            float3(paletteStop2.rgb), float3(paletteStop3.rgb),
                            float3(paletteStop4.rgb), float3(paletteStop5.rgb),
                            float3(paletteStop6.rgb), float3(paletteStop7.rgb),
                            float3(paletteStop8.rgb), float3(paletteStop9.rgb),
                            float3(paletteStop10.rgb), float3(paletteStop11.rgb));

    float  bodyT = smoothstep(-0.9, 1.0, uv.x * 0.4 - uv.y * 0.5 + base * 0.5);
    float3 deep  = select(mix(float3(deepColor.rgb), float3(bodyColor.rgb), bodyT),
                          mf_ramp_linR(bodyT, pal), paletteCount > 0.5);
    float3 rimc = mix(float3(rimColor.rgb), float3(rimTint.rgb),
                      smoothstep(-0.8, 0.8, uv.x + uv.y * 0.3));

    float3 c2 = deep;
    c2 += film * glint * glow;
    c2 += film * fres * fres * 0.5 * glow;
    c2 += rimc * fres * rim;
    c2 += float3(specColor.rgb) * pow(glint * fres, 2.5) * 3.0;
    col = mix(col, c2, m);

    col = 1.0 - exp(-col * 1.8 * max(exposure, 0.0));
    float3 edged = mf_edge_glow(saturate(col), uv, float2(0.0), rad,
                                edgeSoftness, edgeGlow, float3(glowColor.rgb));
    return half4(half3(saturate(edged)), 1.0);
}
