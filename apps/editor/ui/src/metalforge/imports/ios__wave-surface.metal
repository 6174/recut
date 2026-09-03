#include <metal_stdlib>
using namespace metal;

struct Uniforms {
    float  rotation;
    float  spin;
    float  radius;
    float  strength;
    float  decay;
    float  turbulence;
    float  pointSizeScale;
    float  aspect;
    float  pointScale;
    float  time;
    int    touchCount;
    float4 backColor;
    float4 glowColor;
    float4 frontColor;
};

struct VOut {
    float4 position [[position]];
    float  pointSize [[point_size]];
    float  brightness;
    float  depth;
};

constant float kTimeScale = 1.1;

static float hash11(uint n) {
    n = (n ^ 61u) ^ (n >> 16);
    n *= 9u;
    n = n ^ (n >> 4);
    n *= 0x27d4eb2du;
    n = n ^ (n >> 15);
    return float(n & 0x00ffffffu) / float(0x01000000u);
}

static float h3(float3 p) {
    p = fract(p * float3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}

static float vnoise3(float3 x) {
    float3 i = floor(x);
    float3 f = fract(x);
    float3 u = f * f * (3.0 - 2.0 * f);
    float n000 = h3(i + float3(0,0,0));
    float n100 = h3(i + float3(1,0,0));
    float n010 = h3(i + float3(0,1,0));
    float n110 = h3(i + float3(1,1,0));
    float n001 = h3(i + float3(0,0,1));
    float n101 = h3(i + float3(1,0,1));
    float n011 = h3(i + float3(0,1,1));
    float n111 = h3(i + float3(1,1,1));
    float nx00 = mix(n000, n100, u.x);
    float nx10 = mix(n010, n110, u.x);
    float nx01 = mix(n001, n101, u.x);
    float nx11 = mix(n011, n111, u.x);
    float nxy0 = mix(nx00, nx10, u.y);
    float nxy1 = mix(nx01, nx11, u.y);
    return mix(nxy0, nxy1, u.z);
}

static float fbm3(float3 p) {
    float a = 0.5;
    float v = 0.0;
    for (int i = 0; i < 4; ++i) {
        v += a * vnoise3(p);
        p *= 2.02;
        a *= 0.5;
    }
    return v;
}

static float3 shape(float r1, float r2, float r3, float t, float3 dir) {
    float radd = sqrt(r3) * 1.0;
    float ang = r1 * 6.2831853;
    float x = radd * cos(ang);
    float uu = radd * sin(ang);
    float h = sin(x * 4.5 + t * 1.6) * 0.14
            + cos(uu * 3.8 + t * 1.3) * 0.10
            + (r2 - 0.5) * 0.04;
    float tilt = 0.7;
    float ct = cos(tilt), st = sin(tilt);
    float y = h * ct - uu * st;
    float z = h * st + uu * ct;
    return float3(x, y, z);
}

vertex VOut particle_vertex(uint vid [[vertex_id]],
                            constant Uniforms& u [[buffer(0)]],
                            constant float4* touches [[buffer(1)]]) {
    float r1 = hash11(vid * 3u + 11u);
    float r2 = hash11(vid * 3u + 23u);
    float r3 = hash11(vid * 3u + 37u);

    float theta = r1 * 6.2831853;
    float cosPhi = 2.0 * r2 - 1.0;
    float sinPhi = sqrt(max(0.0, 1.0 - cosPhi * cosPhi));
    float3 dir = float3(sinPhi * cos(theta), sinPhi * sin(theta), cosPhi);

    float t = u.time * kTimeScale;

    float3 pn = shape(r1, r2, r3, t, dir);
    float3 p = pn * u.radius;

    float3 wavep = pn * 4.0 + float3(t * 0.5, t * 0.4, t * 0.3);
    float3 wave = float3(fbm3(wavep + 1.7),
                         fbm3(wavep + 9.2),
                         fbm3(wavep + 17.4)) - 0.5;
    p += wave * u.radius * 0.18 * u.turbulence;

    float depthRaw = (p.z / max(u.radius, 0.0001)) * 0.5 + 0.5;
    float depth = clamp(depthRaw, 0.0, 1.0);

    float density = fbm3(p * (3.0 / max(u.radius, 0.0001))
                         + float3(-t * 0.45, t * 0.25, t * 0.55));
    density = smoothstep(0.15, 0.70, density);

    float distFromCenter = length(p) / max(u.radius, 0.0001);
    float falloff = exp(-u.decay * 0.6 * distFromCenter);

    float ang = u.rotation + u.spin * t;
    float c = cos(ang);
    float s = sin(ang);
    float rx = p.x * c + p.z * s;
    float rz = -p.x * s + p.z * c;
    p.x = rx;
    p.z = rz;

    float2 pndc = float2(p.x / u.aspect, p.y);
    for (int i = 0; i < u.touchCount; ++i) {
        float4 tp = touches[i];
        float2 d = pndc - tp.xy;
        float dist = length(d);
        float sigma = 0.08;
        float ageW = exp(-tp.z * 1.6);
        float falloffT = exp(-(dist * dist) / (sigma * sigma));
        float3 noiseSamp = float3(pndc.x * 7.0, pndc.y * 7.0, u.time * 0.4 + float(i));
        float shapeNoise = fbm3(noiseSamp);
        float push = 0.02 * ageW * falloffT * (0.25 + 1.5 * shapeNoise);
        float2 dir2 = dist > 1e-5 ? d / dist : float2(1.0, 0.0);
        pndc += dir2 * push;
    }

    VOut o;
    o.position = float4(pndc.x, pndc.y, 0.5, 1.0);
    o.pointSize = u.pointScale * u.pointSizeScale * (0.65 + 0.55 * depth);
    o.brightness = falloff * (0.35 + 0.85 * density) * u.strength * 0.7
                   * (0.40 + 0.60 * depth);
    o.depth = depth;
    return o;
}

fragment float4 particle_fragment(VOut in [[stage_in]],
                                  float2 pc [[point_coord]],
                                  constant Uniforms& u [[buffer(0)]]) {
    float2 d = pc - float2(0.5);
    float r = length(d) * 2.0;
    if (r > 1.0) discard_fragment();
    float a = (1.0 - r) * in.brightness;
    float depth = in.depth;
    float3 col = mix(u.backColor.rgb, u.glowColor.rgb, clamp(depth * 2.0, 0.0, 1.0));
    col = mix(col, u.frontColor.rgb, clamp((depth - 0.5) * 2.0, 0.0, 1.0));
    return float4(col * a, a);
}
