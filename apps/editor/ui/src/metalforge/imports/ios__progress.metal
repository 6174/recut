#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>

using namespace metal;

struct MFPArgs {
    float style, progress, alive, warp;
    float scale, amount, lag, echo, bloom, jitter, grain;
    float frontIn, frontOut, feather, churn, ripple, falloff, trails, trailGlow;
    float haze, vignette, pulse, pulseRate, stagger, cellSize, fill, density;
    float turbulence, sparkle;
    float3 background, color1, color2, color3, color4, color5, color6, color7;
};

static float mfp_h21(float2 p0) {
    float2 p = fract(p0 * float2(123.34, 345.45));
    p += float2(dot(p, p + float2(34.345, 34.345)));
    return fract(p.x * p.y);
}

static float mfp_vn(float2 p0) {
    float2 i = floor(p0);
    float2 f = fract(p0);
    float2 w = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mfp_h21(i), mfp_h21(i + float2(1.0, 0.0)), w.x),
        mix(mfp_h21(i + float2(0.0, 1.0)), mfp_h21(i + float2(1.0, 1.0)), w.x),
        w.y);
}

static float mfp_fbm(float2 p0) {
    float v = 0.0;
    float a = 0.5;
    float2 p = p0;
    for (int i = 0; i < 4; i++) {
        v += a * mfp_vn(p);
        p = p * 2.03 + float2(11.7, 11.7);
        a *= 0.5;
    }
    return v;
}

static float mfp_mod(float x, float y) {
    return x - y * floor(x / y);
}

static float mfp_sstep(float e0, float e1, float x) {
    float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

static float mfp_wave(int sid, float y, float tt, float amp, MFPArgs a) {
    if (sid == 1) {
        float slosh = sin(y * 3.0 * a.ripple + tt * 0.50 * a.churn) * 0.95;
        slosh += (y - 0.5) * sin(tt * 0.38 * a.churn) * 1.30;
        return slosh * amp;
    }
    if (sid == 3) {
        float env = sin(y * 3.14159);
        float w = sin(y * 24.0 * a.ripple + tt * 1.70 * a.churn) * 0.70 + sin(y * 11.0 * a.ripple - tt * 0.95 * a.churn) * 0.45;
        return w * env * env * amp;
    }
    if (sid == 5) {
        float q = floor(y * a.scale);
        float s1 = sin(q * 2.10 * a.ripple + tt * 1.50 * a.churn);
        float s2 = sin(q * 0.90 * a.ripple - tt * 0.85 * a.churn);
        return (s1 * 0.72 + s2 * 0.34) * amp;
    }
    float w = sin(y * 19.0 * a.ripple + tt * 1.55 * a.churn) * 0.55
            + sin(y * 31.0 * a.ripple - tt * 1.05 * a.churn + 1.3) * 0.24
            + sin(y * 8.5 * a.ripple + tt * 0.62 * a.churn) * 0.46;
    w += (mfp_fbm(float2(y * 2.6 * a.ripple, tt * 0.42 * a.churn)) - 0.5) * 1.15;
    return w * amp;
}

static float3 mfp_liquid(int sid, float2 p, float2 uv, float asp, float t,
                         float uP, float uA, float2 res, MFPArgs a) {
    float amp = a.amount * uA;
    float ex = mix(a.frontIn, asp + a.frontOut, uP);
    float off = mfp_wave(sid, uv.y, t, amp, a);
    float d = p.x - (ex + off);
    float px = 1.6 * a.feather / res.y;
    float inside = 1.0 - smoothstep(-px, px, d);
    float dl = max(0.0, -d);
    float prot = clamp(off / max(amp, 0.0001) * 0.5 + 0.5, 0.0, 1.0);
    float lum = a.bloom;

    float3 col = a.color1;
    col = mix(col, a.color2, exp(-dl * 2.1 * a.falloff));
    col = mix(col, a.color3, exp(-dl * 5.2 * a.falloff) * 0.9);
    col = mix(col, a.color4, exp(-dl * 9.0 * a.falloff) * (0.72 + 0.28 * prot) * lum);
    col = mix(col, a.color5, exp(-dl * 17.0 * a.falloff) * (0.55 + 0.45 * prot) * lum);

    for (int k = 1; k < 7; k++) {
        if (k > int(a.trails + 0.5)) { break; }
        float fk = float(k);
        float ok = mfp_wave(sid, uv.y, t - fk * a.lag, amp * (1.0 + fk * 0.22), a);
        float dk = p.x - (ex + ok - fk * (a.echo + 0.030 * uA));
        col += a.color6 * exp(-abs(dk) * max(0.5, 15.0 - fk * 3.2) * a.falloff) * (0.34 / fk) * a.trailGlow;
        col += a.color7 * exp(-abs(dk) * max(0.5, 40.0 - fk * 7.0) * a.falloff) * (0.16 / fk) * lum * a.trailGlow;
    }

    float hz = mfp_fbm(float2(p.x * 1.6 - t * 0.06 * uA * a.churn, uv.y * 1.9 + t * 0.05 * uA * a.churn));
    col *= mix(1.0, 0.86 + 0.28 * hz, a.haze);
    float vig = smoothstep(0.0, 0.42, uv.y) * mfp_sstep(1.0, 0.58, uv.y);
    col *= mix(1.0, mix(0.78, 1.06, vig), a.vignette);
    return mix(a.background, col, inside);
}

static float3 mfp_hex(float2 p, float2 uv, float asp, float t, float uP, float uA, MFPArgs a) {
    float sc = a.scale;
    float2 q = float2(p.x * sc, uv.y * sc * 1.15);
    q.x += mfp_mod(floor(q.y), 2.0) * 0.5;
    float2 ci = floor(q);
    float2 cf = fract(q) - 0.5;
    float cell = max(abs(cf.x) * 1.15 + abs(cf.y) * 0.66, abs(cf.y) * 1.32);
    float body = 1.0 - smoothstep(0.46 - 0.04 * a.feather, 0.46 + 0.04 * a.feather, cell / a.cellSize);
    float inner = 1.0 - smoothstep(0.35 - 0.05 * a.feather, 0.35 + 0.05 * a.feather, cell / a.cellSize);
    float cx = (ci.x + 0.5) / sc;
    float front = mix(a.frontIn, asp + a.frontOut, uP);
    float lit = smoothstep(0.0, 0.12, front - cx - (mfp_h21(ci) - 0.5) * a.stagger);
    float puls = (1.0 - a.pulse) + a.pulse * sin(t * a.pulseRate * uA * a.churn + mfp_h21(ci) * 30.0);
    float3 col = a.background;
    col += a.color1 * body * 0.85;
    col += a.color3 * body * lit * puls;
    col += a.color2 * inner * lit * 0.45;
    return col;
}

static float3 mfp_smoke(float2 p, float2 uv, float asp, float t, float uP, float uA, MFPArgs a) {
    float front = mix(a.frontIn, asp + a.frontOut, uP);
    float2 w = float2(p.x * a.scale - t * 0.12 * uA * a.churn, uv.y * 2.00 + t * 0.05 * uA * a.churn);
    float n = mfp_fbm(w + float2(mfp_fbm(w * 1.70) * 1.60 * a.turbulence));
    float dens = mfp_sstep(0.62, 0.05, (p.x - front) * 1.40 * a.density + (0.5 - n) * 1.50 * a.turbulence);
    float3 col = a.background;
    col += a.color1 * dens;
    col += a.color2 * pow(dens, 2.20) * 0.80;
    col += a.color3 * pow(dens, 7.00) * 0.65;
    return col;
}

static float3 mfp_drops(float2 p, float2 uv, float asp, float t, float uP, float uA, MFPArgs a) {
    float front = mix(a.frontIn, asp + a.frontOut, uP);
    float grade = mfp_sstep(front + 0.34, front - 0.30, p.x);
    float g = a.scale;
    float2 cell = floor(float2(p.x, uv.y) * g);
    float2 cf = fract(float2(p.x, uv.y) * g) - 0.5;
    float rnd = mfp_h21(cell);
    float rnd2 = mfp_h21(cell + float2(13.0, 13.0));
    float jit = uA * a.jitter;
    float2 off = float2(sin(t * 4.0 * a.churn + rnd * 40.0), cos(t * 3.1 * a.churn + rnd2 * 40.0)) * jit;
    float on = step(1.0 - grade * a.fill, rnd);
    float rad = (0.16 + 0.26 * grade) * a.cellSize;
    float disc = 1.0 - mfp_sstep(rad - 0.12 * a.feather, rad + 0.04 * a.feather, length(cf - off));
    float3 col = a.background;
    col += a.color1 * grade * 0.55;
    col += mix(a.color2, a.color3, grade) * disc * on;
    return col;
}

static float3 mfp_threads(float2 p, float2 uv, float asp, float t, float uP, float uA,
                          float2 res, MFPArgs a) {
    float n = a.scale;
    float ti = floor(uv.y * n);
    float tf = fract(uv.y * n) - 0.5;
    float strand = 1.0 - smoothstep(0.18 * a.cellSize, 0.42 * a.cellSize, abs(tf));
    float len = mix(a.frontIn, asp + a.frontOut, uP)
              + (mfp_h21(float2(ti, 5.0)) - 0.5) * a.stagger
              + sin(t * 2.20 * a.churn + ti * 0.70) * 0.055 * uA;
    float d = p.x - len;
    float px = 1.6 * a.feather / res.y;
    float on = 1.0 - smoothstep(-px * 2.0, px * 2.0, d);
    float dd = max(0.0, -d);
    float3 col = a.background;
    col += a.color1 * on * strand;
    col += a.color2 * exp(-dd * 3.00 * a.falloff) * on * strand;
    col += a.color3 * exp(-dd * 14.0 * a.falloff) * on * strand;
    return col;
}

static float3 mfp_diamond(float2 p, float2 uv, float asp, float t, float uP, float uA, MFPArgs a) {
    float sc = a.scale;
    float2 q = float2((p.x + uv.y) * 0.7071, (uv.y - p.x) * 0.7071) * sc;
    float2 ci = floor(q);
    float2 cf = fract(q) - 0.5;
    float dia = abs(cf.x) + abs(cf.y);
    float cxw = (ci.x - ci.y) * 0.7071 / sc;
    float front = mix(a.frontIn, asp + a.frontOut, uP);
    float rnd = mfp_h21(ci);
    float appear = smoothstep(0.02, 0.14, front - cxw - (rnd - 0.5) * a.stagger);
    float size = mix(0.06, 0.44, appear) * a.cellSize;
    float tile = 1.0 - mfp_sstep(size - 0.05 * a.feather, size + 0.02 * a.feather, dia);
    float puls = (1.0 - a.pulse) + a.pulse * sin(t * a.pulseRate * uA * a.churn + rnd * 30.0);
    float3 col = a.background;
    col += a.color1 * mfp_sstep(front + 0.10, front - 0.20, p.x);
    float3 tint = mix(a.color2, a.color3, rnd);
    col += tint * tile * appear * puls;
    float rim = (1.0 - smoothstep(0.0, 0.06 * a.feather, abs(dia - size))) * appear;
    col += a.color4 * rim * 0.40;
    return col;
}

static float3 mfp_grain(float2 p, float2 uv, float asp, float t, float uP, float uA, MFPArgs a) {
    float front = mix(a.frontIn, asp + a.frontOut, uP);
    float grade = mfp_sstep(front + 0.30, front - 0.35, p.x);
    float g = a.scale;
    float2 cell = floor(float2(p.x, uv.y) * g);
    float rnd = mfp_h21(cell);
    float rnd2 = mfp_h21(cell + float2(9.0, 9.0));
    float flick = mfp_h21(cell + float2(floor(t * 7.0 * uA * a.churn) * 3.0));
    float on = step(1.0 - grade * a.fill, rnd * 0.85 + flick * 0.15);
    float3 tint = mix(a.color1, a.color2, rnd2);
    float3 col = a.background + tint * on * (0.30 + 0.70 * grade);
    col += a.color3 * on * step(1.0 - 0.015 * a.sparkle, rnd2) * grade * 0.85;
    return col;
}

[[ stitchable ]] half4 progressBar(float2 position,
                                   half4 color,
                                   float4 boundingRect,
                                   float time,
                                   float style,
                                   float progress,
                                   float alive,
                                   float warp,
                                   float scale,
                                   float amount,
                                   float lag,
                                   float echo,
                                   float bloom,
                                   float jitter,
                                   float grain,
                                   float frontIn,
                                   float frontOut,
                                   float feather,
                                   float churn,
                                   float ripple,
                                   float falloff,
                                   float trails,
                                   float trailGlow,
                                   float haze,
                                   float vignette,
                                   float pulse,
                                   float pulseRate,
                                   float stagger,
                                   float cellSize,
                                   float fill,
                                   float density,
                                   float turbulence,
                                   float sparkle,
                                   half4 background,
                                   half4 color1,
                                   half4 color2,
                                   half4 color3,
                                   half4 color4,
                                   half4 color5,
                                   half4 color6,
                                   half4 color7) {
    MFPArgs a;
    a.style = style; a.progress = progress; a.alive = alive; a.warp = warp;
    a.scale = scale; a.amount = amount; a.lag = lag; a.echo = echo;
    a.bloom = bloom; a.jitter = jitter; a.grain = grain;
    a.frontIn = frontIn; a.frontOut = frontOut; a.feather = feather;
    a.churn = churn; a.ripple = ripple; a.falloff = falloff;
    a.trails = trails; a.trailGlow = trailGlow; a.haze = haze;
    a.vignette = vignette; a.pulse = pulse; a.pulseRate = pulseRate;
    a.stagger = stagger; a.cellSize = cellSize; a.fill = fill;
    a.density = density; a.turbulence = turbulence; a.sparkle = sparkle;
    a.background = float3(background.rgb);
    a.color1 = float3(color1.rgb);
    a.color2 = float3(color2.rgb);
    a.color3 = float3(color3.rgb);
    a.color4 = float3(color4.rgb);
    a.color5 = float3(color5.rgb);
    a.color6 = float3(color6.rgb);
    a.color7 = float3(color7.rgb);

    float2 res = max(boundingRect.zw, float2(1.0, 1.0));
    float2 fc = floor(float2(position.x, res.y - position.y)) + float2(0.5, 0.5);
    float2 uv = fc / res;
    float asp = res.x / res.y;
    float2 p = float2(uv.x * asp, uv.y);

    float uP = clamp(progress * 0.01, 0.0, 1.0);
    float uA = clamp(alive, 0.0, 1.0);
    float t = warp;
    int sid = int(style + 0.5);

    float3 col;
    if (sid == 0) { col = mfp_hex(p, uv, asp, t, uP, uA, a); }
    else if (sid == 2) { col = mfp_smoke(p, uv, asp, t, uP, uA, a); }
    else if (sid == 4) { col = mfp_drops(p, uv, asp, t, uP, uA, a); }
    else if (sid == 6) { col = mfp_threads(p, uv, asp, t, uP, uA, res, a); }
    else if (sid == 7) { col = mfp_diamond(p, uv, asp, t, uP, uA, a); }
    else if (sid == 8) { col = mfp_grain(p, uv, asp, t, uP, uA, a); }
    else { col = mfp_liquid(sid, p, uv, asp, t, uP, uA, res, a); }

    col += float3(mfp_h21(fc) - 0.5) * a.grain;
    return half4(half3(max(col, float3(0.0))), 1.0h);
}
