#include <metal_stdlib>

using namespace metal;

static inline float2 wp_hash2(float2 p) {
    p = float2(dot(p, float2(127.1, 311.7)), dot(p, float2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
}

static inline float wp_hash1(float2 p) {
    return fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
}

static inline float wp_noise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(dot(wp_hash2(i),                    f),
            dot(wp_hash2(i + float2(1.0, 0.0)), f - float2(1.0, 0.0)), u.x),
        mix(dot(wp_hash2(i + float2(0.0, 1.0)), f - float2(0.0, 1.0)),
            dot(wp_hash2(i + float2(1.0, 1.0)), f - float2(1.0, 1.0)), u.x),
        u.y);
}

static inline float wp_fbm(float2 p) {
    float a = 0.6, s = 0.0;
    for (int i = 0; i < 3; i++) { s += a * wp_noise(p); p *= 2.1; a *= 0.42; }
    return s;
}

static inline float3 wp_pal(float t, float3 c0, float3 c1, float3 c2, float3 c3, float3 c4) {
    t = clamp(t, 0.0, 1.0);
    float3 c = mix(c0, c1, smoothstep(0.00, 0.46, t));
    c = mix(c, c2, smoothstep(0.44, 0.76, t));
    c = mix(c, c3, smoothstep(0.74, 0.93, t));
    c = mix(c, c4, smoothstep(0.92, 1.00, t));
    return c;
}

[[ stitchable ]] half4 wallpaperGradient(float2 position,
                                         half4  color,
                                         float4 boundingRect,
                                         float  time,
                                         float  mode,
                                         float  scale,
                                         float  warp,
                                         float  contrast,
                                         float  bands,
                                         float  rotation,
                                         float  lift,
                                         float  softness,
                                         float  grain,
                                         float  vignette,
                                         float  seed,
                                         float  animate,
                                         float  aSpeed,
                                         float  aAmount,
                                         float  aWaves,
                                         half4  color1,
                                         half4  color2,
                                         half4  color3,
                                         half4  color4,
                                         half4  color5) {
    float2 res = max(boundingRect.zw, float2(1.0));
    float2 fc = float2(position.x, res.y - position.y);
    float2 uv = (fc - 0.5 * res) / res.y;

    float soft = clamp(softness, 0.0, 1.0);
    float sc = scale * (1.05 - soft * 0.55);
    float wa = warp * (0.35 + soft * 0.7);
    float th = rotation * (M_PI_F / 180.0);
    float2 uvw = uv;
    if (animate > 0.5) {
        float ts = time * aSpeed;
        uvw += aAmount * float2(sin(ts + uv.y * aWaves),
                                cos(ts * 0.77 + uv.x * aWaves));
    }
    float2 p = float2(cos(th) * uvw.x + sin(th) * uvw.y,
                      -sin(th) * uvw.x + cos(th) * uvw.y) * sc + seed;

    float2 q = float2(wp_fbm(p), wp_fbm(p + float2(3.7, 1.3)));
    float2 r = float2(wp_fbm(p + wa * q + float2(1.7, 9.2)),
                      wp_fbm(p + wa * q + float2(8.3, 2.8)));
    float f = wp_fbm(p + wa * r);

    float t;
    if (mode < 0.5) {
        t = 0.46 + f * contrast * 1.9;
        float k = t - 0.78;
        if (k > 0.0) { t = 0.78 + k / (1.0 + k * 1.6); }
        t = pow(clamp(t, 0.0, 1.0), 1.35);
    } else {
        t = 0.5 + 0.5 * sin(f * 6.2831 * bands * 1.7 + seed * 2.0);
        t = pow(clamp(t, 0.0, 1.0), contrast);
        float k = t - 0.72;
        if (k > 0.0) { t = 0.72 + k / (1.0 + k * 0.6); }
    }

    float3 col = wp_pal(t + lift,
                        float3(color1.rgb), float3(color2.rgb), float3(color3.rgb),
                        float3(color4.rgb), float3(color5.rgb));

    float d = length(uv * float2(0.78, 0.52));
    col *= mix(1.0, 1.0 - smoothstep(0.1, 1.25, d), clamp(vignette, 0.0, 1.0));

    float gs = 1500.0 / res.y;
    float g = wp_hash1(floor(fc * gs) + seed * 37.0);
    col += (g - 0.5) * clamp(grain, 0.0, 1.0) * 0.34 * (0.22 + dot(col, float3(0.333)));

    return half4(half3(max(col, float3(0.0))), 1.0h);
}
