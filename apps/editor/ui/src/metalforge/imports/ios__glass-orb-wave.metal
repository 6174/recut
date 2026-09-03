#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

static float2 sphIntersect(float3 ro, float3 rd, float rad) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - rad * rad;
    float h = b * b - c;
    if (h < 0.0) return float2(-1.0);
    h = sqrt(h);
    return float2(-b - h, -b + h);
}

static float waveDisp(float3 p, float t, float fr, float amp) {
    float3 q = normalize(p) * 3.5;
    float u = q.x * 0.85 + q.y * 0.50 + q.z * 0.20;
    u += 0.32 * sin(q.y * 1.0 + t * 0.30);
    u += 0.22 * sin(q.z * 1.3 - t * 0.35);
    u += 0.14 * sin(q.y * 1.9 + q.z * 1.6 + t * 0.25);
    float v = q.z * 0.70 + q.x * 0.55 + q.y * 0.45;
    v += 0.30 * sin(q.x * 1.2 - t * 0.32);
    v += 0.20 * sin(q.y * 1.5 + t * 0.45);
    v += 0.14 * sin(q.z * 1.9 + q.x * 1.6 + t * 0.28);
    float disp = 0.042 * sin(u * 7.0 * fr) + 0.034 * sin(v * 6.5 * fr);
    return disp * amp;
}

static float mapScene(float3 p, float t, float fr, float amp) {
    return length(p) - 1.0 - waveDisp(p, t, fr, amp);
}

static float3 calcNormal(float3 p, float t, float e, float fr, float amp) {
    float2 k = float2(1.0, -1.0);
    return normalize(
        k.xyy * mapScene(p + k.xyy * e, t, fr, amp) +
        k.yyx * mapScene(p + k.yyx * e, t, fr, amp) +
        k.yxy * mapScene(p + k.yxy * e, t, fr, amp) +
        k.xxx * mapScene(p + k.xxx * e, t, fr, amp)
    );
}

[[ stitchable ]] half4 glassOrbWave(float2 position,
                                    half4  color,
                                    float4 boundingRect,
                                    float  time,
                                    float  speed,
                                    float  waveFreq,
                                    float  amplitude,
                                    half4  tint,
                                    half4  depth,
                                    half4  highlight) {
    float2 size = boundingRect.zw;
    float2 uv = (position - 0.5 * size) / min(size.x, size.y);
    uv *= 2.0;

    float fr  = waveFreq;
    float amp = amplitude;
    float t   = time * speed;

    float3 ro = float3(0.0, 0.0, 3.0);
    float3 rd = normalize(float3(uv, -1.8));

    const float baseAmpSum = 0.076;
    float boundRad = 1.0 + baseAmpSum * amp + 0.04;
    float LIP = 2.0 * max(1.0, fr) * max(1.0, amp);

    float2 hh = sphIntersect(ro, rd, boundRad);
    if (hh.x < 0.0) return half4(0.0h, 0.0h, 0.0h, 1.0h);

    float tHit = max(hh.x - 0.02, 0.0);
    float tMax = hh.y + 0.02;
    bool  hit  = false;
    float3 pHit = float3(0.0);
    for (int i = 0; i < 96; i++) {
        float3 p = ro + rd * tHit;
        float d = mapScene(p, t, fr, amp) / LIP;
        if (d < 0.0004) { hit = true; pHit = p; break; }
        tHit += d * 0.85;
        if (tHit > tMax) break;
    }
    if (!hit) return half4(0.0h, 0.0h, 0.0h, 1.0h);

    float chord = hh.y - hh.x;
    float graze = saturate(1.0 - chord / (2.5 * boundRad));
    float nEps  = mix(0.0015, 0.0070, graze);
    float3 n    = calcNormal(pHit, t, nEps, fr, amp);
    float3 v    = -rd;
    float ndv   = saturate(dot(n, v));

    float3 L1 = normalize(float3(-0.55, 0.85, 0.55));
    float3 L2 = normalize(float3( 0.40, 0.30, 0.80));
    float3 baseTint   = float3(tint.rgb) * 2.0;
    float3 absorption = 4.5 * (1.0 - float3(depth.rgb));

    float3 rIn  = refract(rd, n, 1.0 / 1.45);
    float  tBack = 0.01;
    float3 pBack = pHit + rIn * tBack;
    for (int i = 0; i < 32; i++) {
        pBack = pHit + rIn * tBack;
        float d = mapScene(pBack, t, fr, amp);
        if (d > -0.0008) break;
        tBack += (-d) / LIP * 0.85;
        if (tBack > 3.5) break;
    }
    float3 transmit = exp(-absorption * tBack);

    float3 nBack = calcNormal(pBack, t, nEps, fr, amp);
    float  bDiff = (dot(nBack, L1) * 0.5 + 0.5) * 0.65
                 + (dot(nBack, L2) * 0.5 + 0.5) * 0.40;
    float3 interior = baseTint * (0.20 + bDiff) * transmit;

    float fres = pow(1.0 - ndv, 3.5);
    interior += baseTint * fres * 0.55;

    float exp1 = mix(380.0, 90.0, graze);
    float exp2 = mix(240.0, 60.0, graze);
    float3 H1 = normalize(L1 + v);
    float3 H2 = normalize(L2 + v);
    float spec1 = pow(saturate(dot(n, H1)), exp1);
    float spec2 = pow(saturate(dot(n, H2)), exp2);
    float gloss = pow(saturate(dot(n, H1)), 40.0) * 0.10;

    float3 hl = float3(highlight.rgb);
    float3 col = interior;
    col += hl * spec1 * 6.5;
    col += hl * spec2 * 3.0;
    col += hl * gloss;

    col = col / (1.0 + col * 0.65);
    return half4(half3(col), 1.0h);
}
