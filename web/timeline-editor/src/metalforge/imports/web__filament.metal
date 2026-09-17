#include <metal_stdlib>
using namespace metal;

constexpr sampler fluidSampler(mag_filter::linear,
                               min_filter::linear,
                               address::clamp_to_edge);

struct VSOut {
    float4 position [[position]];
    float2 uv;
};

struct Particle {
    float2 pos;
    float2 vel;
    float  life;
    float  seed;
};

struct ParticleUniforms {
    float texelX;
    float texelY;
    float dt;
    float speed;
    float fade;
    float time;
    float drag;
    float gravity;
    float spawnMode;
    float launch;
    uint  count;
};

struct ParticleRenderUniforms {
    float pointSize;
    float brightness;
    float speedScale;
    float stepX;
    float stepY;
    float fadeShape;
    float coolR, coolG, coolB;
    float hotR,  hotG,  hotB;
    float sparkR, sparkG, sparkB;
};

struct DisplayUniforms {
    float texelX;
    float texelY;
    float bloomEnabled;
    float time;
    float aspect;
    float p0;
    float p1;
    float p2;
    float p3;
    float reveal;
};

vertex VSOut fullscreen_vertex(uint vid [[vertex_id]]) {
    float2 pos[3] = { float2(-1.0, -1.0), float2(3.0, -1.0), float2(-1.0, 3.0) };
    VSOut out;
    float2 p = pos[vid];
    out.position = float4(p, 0.0, 1.0);
    out.uv = float2(p.x * 0.5 + 0.5, 1.0 - (p.y * 0.5 + 0.5));
    return out;
}

static inline float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

static inline float2 hash21(float p) {
    float3 p3 = fract(float3(p) * float3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

fragment float4 splat_fragment(VSOut in [[stage_in]],
                               texture2d<float> uTarget [[texture(0)]],
                               constant float2 &point       [[buffer(0)]],
                               constant float3 &color       [[buffer(1)]],
                               constant float  &radius      [[buffer(2)]],
                               constant float  &aspectRatio [[buffer(3)]]) {
    float2 p = in.uv - point;
    p.x *= aspectRatio;
    float3 splat = exp(-dot(p, p) / radius) * color;
    float3 base = uTarget.sample(fluidSampler, in.uv).xyz;
    return float4(base + splat, 1.0);
}

fragment float4 curl_fragment(VSOut in [[stage_in]],
                              texture2d<float> uVelocity [[texture(0)]],
                              constant float2 &texelSize [[buffer(0)]]) {
    float2 uv = in.uv;
    float L = uVelocity.sample(fluidSampler, uv - float2(texelSize.x, 0.0)).y;
    float R = uVelocity.sample(fluidSampler, uv + float2(texelSize.x, 0.0)).y;
    float T = uVelocity.sample(fluidSampler, uv + float2(0.0, texelSize.y)).x;
    float B = uVelocity.sample(fluidSampler, uv - float2(0.0, texelSize.y)).x;
    float vorticity = R - L - T + B;
    return float4(0.5 * vorticity, 0.0, 0.0, 1.0);
}

fragment float4 vorticity_fragment(VSOut in [[stage_in]],
                                   texture2d<float> uVelocity [[texture(0)]],
                                   texture2d<float> uCurl     [[texture(1)]],
                                   constant float2 &texelSize    [[buffer(0)]],
                                   constant float  &curlStrength [[buffer(1)]],
                                   constant float  &dt           [[buffer(2)]]) {
    float2 uv = in.uv;
    float L = uCurl.sample(fluidSampler, uv - float2(texelSize.x, 0.0)).x;
    float R = uCurl.sample(fluidSampler, uv + float2(texelSize.x, 0.0)).x;
    float T = uCurl.sample(fluidSampler, uv + float2(0.0, texelSize.y)).x;
    float B = uCurl.sample(fluidSampler, uv - float2(0.0, texelSize.y)).x;
    float C = uCurl.sample(fluidSampler, uv).x;

    float2 force = 0.5 * float2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= curlStrength * C;
    force.y *= -1.0;

    float2 velocity = uVelocity.sample(fluidSampler, uv).xy;
    velocity += force * dt;
    velocity = clamp(velocity, -1000.0, 1000.0);
    return float4(velocity, 0.0, 1.0);
}

fragment float4 divergence_fragment(VSOut in [[stage_in]],
                                    texture2d<float> uVelocity [[texture(0)]],
                                    constant float2 &texelSize [[buffer(0)]]) {
    float2 uv = in.uv;
    float2 vL = uv - float2(texelSize.x, 0.0);
    float2 vR = uv + float2(texelSize.x, 0.0);
    float2 vT = uv + float2(0.0, texelSize.y);
    float2 vB = uv - float2(0.0, texelSize.y);

    float L = uVelocity.sample(fluidSampler, vL).x;
    float R = uVelocity.sample(fluidSampler, vR).x;
    float T = uVelocity.sample(fluidSampler, vT).y;
    float B = uVelocity.sample(fluidSampler, vB).y;
    float2 C = uVelocity.sample(fluidSampler, uv).xy;

    if (vL.x < 0.0) { L = -C.x; }
    if (vR.x > 1.0) { R = -C.x; }
    if (vT.y > 1.0) { T = -C.y; }
    if (vB.y < 0.0) { B = -C.y; }

    float div = 0.5 * (R - L + T - B);
    return float4(div, 0.0, 0.0, 1.0);
}

fragment float4 clear_fragment(VSOut in [[stage_in]],
                               texture2d<float> uTexture [[texture(0)]],
                               constant float &value [[buffer(0)]]) {
    return value * uTexture.sample(fluidSampler, in.uv);
}

fragment float4 pressure_fragment(VSOut in [[stage_in]],
                                  texture2d<float> uPressure   [[texture(0)]],
                                  texture2d<float> uDivergence [[texture(1)]],
                                  constant float2 &texelSize [[buffer(0)]]) {
    float2 uv = in.uv;
    float L = uPressure.sample(fluidSampler, uv - float2(texelSize.x, 0.0)).x;
    float R = uPressure.sample(fluidSampler, uv + float2(texelSize.x, 0.0)).x;
    float T = uPressure.sample(fluidSampler, uv + float2(0.0, texelSize.y)).x;
    float B = uPressure.sample(fluidSampler, uv - float2(0.0, texelSize.y)).x;
    float divergence = uDivergence.sample(fluidSampler, uv).x;
    float pressure = (L + R + B + T - divergence) * 0.25;
    return float4(pressure, 0.0, 0.0, 1.0);
}

fragment float4 gradient_fragment(VSOut in [[stage_in]],
                                  texture2d<float> uPressure [[texture(0)]],
                                  texture2d<float> uVelocity [[texture(1)]],
                                  constant float2 &texelSize [[buffer(0)]]) {
    float2 uv = in.uv;
    float L = uPressure.sample(fluidSampler, uv - float2(texelSize.x, 0.0)).x;
    float R = uPressure.sample(fluidSampler, uv + float2(texelSize.x, 0.0)).x;
    float T = uPressure.sample(fluidSampler, uv + float2(0.0, texelSize.y)).x;
    float B = uPressure.sample(fluidSampler, uv - float2(0.0, texelSize.y)).x;
    float2 velocity = uVelocity.sample(fluidSampler, uv).xy;
    velocity -= float2(R - L, T - B);
    return float4(velocity, 0.0, 1.0);
}

fragment float4 advection_fragment(VSOut in [[stage_in]],
                                   texture2d<float> uVelocity [[texture(0)]],
                                   texture2d<float> uSource   [[texture(1)]],
                                   constant float2 &texelSize   [[buffer(0)]],
                                   constant float  &dt          [[buffer(1)]],
                                   constant float  &dissipation [[buffer(2)]]) {
    float2 coord = in.uv - dt * uVelocity.sample(fluidSampler, in.uv).xy * texelSize;
    float4 result = uSource.sample(fluidSampler, coord);
    float decay = 1.0 + dissipation * dt;
    return result / decay;
}

fragment float4 bloom_prefilter_fragment(VSOut in [[stage_in]],
                                         texture2d<float> uTexture [[texture(0)]],
                                         constant float3 &curve     [[buffer(0)]],
                                         constant float  &threshold [[buffer(1)]]) {
    float3 c = uTexture.sample(fluidSampler, in.uv).rgb;
    float br = max(c.r, max(c.g, c.b));
    float rq = clamp(br - curve.x, 0.0, curve.y);
    rq = curve.z * rq * rq;
    c *= max(rq, br - threshold) / max(br, 0.0001);
    return float4(c, 1.0);
}

fragment float4 bloom_blur_fragment(VSOut in [[stage_in]],
                                    texture2d<float> uTexture [[texture(0)]],
                                    constant float2 &texelSize [[buffer(0)]]) {
    float4 sum = float4(0.0);
    sum += uTexture.sample(fluidSampler, in.uv - float2(texelSize.x, 0.0));
    sum += uTexture.sample(fluidSampler, in.uv + float2(texelSize.x, 0.0));
    sum += uTexture.sample(fluidSampler, in.uv + float2(0.0, texelSize.y));
    sum += uTexture.sample(fluidSampler, in.uv - float2(0.0, texelSize.y));
    sum *= 0.25;
    return sum;
}

fragment float4 bloom_final_fragment(VSOut in [[stage_in]],
                                     texture2d<float> uTexture [[texture(0)]],
                                     constant float2 &texelSize [[buffer(0)]],
                                     constant float  &intensity [[buffer(1)]]) {
    float4 sum = float4(0.0);
    sum += uTexture.sample(fluidSampler, in.uv - float2(texelSize.x, 0.0));
    sum += uTexture.sample(fluidSampler, in.uv + float2(texelSize.x, 0.0));
    sum += uTexture.sample(fluidSampler, in.uv + float2(0.0, texelSize.y));
    sum += uTexture.sample(fluidSampler, in.uv - float2(0.0, texelSize.y));
    sum *= 0.25;
    return sum * intensity;
}

kernel void particle_update(device Particle *particles           [[buffer(0)]],
                            constant ParticleUniforms &u         [[buffer(1)]],
                            texture2d<float> uVelocity           [[texture(0)]],
                            uint gid [[thread_position_in_grid]]) {
    if (gid >= u.count) { return; }

    Particle p = particles[gid];
    float2 texel = float2(u.texelX, u.texelY);
    float2 fluid = uVelocity.sample(fluidSampler, p.pos).xy;

    float blend = clamp(u.drag * u.dt, 0.0, 1.0);
    p.vel = mix(p.vel, fluid, blend);
    p.vel.y += u.gravity * u.dt;
    p.vel = clamp(p.vel, -4000.0, 4000.0);

    p.pos += p.vel * u.dt * texel * u.speed;
    p.life -= u.dt * u.fade;

    bool escaped = p.pos.x < -0.02 || p.pos.x > 1.02 || p.pos.y < -0.02 || p.pos.y > 1.02;
    if (p.life <= 0.0 || escaped) {
        float2 h = hash21(p.seed + u.time * 13.137);
        if (u.spawnMode > 0.5) {
            p.pos = float2(h.x, 0.94 + h.y * 0.05);
            float side = hash11(p.seed + u.time * 7.77) - 0.5;
            p.vel = float2(side * u.launch * 0.7, -u.launch * (0.35 + h.y * 1.80));
        } else {
            p.pos = h;
            p.vel = float2(0.0);
        }
        p.life = 1.0;
    }
    particles[gid] = p;
}

struct PointOut {
    float4 position [[position]];
    float  size     [[point_size]];
    float3 color;
};

static inline float3 particleShade(constant ParticleRenderUniforms &u, float t, float life) {
    float3 cool  = float3(u.coolR,  u.coolG,  u.coolB);
    float3 hot   = float3(u.hotR,   u.hotG,   u.hotB);
    float3 spark = float3(u.sparkR, u.sparkG, u.sparkB);

    float3 c = mix(cool, hot, t) + spark * t * t * t;

    float l = clamp(life, 0.0, 1.0);
    float alpha = mix(sin(l * 3.14159265), pow(l, 0.7), u.fadeShape);

    float gate = 0.05 + 0.95 * t;

    return c * alpha * gate * u.brightness;
}

vertex PointOut particle_vertex(uint vid [[vertex_id]],
                                const device Particle *particles          [[buffer(0)]],
                                constant ParticleRenderUniforms &u        [[buffer(1)]]) {
    Particle p = particles[vid];

    PointOut o;
    o.position = float4(p.pos.x * 2.0 - 1.0, (1.0 - p.pos.y) * 2.0 - 1.0, 0.0, 1.0);
    o.size = u.pointSize;

    float t = clamp(length(p.vel) / max(u.speedScale, 0.0001), 0.0, 1.0);
    o.color = particleShade(u, t, p.life);
    return o;
}

fragment float4 particle_fragment(PointOut in [[stage_in]],
                                  float2 pc [[point_coord]]) {
    float d = length(pc - 0.5) * 2.0;
    float falloff = exp(-d * d * 3.2);
    return float4(in.color * falloff, 1.0);
}

fragment float4 display_filament_fragment(VSOut in [[stage_in]],
                                          texture2d<float> uTexture [[texture(0)]],
                                          texture2d<float> uBloom   [[texture(1)]],
                                          constant DisplayUniforms &u [[buffer(0)]]) {
    float2 uv = in.uv;
    float3 c = uTexture.sample(fluidSampler, uv).rgb;

    c = 1.0 - exp(-c * u.p0);

    if (u.bloomEnabled > 0.5) {
        c += uBloom.sample(fluidSampler, uv).rgb;
    }

    float2 d = uv - 0.5;
    d.x *= u.aspect;
    c *= 1.0 - u.p1 * smoothstep(0.25, 0.85, length(d));

    return float4(c, 1.0);
}
