#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

namespace hs {

constant float TAU = 6.28318530718;

static float sstep(float e0, float e1, float x) {
    float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

static float h1(float n) {
    return fract(sin(n * 127.1) * 43758.5453);
}

static float h13(float3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}

static float n3(float3 p) {
    float3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = h13(i),                   b = h13(i + float3(1, 0, 0));
    float c = h13(i + float3(0, 1, 0)), d = h13(i + float3(1, 1, 0));
    float e = h13(i + float3(0, 0, 1)), g = h13(i + float3(1, 0, 1));
    float h = h13(i + float3(0, 1, 1)), k = h13(i + float3(1, 1, 1));
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
               mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}

static float fbm(float3 p) {
    float s = 0.0, amp = 0.5;
    for (int i = 0; i < 4; i++) { s += amp * n3(p); p *= 2.03; amp *= 0.5; }
    return s;
}

static float vn1(float x) {
    float i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(h1(i), h1(i + 1.0), f);
}

static float ringNoise(float a01, float L, float seed) {
    float x = a01 * L, i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(h1(fmod(i, L) + seed), h1(fmod(i + 1.0, L) + seed), f);
}

static float3 colorize(float lum, float3 tint, float3 core) {
    float3 deep = tint * 0.16;
    float3 col = mix(deep, tint * 0.9, clamp(lum, 0.0, 1.0));
    return mix(col, mix(tint, core, 0.75),
               clamp(pow(max(lum, 0.0), 3.0) * 0.65, 0.0, 1.0));
}

static float3 tunnelTail(float3 col, float r, float3 tint, float3 core, float glow) {
    col += (tint * 0.5 + 0.5) * exp(-r * 3.5) * 1.1 * glow;
    col += core * exp(-r * 10.0) * 1.3 * glow;
    return col * (0.8 + 0.5 * sstep(1.6, 0.2, r));
}

static float3 starField(float r, float a01, float time, float stretch, float warpT,
                        float3 tint, float3 starTint, float3 core,
                        float bright, float density, float layers, float size,
                        float lengthK, float speedK, float spread, float twk, float glow) {
    float3 col = float3(0.0);
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float lw = clamp(layers - fi, 0.0, 1.0);
        float L = max(floor((120.0 + fi * 70.0) * density + 0.5), 4.0);
        float x = a01 * L + fi * 0.37 * L;
        float id = fmod(floor(x), L);
        float fa = fract(x) - 0.5;
        float rnd  = h1(id + fi * 57.7 + L * 1.3);
        float rnd2 = h1(id * 2.3 + fi * 11.7 + 5.0);
        float spd = mix(0.04, 0.22, rnd2) * (1.0 + stretch * 6.0) * speedK;
        float ph = fract(rnd + warpT * spd);
        float rr = pow(ph, 1.8) * 1.7 * spread + 0.015;
        float head = 0.004 * size;
        float len = 0.006 * size + stretch * (0.05 + rr * 1.1) * lengthK;
        float dr = r - rr;
        float radial = sstep(head, -head, dr) * sstep(-len, -len * 0.1, dr);
        float along = clamp((dr + len) / len, 0.0, 1.0);
        radial *= along * along;
        float w = (0.003 + 0.004 * rnd2) * (0.35 + r * 0.8) * size;
        float lat = abs(fa) * (TAU / L) * r;
        float lateral = sstep(w, w * 0.2, lat);
        float tw = 1.0 - 0.25 * twk + 0.25 * twk * sin(time * (1.5 + rnd * 3.0) + rnd * 40.0);
        float b = radial * lateral * tw * sstep(0.02, 0.12, r);
        float3 scol = mix(starTint, mix(tint, core, 0.6), rnd2);
        col += scol * b * (1.1 - 0.22 * fi) * bright * lw;
    }
    col += tint * exp(-r * 4.5) * stretch * glow;
    return col;
}

static float3 tunnelKessel(float r, float a, float a01, float warpT, float3 tint, float3 core,
                           float bright, float glow) {
    float z = 0.3 / (r + 0.07);
    float ca = a + z * 0.45 - warpT * 0.12;
    float3 q = float3(cos(ca), sin(ca), 0.0) * 1.1;
    q.z = z * 0.8 - warpT * 1.35;
    float n = fbm(q * 2.2);
    n += 0.5 * fbm(q * 5.0 + float3(n * 1.5));
    n *= 0.72;
    float rays = pow(ringNoise(a01, 110.0, 31.7), 3.0);
    rays *= 0.45 + 0.85 * vn1(z * 2.5 - warpT * 3.0 + rays * 9.0);
    float lum = n * n * 1.9 + rays * 0.55 * sstep(0.12, 0.5, r) * n;
    return tunnelTail(colorize(lum * bright, tint, core), r, tint, core, glow);
}

static float3 tunnelRays(float r, float a, float a01, float warpT, float3 tint, float3 core,
                         float bright, float glow) {
    float z = 0.3 / (r + 0.07);
    float wide = pow(ringNoise(a01, 64.0, 4.1), 5.0);
    wide *= 0.25 + 1.1 * vn1(z * 1.2 - warpT * 4.6 + wide * 5.0);
    float fine = pow(ringNoise(a01, 300.0, 19.7), 9.0);
    fine *= 0.3 + 1.2 * vn1(z * 2.6 - warpT * 8.5 + fine * 9.0);
    float lum = (wide * 2.6 + fine * 3.2) * sstep(0.02, 0.35, r);
    return tunnelTail(colorize(lum * bright, tint, core), r, tint, core, glow);
}

static float3 tunnelStorm(float r, float a, float a01, float warpT, float3 tint, float3 core,
                          float bright, float glow) {
    float z = 0.3 / (r + 0.07);
    float3 q = float3(cos(a), sin(a), 0.0) * 1.2;
    q.z = z * 1.1 - warpT * 2.6;

    float n = fbm(q * 2.6);
    float arc = pow(1.0 - min(abs(n - 0.5) * 3.4, 1.0), 8.0);
    float flick = 0.55 + 0.45 * vn1(warpT * 24.0 + floor(a01 * 20.0) * 3.7);

    float lum = arc * 3.2 * flick * sstep(0.02, 0.32, r) + exp(-r * 2.2) * 0.45;
    return tunnelTail(colorize(lum * bright, tint, core), r, tint, core, glow);
}

static float3 tunnelShards(float r, float a, float a01, float warpT, float3 tint, float3 core,
                           float bright, float glow) {
    float z = 0.3 / (r + 0.07);
    float lum = 0.0;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float L = 42.0 + fi * 30.0;
        float x = a01 * L + fi * 0.41 * L;
        float id = fmod(floor(x), L);
        float lat = abs(fract(x) - 0.5) * 2.0;
        float rnd = h1(id + fi * 23.1);

        float travel = fract(z * 0.45 - warpT * (1.5 + rnd * 1.2) + rnd);
        float dash = sstep(0.22, 0.02, travel) * sstep(0.0, 0.05, travel);
        float thin = sstep(0.45 + 0.3 * rnd, 0.05, lat);
        lum += dash * thin * (1.5 - 0.3 * fi);
    }
    lum = lum * 1.5 * sstep(0.03, 0.30, r) + exp(-r * 3.0) * 0.25;
    return tunnelTail(colorize(lum * bright, tint, core), r, tint, core, glow);
}

static float3 pickTunnel(int style, float r, float a, float a01, float warpT,
                         float3 tint, float3 core, float bright, float glow) {
    if (style == 1) return tunnelRays(r, a, a01, warpT, tint, core, bright, glow);
    if (style == 2) return tunnelStorm(r, a, a01, warpT, tint, core, bright, glow);
    if (style == 3) return tunnelShards(r, a, a01, warpT, tint, core, bright, glow);
    return tunnelKessel(r, a, a01, warpT, tint, core, bright, glow);
}

}

[[ stitchable ]] half4 hyperspace(float2 position,
                                  half4  color,
                                  float4 boundingRect,
                                  float  time,
                                  float  speed,
                                  float  cycle,
                                  float  tunnelTime,
                                  float  pause,
                                  float  start,
                                  float  repeats,
                                  float  stars,
                                  float  starDensity,
                                  float  starLayers,
                                  float  starSize,
                                  float  starLength,
                                  float  starSpeed,
                                  float  starSpread,
                                  float  twinkle,
                                  float  warpGlow,
                                  float  tunnelBright,
                                  float  tunnelGlow,
                                  float  exposure,
                                  float  vignette,
                                  float  style,
                                  half4  tint,
                                  half4  starTint,
                                  half4  core,
                                  half4  flare) {
    float2 size = max(boundingRect.zw, float2(1.0));

    float tunnelLen = clamp(tunnelTime, 0.0, max(cycle - 0.2, 0.0));
    float rest  = max(cycle - tunnelLen, 0.0);
    float accel = rest * 0.48;
    float fIn   = rest * 0.10;
    float fOut  = rest * 0.10;
    float decel = rest * 0.32;

    float tA = accel;
    float tB = tA + fIn;
    float tC = tB + tunnelLen;
    float tD = tC + fOut;
    float tE = tD + decel;

    float period = max(tE + pause, 0.0001);
    float clock  = time + start;
    float loops  = repeats > 0.5 ? floor(clock / period) : 0.0;
    float lt     = clock - loops * period;

    float accelDist = accel * 0.25;
    float base = accelDist + fIn + 3.2 * (tunnelLen + fOut);
    float wEnd = base + decel / 3.5;

    float warped;
    if (lt < tA) {
        float k = accel > 0.0 ? lt / accel : 1.0;
        warped = accel * pow(k, 4.0) * 0.25;
    } else if (lt < tB) {
        warped = accelDist + (lt - tA);
    } else if (lt < tD) {
        warped = accelDist + fIn + 3.2 * (lt - tB);
    } else if (lt < tE) {
        float k = decel > 0.0 ? (lt - tD) / decel : 1.0;
        warped = base + decel * (1.0 - pow(1.0 - k, 3.5)) / 3.5;
    } else {
        warped = wEnd;
    }
    float warpT = (0.10 * clock + loops * wEnd + warped) * speed;

    float fadeIn  = max(fIn * 2.0, 0.12);
    float fadeOut = max(fOut * 2.0, 0.12);
    float stretch = 0.0, flash = 0.0, tunnelMix = 0.0;
    if (lt < tA) {
        float k = accel > 0.0 ? lt / accel : 1.0;
        stretch = k * k * k;
    } else if (lt < tB) {
        stretch = 1.0;
        flash = fIn > 0.0 ? (lt - tA) / fIn : 1.0;
    } else if (lt < tC) {
        stretch = 1.0;
        tunnelMix = 1.0;
        flash = max(0.0, 1.0 - (lt - tB) / fadeIn);
    } else if (lt < tD) {
        stretch = 1.0;
        tunnelMix = 1.0;
        flash = fOut > 0.0 ? (lt - tC) / fOut : 1.0;
    } else if (lt < tE) {
        float k = decel > 0.0 ? (lt - tD) / decel : 1.0;
        stretch = pow(1.0 - k, 2.5);
        flash = max(0.0, 1.0 - (lt - tD) / fadeOut);
    }

    float3 tintC  = float3(tint.rgb);
    float3 starC  = float3(starTint.rgb);
    float3 coreC  = float3(core.rgb);
    float3 flashC = float3(flare.rgb) * float3(1.03, 1.03, 1.06);

    float2 p = (2.0 * position - size) / size.y;
    p += float2(sin(clock * 43.7), cos(clock * 37.3)) * 0.006 * (stretch * 0.7 + tunnelMix * 0.35);

    float r = length(p);
    float a = atan2(p.y, p.x);
    float a01 = a / hs::TAU + 0.5;

    float3 sc = hs::starField(r, a01, clock, stretch, warpT, tintC, starC, coreC,
                              stars, starDensity, starLayers, starSize, starLength,
                              starSpeed, starSpread, twinkle, warpGlow);

    float3 tc = float3(0.0);
    if (tunnelMix > 0.0) {
        tc = hs::pickTunnel(int(style + 0.5), r, a, a01, warpT, tintC, coreC,
                            tunnelBright, tunnelGlow);
    }

    float3 col = mix(sc, tc, tunnelMix) + sc * tunnelMix * 0.22;
    col *= 1.0 - vignette * hs::sstep(0.85, 1.5, r);
    col = mix(col, flashC, clamp(flash, 0.0, 1.0));
    col = 1.0 - exp(-col * exposure);
    col = pow(max(col, float3(0.0)), float3(0.85));
    return half4(half3(col), color.a);
}
