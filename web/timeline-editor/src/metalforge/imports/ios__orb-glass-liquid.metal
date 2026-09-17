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

constant float GL_TILE = 2.15053763;
constant float GL_PX   = 0.00703710;
constant float GL_FU   = 0.88172043;

constant float GL_BSIG = 0.03990000;

constant float GL_KA  = 6.0;
constant float GL_KG  = 4.1209;
constant float GL_KWA = 0.5;
constant float GL_KR  = 0.32;
constant float GL_GH  = 1.73205081;

constant float GL_EA = 0.89736760;
constant float GL_EB = 1.05263240;

static float lq_hash(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

static float lq_noise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(lq_hash(i), lq_hash(i + float2(1.0, 0.0)), f.x),
               mix(lq_hash(i + float2(0.0, 1.0)), lq_hash(i + float2(1.0, 1.0)), f.x), f.y);
}

static float2 lq_fbm(float2 p, float bs) {
    float s = 0.0, a = 0.5, m = 0.0, vr = 0.0;
    float e = -GL_KA * bs * bs;
    float g = 1.0;
    for (int i = 0; i < 5; i++) {
        float b = exp(e * g);
        s  += a * (0.5 + b * (lq_noise(p) - 0.5));
        vr += a * a * (1.0 - b * b);
        m  += a;
        a  *= 0.5;
        g  *= GL_KG;
        p = float2(0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y) * 2.03;
    }
    return float2(s / m, GL_KR * sqrt(vr) / m);
}

static float lq_ridge(float v, float k) {
    return pow(clamp(1.0 - abs(v * 2.0 - 1.0), 0.0, 1.0), k);
}

static float3 lq_ramp(float v, float3 cA, float3 cB, float3 cC, float3 cD, MfRamp pal) {
    float3 c = mix(cA, cB, smoothstep(0.0, 0.45, v));
    c = mix(c, cC, smoothstep(0.38, 0.72, v));
    c = mix(c, cD, smoothstep(0.68, 1.0, v));
    return select(c, mf_ramp_linR(v, pal), pal.n > 0.5);
}

static float lq_ridge_s(float2 vs, float k) {
    float d = GL_GH * vs.y;
    return (lq_ridge(vs.x - d, k) + 4.0 * lq_ridge(vs.x, k) + lq_ridge(vs.x + d, k)) / 6.0;
}

static float lq_step_s(float2 vs, float a, float b) {
    float d = GL_GH * vs.y;
    return (smoothstep(a, b, vs.x - d) + 4.0 * smoothstep(a, b, vs.x)
          + smoothstep(a, b, vs.x + d)) / 6.0;
}

static float lq_pow_s(float2 vs, float k) {
    float d = GL_GH * vs.y;
    return (pow(clamp(vs.x - d, 0.0, 1.0), k) + 4.0 * pow(clamp(vs.x, 0.0, 1.0), k)
          + pow(clamp(vs.x + d, 0.0, 1.0), k)) / 6.0;
}

static float3 gls_fluid(float2 fu, int md, float t,
                        float zoom, float warp, float ridgeAmt, float sharp, float shade,
                        float3 cA, float3 cB, float3 cC, float3 cD, float3 hl,
                        MfRamp pal) {
    float df = length(fu);

    float sp = GL_BSIG * zoom;
    float sw = sp * 1.1 * GL_KWA;

    float3 fcol;
    if (md < 0) {
        float2 pp = fu * zoom;
        pp.y += t * 0.05;
        float2 w = float2(lq_fbm(pp * 1.1 + float2(0.0, t * 0.09), sw).x,
                          lq_fbm(pp * 1.1 + float2(7.7, -t * 0.07), sw).x);
        float2 q = pp + warp * (w - 0.5);
        float2 body  = lq_fbm(q * 1.5 + float2(t * 0.04, 0.0), sp * 1.5);
        float  veins = lq_ridge_s(lq_fbm(q * 2.2 + float2(3.1), sp * 2.2), sharp);
        float v = mix(lq_step_s(body, 0.12, 0.88),
                      clamp(veins * 0.85 + 0.45 * body.x, 0.0, 1.0), ridgeAmt);
        fcol = lq_ramp(v, cA, cB, cC, cD, pal);
    } else {
        float2 pp = fu * zoom;
        float2 w = float2(lq_fbm(pp * 1.1 + float2(0.0, t * 0.09), sw).x,
                          lq_fbm(pp * 1.1 + float2(7.7, -t * 0.07), sw).x);
        float2 q = pp + warp * (w - 0.5);
        if (md == 0) {
            float2 n0 = lq_fbm(q * 2.2, sp * 2.2);
            float damp = exp(-18.0 * n0.y * n0.y - 24.5 * sp * sp);
            float v = 0.5 + 0.5 * damp * sin(q.x * 7.0 + n0.x * 6.0 + t * 0.35);
            v = mix(v, lq_fbm(q * 1.4 + float2(t * 0.03), sp * 1.4).x, 0.25);
            fcol = lq_ramp(v, cA, cB, cC, cD, pal);
        } else if (md == 1) {
            float v = lq_ridge_s(lq_fbm(q * 1.4 + float2(t * 0.06, 0.0), sp * 1.4), sharp)
                    * lq_ridge_s(lq_fbm(q * 1.7 - float2(0.0, t * 0.05), sp * 1.7), sharp);
            fcol = lq_ramp(pow(v, 0.7), cA, cB, cC, cD, pal);
        } else if (md == 6) {
            float2 v = lq_fbm(q * 1.3 + float2(1.5 * lq_fbm(q * 2.6 + float2(t * 0.025), sp * 2.6).x), sp * 1.3);
            float  edge = lq_ridge_s(lq_fbm(q * 2.1 + float2(7.0), sp * 2.1), 1.3);
            fcol = lq_ramp(lq_step_s(v, 0.1, 0.9), cA, cB, cC, cD, pal);
            fcol *= 1.0 - 0.18 * edge;
        } else {
            float2 q2 = q + float2(0.0, -t * 0.14);
            float2 v = lq_fbm(q2 * 1.6 + float2(2.2 * lq_fbm(q2 * 2.4 + float2(0.0, -t * 0.05), sp * 2.4).x), sp * 1.6);
            fcol = lq_ramp(lq_pow_s(v, 1.5), cA, cB, cC, cD, pal);
        }
    }

    fcol = mix(fcol, hl,
               shade * 0.3 * smoothstep(0.25, 1.25, dot(fu, float2(-0.32, 0.78))));
    fcol *= 1.0 - shade * 0.42 * smoothstep(-0.05, 1.25, dot(fu, float2(0.45, -0.62)));
    fcol *= 1.0 - shade * 0.3 * smoothstep(0.72, 1.0, df);
    return clamp(fcol, 0.0, 1.0);
}

static float gls_cdf(float sd, float sg) {
    return smoothstep(-1.88 * sg, 1.88 * sg, sd);
}

static float3 gls_over(float3 dst, float3 src, float a) {
    float k = clamp(a, 0.0, 1.0);
    return src * k + dst * (1.0 - k);
}

static float gls_spec(float2 p, float2 c, float ab, float bb, float ca, float sa,
                      float ag, float bg, float gy, float a0) {
    float2 dv = p - c;
    float  lx =  dv.x * ca + dv.y * sa;
    float  ly = -dv.x * sa + dv.y * ca;
    float  e  = sqrt((lx / ab) * (lx / ab) + (ly / bb) * (ly / bb));
    float  mask = 1.0 - smoothstep(0.98, 1.02, e);
    float  g  = sqrt((lx / ag) * (lx / ag) + ((ly - gy) / bg) * ((ly - gy) / bg));
    return a0 * clamp(1.0 - g / 0.7, 0.0, 1.0) * mask;
}

[[ stitchable ]] half4 orbGlassLiquid(float2 position,
                                      half4  color,
                                      float4 boundingRect,
                                      float  time,
                                      float  speed,
                                      float  radius,
                                      float  zoom,
                                      float  warp,
                                      float  ridgeAmt,
                                      float  sharp,
                                      float  shade,
                                      float  sheen,
                                      float  gloss,
                                      float  shellMidAlpha,
                                      float  shellEdgeAlpha,
                                      float  exposure,
                                      float  style,
                                      float  edgeSoftness,
                                      float  edgeGlow,
                                      float  paletteCount,
                                      half4  colorA,
                                      half4  colorB,
                                      half4  colorC,
                                      half4  colorD,
                                      half4  highlightColor,
                                      half4  shellInner,
                                      half4  shellMid,
                                      half4  shellEdge,
                                      half4  sheenColor,
                                      half4  specColor,
                                      half4  canvasColor,
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

    float  rad = max(radius, 0.05);

    if (length(uv) > rad * (1.01 + mf_edge_d(edgeSoftness))) {
        float3 out0 = mf_edge_glow(float3(0.0), uv, float2(0.0), rad,
                                   edgeSoftness, edgeGlow, float3(glowColor.rgb));
        return half4(half3(saturate(out0)), 1.0);
    }

    float  t   = time * speed;
    float2 p   = uv / rad;
    float  pd  = length(p);

    float2 fu = p / GL_FU;
    float  df = length(fu);

    int s  = int(style + 0.5);
    int md = -1;
    if (s == 1)                { md = 1; }
    else if (s == 3 || s == 8) { md = 7; }
    else if (s == 5)           { md = 6; }
    else if (s == 7)           { md = 0; }

    float3 cA = float3(colorA.rgb);
    float3 cB = float3(colorB.rgb);
    float3 cC = float3(colorC.rgb);
    float3 cD = float3(colorD.rgb);
    float3 hl = float3(highlightColor.rgb);

    float  fa   = 1.0 - smoothstep(GL_EA, GL_EB, df);
    float3 fcol = float3(0.0);
    if (fa > 0.0) {
        MfRamp pal = mf_ramp_of(paletteCount,
                                float3(paletteStop0.rgb), float3(paletteStop1.rgb),
                                float3(paletteStop2.rgb), float3(paletteStop3.rgb),
                                float3(paletteStop4.rgb), float3(paletteStop5.rgb),
                                float3(paletteStop6.rgb), float3(paletteStop7.rgb),
                                float3(paletteStop8.rgb), float3(paletteStop9.rgb),
                                float3(paletteStop10.rgb), float3(paletteStop11.rgb));
        fcol = gls_fluid(fu, md, t,
                         zoom, warp, ridgeAmt, sharp, shade, cA, cB, cC, cD, hl,
                         pal);
    }

    float3 col = float3(canvasColor.rgb);

    {
        float2 gc = float2(-0.2, 0.4);
        float  ge = 1.84390889;
        float  g  = clamp(length(p - gc) / ge, 0.0, 1.0);
        float  aInner = 0.70;
        float3 sInner = float3(shellInner.rgb) * aInner;
        float3 sMid   = float3(shellMid.rgb)   * shellMidAlpha;
        float3 sEdge  = float3(shellEdge.rgb)  * shellEdgeAlpha;
        float3 pm;
        float  pa;
        if (g < 0.55) {
            float f = g / 0.55;
            pm = mix(sInner, sMid, f);
            pa = mix(aInner, shellMidAlpha, f);
        } else {
            float f = (g - 0.55) / 0.45;
            pm = mix(sMid, sEdge, f);
            pa = mix(shellMidAlpha, shellEdgeAlpha, f);
        }
        col = pm + col * (1.0 - clamp(pa, 0.0, 1.0));
    }

    {
        float3 sc = float3(sheenColor.rgb);
        float a3 = 0.25 * sheen
                 * gls_cdf(length(p - float2(0.0, 20.0 * GL_PX)) - 1.0, 22.0 * GL_PX);
        col = gls_over(col, sc, a3);
        float a2 = 0.55 * sheen
                 * gls_cdf(length(p - float2(0.0, -16.0 * GL_PX)) - 1.0, 18.0 * GL_PX);
        col = gls_over(col, sc, a2);
        float a1 = 0.60 * sheen * smoothstep(1.0 - 1.5 * GL_PX, 1.0 - 0.5 * GL_PX, pd);
        col = gls_over(col, sc, a1);
    }

    {
        float lum = dot(fcol, float3(0.213, 0.715, 0.072));
        float3 sat = clamp(lum + (fcol - lum) * 1.15, 0.0, 1.0);
        col = gls_over(col, sat, 0.92 * fa);
    }

    {
        float g = pd / 1.41421356;
        float a;
        if (g < 0.58)      { a = 0.0; }
        else if (g < 0.84) { a = 0.26 * (g - 0.58) / 0.26; }
        else if (g < 0.97) { a = mix(0.26, 0.65, (g - 0.84) / 0.13); }
        else if (g < 1.0)  { a = mix(0.65, 0.20, (g - 0.97) / 0.03); }
        else               { a = 0.20; }
        col = gls_over(col, float3(specColor.rgb), a * gloss);
    }

    {
        float3 sp = float3(specColor.rgb);
        float a6 = gls_spec(p, float2(-0.11 * GL_TILE, 0.325 * GL_TILE),
                            0.23 * GL_TILE, 0.11 * GL_TILE,
                            0.95105652, 0.30901699,
                            1.41421356 * 0.23 * GL_TILE, 1.41421356 * 0.132 * GL_TILE,
                            0.022 * GL_TILE, 0.95);
        col = gls_over(col, sp, a6 * gloss);
        float a7 = gls_spec(p, float2(0.21 * GL_TILE, -0.245 * GL_TILE),
                            0.09 * GL_TILE, 0.045 * GL_TILE,
                            0.93969262, 0.34202014,
                            1.41421356 * 0.09 * GL_TILE, 1.41421356 * 0.045 * GL_TILE,
                            0.0, 0.75);
        col = gls_over(col, sp, a7 * gloss);
    }

    float ballA = 1.0 - smoothstep(0.99 - mf_edge_d(edgeSoftness), 1.01 + mf_edge_d(edgeSoftness), pd);
    col = clamp(col * max(exposure, 0.0), 0.0, 1.0) * ballA;
    float3 edged = mf_edge_glow(col, uv, float2(0.0), rad,
                                edgeSoftness, edgeGlow, float3(glowColor.rgb));
    return half4(half3(saturate(edged)), 1.0);
}
