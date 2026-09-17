#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>

using namespace metal;

static inline float mf_hash(float2 p) {
    return fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
}

static inline float mf_vnoise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mf_hash(i),                  mf_hash(i + float2(1.0, 0.0)), u.x),
        mix(mf_hash(i + float2(0.0, 1.0)), mf_hash(i + float2(1.0, 1.0)), u.x),
        u.y);
}

[[ stitchable ]] half4 meshGrain(float2 position,
                                 half4  color,
                                 float4 boundingRect,
                                 float  grain) {
    float2 uv = position / boundingRect.zw;
    float x = (uv.x + 4.0) * (uv.y + 4.0) * 10.0;
    float g = fmod((fmod(x, 13.0) + 1.0) * (fmod(x, 123.0) + 1.0), 0.01) - 0.005;
    half3 rgb = clamp(color.rgb + half3(half(g * grain)), half3(0.0h), half3(1.0h));
    return half4(rgb, color.a);
}

[[ stitchable ]] float2 meshGlass(float2 position,
                                  float4 boundingRect,
                                  float  amount,
                                  float  scale) {
    float2 size = max(boundingRect.zw, float2(1.0));
    float2 uv = position / size;
    float k = max(scale, 0.5);
    float2 w = float2(
        sin(uv.y * k * 6.2831853 + 1.3) + 0.5 * sin(uv.y * k * 12.9 + 0.7),
        cos(uv.x * k * 6.2831853 + 2.1) + 0.5 * cos(uv.x * k * 11.3 + 1.9)
    );
    return position + w * amount * 0.02 * size;
}

[[ stitchable ]] half4 meshCrystal(float2 position,
                                   SwiftUI::Layer layer,
                                   float4 boundingRect,
                                   float  amount,
                                   float  scale) {
    float2 size = max(boundingRect.zw, float2(1.0));
    float2 uv = position / size;
    float2 asp = float2(size.x / size.y, 1.0);
    float2 cell = floor(uv * asp * max(scale, 1.0));
    float h1 = mf_hash(cell);
    float h2 = mf_hash(cell + float2(37.0, 17.0));
    float2 off = (float2(h1, h2) - 0.5) * amount * 0.06 / asp;
    half4 s = layer.sample(position + off * size);
    return half4(clamp(s.rgb * half(1.0 + (h1 - 0.5) * amount * 0.35), 0.0h, 1.0h), s.a);
}

[[ stitchable ]] half4 meshFluted(float2 position,
                                  SwiftUI::Layer layer,
                                  float4 boundingRect,
                                  float  amount,
                                  float  scale,
                                  float  angle) {
    float2 size = max(boundingRect.zw, float2(1.0));
    float2 uv = position / size;
    float2 asp = float2(size.x / size.y, 1.0);
    float th = angle * (M_PI_F / 180.0);
    float2 dir = float2(cos(th), sin(th));
    float2 q = (uv - 0.5) * asp;
    float span = max(abs(dir.x) * asp.x + abs(dir.y) * asp.y, 0.0001);
    float t = dot(q, dir) / span + 0.5;
    float n = max(scale, 1.0) * 2.0;
    float centre = (floor(t * n) + 0.5) / n;
    float f = (t - centre) * n;
    float e = abs(f) * 2.0;
    float k = (1.0 - clamp(amount, 0.0, 1.0)) * (1.0 - 0.65 * e * e);
    float shift = (centre + (t - centre) * k - t) * span;
    half4 s = layer.sample(((q + dir * shift) / asp + 0.5) * size);
    float g = (f + 0.18) * 3.2;
    half3 rgb = clamp(s.rgb + half3(half(0.09 * amount * exp(-g * g))), 0.0h, 1.0h);
    return half4(rgb, s.a);
}

static inline float mf_sd_round_box(float2 p, float2 ext, float r) {
    float2 q = abs(p) - ext + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

[[ stitchable ]] half4 meshBlocks(float2 position,
                                  SwiftUI::Layer layer,
                                  float4 boundingRect,
                                  float  amount,
                                  float  scale,
                                  float  rounding,
                                  float  bevel,
                                  float  blur,
                                  float  inset) {
    float2 size = max(boundingRect.zw, float2(1.0));
    float2 uv = position / size;
    float2 asp = float2(size.x / size.y, 1.0);
    float nx = max(round(scale), 1.0);
    float ny = max(round(nx / max(asp.x, 0.0001)), 1.0);
    float2 cnt = float2(nx, ny);
    float2 bs = uv * cnt;
    float2 cell = floor(bs);
    float2 f = fract(bs) - 0.5;
    float2 ca = float2(asp.x * ny / nx, 1.0);
    float in0 = clamp(inset, 0.0, 0.45);
    float half0 = max(min(0.5 * ca.x, 0.5) - in0, 0.02);
    float2 ext = float2(half0);
    float rad = clamp(rounding, 0.0, 1.0) * min(ext.x, ext.y);
    float2 fp = f * ca;
    float sd = mf_sd_round_box(fp, ext, rad);
    float2 e = float2(0.004, 0.0);
    float2 grad = float2(
        mf_sd_round_box(fp + e.xy, ext, rad) - mf_sd_round_box(fp - e.xy, ext, rad),
        mf_sd_round_box(fp + e.yx, ext, rad) - mf_sd_round_box(fp - e.yx, ext, rad)
    );
    float2 nrm = grad / max(length(grad), 0.0001);
    float band = max(bevel, 0.01) * min(ext.x, ext.y);
    float t = clamp(-sd / band, 0.0, 1.0);
    float bend = (1.0 - t) * (1.0 - t);
    float k = 1.0 - 0.85 * clamp(amount, 0.0, 1.0);
    float inPane = step(sd, 0.0);
    float2 src = ((cell + 0.5 + f * mix(1.0, k, inPane) + (nrm / ca) * bend * amount * 0.06 * inPane) / cnt) * size;

    half3 rgb = layer.sample(src).rgb;
    if (blur * inPane >= 0.35) {
        rgb *= 0.18h;
        float wsum = 0.18;
        for (int i = 0; i < 8; i++) {
            float ang = (float(i) / 8.0) * 6.2831853;
            float2 dir = float2(cos(ang), sin(ang)) * blur;
            rgb += layer.sample(src + dir * 0.55).rgb * 0.075h;
            rgb += layer.sample(src + dir).rgb * 0.0275h;
            wsum += 0.1025;
        }
        rgb /= half(wsum);
    }

    return half4(clamp(rgb, 0.0h, 1.0h), layer.sample(position).a);
}

[[ stitchable ]] float2 meshFrost(float2 position,
                                  float4 boundingRect,
                                  float  amount) {
    float2 size = max(boundingRect.zw, float2(1.0));
    float2 uv = position / size;
    float2 asp = float2(size.x / size.y, 1.0);
    float2 p = uv * asp * 42.0;
    float2 n = float2(mf_vnoise(p), mf_vnoise(p + float2(7.3, 2.1))) - 0.5;
    return position + (n * amount * 0.05 / asp) * size;
}

static inline float2 mf_hash2(float2 p) {
    float2 q = float2(dot(p, float2(127.1, 311.7)), dot(p, float2(269.5, 183.3)));
    return fract(sin(q) * 43758.5453) * 2.0 - 1.0;
}

static inline float mf_gnoise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(dot(mf_hash2(i),                    f),
            dot(mf_hash2(i + float2(1.0, 0.0)), f - float2(1.0, 0.0)), u.x),
        mix(dot(mf_hash2(i + float2(0.0, 1.0)), f - float2(0.0, 1.0)),
            dot(mf_hash2(i + float2(1.0, 1.0)), f - float2(1.0, 1.0)), u.x),
        u.y);
}

static inline float mf_fbm(float2 p) {
    float amp = 0.6, s = 0.0;
    for (int i = 0; i < 3; i++) { s += amp * mf_gnoise(p); p *= 2.1; amp *= 0.42; }
    return s;
}

[[ stitchable ]] half4 meshFilm(float2 position,
                                SwiftUI::Layer layer,
                                float4 boundingRect,
                                float  amount,
                                float  scale,
                                float  angle,
                                float  soft,
                                float  grain,
                                float  fade) {
    float2 size = max(boundingRect.zw, float2(1.0));
    float2 uv = position / size;
    float2 asp = float2(size.x / size.y, 1.0);
    float amt = clamp(amount, 0.0, 1.0);
    float s0 = clamp(soft, 0.0, 1.0);
    float th = angle * (M_PI_F / 180.0);
    float2 qc = (uv - 0.5) * asp;
    float2 rq = float2(cos(th) * qc.x + sin(th) * qc.y, -sin(th) * qc.x + cos(th) * qc.y);
    float2 wp = rq * (max(scale, 0.1) * (1.05 - s0 * 0.55)) + 7.3;
    float w = amt * 4.0 * (0.35 + s0 * 0.7);
    float2 q1 = float2(mf_fbm(wp), mf_fbm(wp + float2(3.7, 1.3)));
    float2 r1 = float2(mf_fbm(wp + w * q1 + float2(1.7, 9.2)),
                       mf_fbm(wp + w * q1 + float2(8.3, 2.8)));
    float2 suv = clamp(uv + r1 * amt * 0.16 / asp, 0.0, 1.0);
    half4 s = layer.sample(clamp(suv * size, float2(0.5), size - 0.5));
    float3 c = float3(s.rgb);
    float vd = length(qc * float2(0.78, 0.52));
    c *= mix(1.0, 1.0 - smoothstep(0.1, 1.25, vd), clamp(fade, 0.0, 1.0));
    float g = mf_hash(floor(uv * asp * 1500.0));
    c += (g - 0.5) * clamp(grain, 0.0, 1.0) * 0.34 * (0.22 + dot(c, float3(0.333)));
    return half4(half3(clamp(c, 0.0, 1.0)), s.a);
}
