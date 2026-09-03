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

static float ob_sstep(float e0, float e1, float x) {
    float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

static float3 ob_refract(float3 i, float3 n, float eta) {
    float d = dot(n, i);
    float k = 1.0 - eta * eta * (1.0 - d * d);
    if (k < 0.0) return float3(0.0);
    return eta * i - (eta * d + sqrt(k)) * n;
}

static float ob_hash(float3 p) {
    return fract(sin(dot(p, float3(127.1, 311.7, 74.7))) * 43758.5453);
}

static float ob_noise(float3 p) {
    float3 i = floor(p);
    float3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = ob_hash(i);
    float b = ob_hash(i + float3(1.0, 0.0, 0.0));
    float c = ob_hash(i + float3(0.0, 1.0, 0.0));
    float d = ob_hash(i + float3(1.0, 1.0, 0.0));
    float e = ob_hash(i + float3(0.0, 0.0, 1.0));
    float g = ob_hash(i + float3(1.0, 0.0, 1.0));
    float j = ob_hash(i + float3(0.0, 1.0, 1.0));
    float k = ob_hash(i + float3(1.0, 1.0, 1.0));
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
               mix(mix(e, g, f.x), mix(j, k, f.x), f.y), f.z);
}

static float ob_fbm(float3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * ob_noise(p);
        p = p * 2.03 + float3(7.1, 3.7, 1.3);
        a *= 0.5;
    }
    return v;
}

static float3 ob_rotY(float3 p, float a) {
    float c = cos(a), s = sin(a);
    return float3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

static float3 ob_rotX(float3 p, float a) {
    float c = cos(a), s = sin(a);
    return float3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

static float3 ob_aces(float3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

static float ob_sphExit(float3 p, float3 d) {
    float b = dot(p, d);
    return -b + sqrt(max(1.0 - dot(p, p) + b * b, 0.0));
}

static float3 ob_knead(float t, float a, float b, float c, float ph) {
    return float3(sin(t * a) + 0.55 * sin(t * a * 0.41 + ph),
                  cos(t * b) + 0.55 * cos(t * b * 0.37 + ph * 1.7),
                  sin(t * c + ph * 2.3));
}

static float ob_schlick(float ct, float f0) {
    return f0 + (1.0 - f0) * pow(max(1.0 - ct, 0.0), 5.0);
}

static float3 ob_studioBG(float2 p, float3 wallA, float3 wallB,
                          float3 lampA, float3 lampB,
                          MfRamp pal) {
    float  ws   = smoothstep(-0.55, 1.25, p.y);
    float3 wall = select(mix(wallA * 0.0112, wallB * 0.0027, ws),
                         mf_ramp_linR(ws, pal) * mix(0.0112, 0.0027, ws),
                         pal.n > 0.5);
    float2 s1 = (p - float2(-0.80, 0.74)) * float2(1.00, 1.65);
    wall += lampA * 0.0270 * exp(-dot(s1, s1) * 1.30);
    float2 s2 = (p - float2(0.94, 0.14)) * float2(1.30, 2.05);
    wall += lampB * 0.0135 * exp(-dot(s2, s2) * 1.85);
    return wall;
}

static float3 ob_bgThrough(float2 uv, float3 N, float3 wallA, float3 wallB,
                           float3 lampA, float3 lampB,
                           MfRamp pal) {
    float3 d1 = ob_refract(float3(0.0, 0.0, -1.0), N, 1.0 / 1.500);
    float3 d2 = ob_refract(float3(0.0, 0.0, -1.0), N, 1.0 / 1.524);
    float3 d3 = ob_refract(float3(0.0, 0.0, -1.0), N, 1.0 / 1.552);
    return float3(ob_studioBG(uv + d1.xy * 1.15, wallA, wallB, lampA, lampB, pal).r,
                  ob_studioBG(uv + d2.xy * 1.15, wallA, wallB, lampA, lampB, pal).g,
                  ob_studioBG(uv + d3.xy * 1.15, wallA, wallB, lampA, lampB, pal).b) * 2.6;
}

static float3 ob_glassHi(float3 N, float2 su, float z, float3 glassCol,
                         float3 specCol, float3 softboxCol, float3 lobeCol,
                         float3 limbCol) {
    float3 V = float3(0.0, 0.0, 1.0);
    float3 L1 = normalize(float3(-0.62, 0.60, 0.50));
    float3 L2 = normalize(float3(0.66, 0.16, 0.72));
    float3 H1 = normalize(L1 + V), H2 = normalize(L2 + V);
    float k = max(dot(N, H1), 0.0);
    float3 c = specCol * (pow(k, 420.0) * 2.8 + pow(k, 46.0) * 0.11);
    float2 sb = (su - float2(-0.44, 0.46)) * float2(2.0, 4.4);
    c += softboxCol * exp(-dot(sb, sb) * 2.2) * 0.26;
    c += lobeCol * pow(max(dot(N, H2), 0.0), 120.0) * 0.34;
    float e = smoothstep(0.86, 1.0, length(su));
    c += glassCol * e * pow(1.0 - z, 1.6) * 0.26;
    c += limbCol * pow(smoothstep(0.972, 1.0, length(su)), 0.75) * 0.26;
    return c;
}

static float3 ob_envMirror(float2 uv, float3 R, float keyP, float keyI,
                           float3 bounceCol, float3 wallA, float3 wallB,
                           float3 lampA, float3 lampB, float3 keyCol,
                           float3 keyMidCol, float3 keyWideCol,
                           float3 envA, float3 envB,
                           MfRamp pal) {
    float3 L1 = normalize(float3(-0.60, 0.64, 0.48));
    float3 e = ob_studioBG(uv * 0.55 + R.xy * 0.72, wallA, wallB, lampA, lampB, pal) * 7.5;
    e += keyCol * pow(max(dot(R, L1), 0.0), keyP) * keyI;
    e += keyMidCol * pow(max(dot(R, L1), 0.0), 22.0) * 0.55;
    e += keyWideCol * pow(max(dot(R, L1), 0.0), 4.0) * 0.30;
    e += mix(envA, envB, 0.5 + 0.5 * R.x) * pow(1.0 - abs(R.y), 3.0) * 0.42;
    e += bounceCol * ob_sstep(0.2, -0.9, R.y) * 0.16;
    return e;
}

static float ob_sdf(float3 p, float t, float stone, float relief, float grain) {
    float3 q = ob_rotX(ob_rotY(p, t * 0.11), 0.35 + 0.10 * sin(t * 0.09));
    return length(q) - stone
         - (ob_fbm(q * 2.4) - 0.5) * relief
         - (ob_fbm(q * 5.1) - 0.5) * grain;
}

static float3 ob_nrm(float3 p, float t, float stone, float relief, float grain) {
    float2 e = float2(0.004, 0.0);
    return normalize(float3(
        ob_sdf(p + e.xyy, t, stone, relief, grain) - ob_sdf(p - e.xyy, t, stone, relief, grain),
        ob_sdf(p + e.yxy, t, stone, relief, grain) - ob_sdf(p - e.yxy, t, stone, relief, grain),
        ob_sdf(p + e.yyx, t, stone, relief, grain) - ob_sdf(p - e.yyx, t, stone, relief, grain)));
}

[[ stitchable ]] half4 orbObsidian(float2 position,
                                   half4  color,
                                   float4 boundingRect,
                                   float  time,
                                   float  speed,
                                   float  radius,
                                   float  stone,
                                   float  relief,
                                   float  grain,
                                   float  sheen,
                                   float  glow,
                                   float  exposure,
                                   float  edgeSoftness,
                                   float  edgeGlow,
                                   float  paletteCount,
                                   float2 center,
                                   half4  tint,
                                   half4  rimColor,
                                   half4  glassColor,
                                   half4  bounceColor,
                                   half4  wallColor,
                                   half4  wallTint,
                                   half4  lampAColor,
                                   half4  lampBColor,
                                   half4  specColor,
                                   half4  softboxColor,
                                   half4  lobeColor,
                                   half4  limbColor,
                                   half4  keyColor,
                                   half4  keyMidColor,
                                   half4  keyWideColor,
                                   half4  envColor,
                                   half4  envTint,
                                   half4  ambientColor,
                                   half4  stoneSpecColor,
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

    float  t  = time * speed;
    float3 tn = float3(tint.rgb);

    MfRamp pal = mf_ramp_of(paletteCount,
                            float3(paletteStop0.rgb), float3(paletteStop1.rgb),
                            float3(paletteStop2.rgb), float3(paletteStop3.rgb),
                            float3(paletteStop4.rgb), float3(paletteStop5.rgb),
                            float3(paletteStop6.rgb), float3(paletteStop7.rgb),
                            float3(paletteStop8.rgb), float3(paletteStop9.rgb),
                            float3(paletteStop10.rgb), float3(paletteStop11.rgb));

    float3 wallA = float3(wallColor.rgb);
    float3 wallB = float3(wallTint.rgb);
    float3 lampA = float3(lampAColor.rgb);
    float3 lampB = float3(lampBColor.rgb);

    float2 su = (uv - center) / max(radius, 0.05);
    float  r  = length(su);

    float3 col = ob_studioBG(uv, wallA, wallB, lampA, lampB, pal);
    col += tn * exp(-max(r - 1.0, 0.0) * 7.0) * 0.05 * glow;

    if (r < 1.004 + mf_edge_d(edgeSoftness)) {
        float  m = ob_sstep(1.0 + mf_edge_d(edgeSoftness), 1.0 - edgeSoftness, r);
        float  z = sqrt(max(1.0 - r * r, 0.0));
        float3 N = float3(su, z);
        float  F = ob_schlick(z, 0.045);
        float3 D = ob_refract(float3(0.0, 0.0, -1.0), N, 1.0 / 1.52);
        float3 bg = ob_bgThrough(uv, N, wallA, wallB, lampA, lampB, pal);

        float3 P0 = N * 0.997;
        float  exitT = ob_sphExit(P0, D);
        float  tm = 0.012, hit = 0.0;
        float3 hp = P0;
        for (int i = 0; i < 44; i++) {
            hp = P0 + D * tm;
            float d = ob_sdf(hp, t, stone, relief, grain);
            if (d < 0.0030) { hit = 1.0; break; }
            tm += max(d * 0.55, 0.006);
            if (tm > exitT) break;
        }

        float3 inner = bg;
        if (hit > 0.5) {
            float3 Nm = ob_nrm(hp, t, stone, relief, grain);
            float3 V = -D;
            float3 R = reflect(D, Nm);
            float  fr = pow(1.0 - max(dot(Nm, V), 0.0), 3.2);
            float3 e = ob_envMirror(uv, R, 1400.0, sheen, float3(bounceColor.rgb),
                                    wallA, wallB, lampA, lampB,
                                    float3(keyColor.rgb), float3(keyMidColor.rgb),
                                    float3(keyWideColor.rgb),
                                    float3(envColor.rgb), float3(envTint.rgb), pal);
            inner = float3(ambientColor.rgb) * 0.020 + e * (0.06 + 0.60 * fr);
            inner += float3(rimColor.rgb) * fr * 0.30;
            inner += float3(stoneSpecColor.rgb) * pow(max(dot(Nm, normalize(normalize(float3(-0.60, 0.64, 0.48)) + V)), 0.0), 260.0) * 2.6;
            inner *= 0.45 + 0.55 * smoothstep(-0.85, 0.40, Nm.y);
        } else {
            inner += tn * ob_fbm(hp * 2.0 + ob_knead(t, 0.13, 0.11, 0.09, 1.9) * 0.32) * 0.05;
        }
        inner *= exp(-pow(1.0 - z, 2.0) * 0.60);

        float3 c = inner * (1.0 - F) * (0.35 + 0.65 * glow);
        c += ob_glassHi(N, su, z, float3(glassColor.rgb), float3(specColor.rgb),
                        float3(softboxColor.rgb), float3(lobeColor.rgb),
                        float3(limbColor.rgb));
        col = mix(col, c, m);
    }

    col = pow(ob_aces(col * max(exposure, 0.0)), float3(1.0 / 2.2));
    float3 edged = mf_edge_glow(saturate(col), uv, center, max(radius, 0.05),
                                edgeSoftness, edgeGlow, float3(glowColor.rgb));
    return half4(half3(saturate(edged)), 1.0);
}
