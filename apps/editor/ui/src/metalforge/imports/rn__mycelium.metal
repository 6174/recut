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

struct AgentUniforms {
    float dt;
    float time;
    float stepX;
    float stepY;
    float sensorX;
    float sensorY;
    float sensorAngle;
    float turn;
    float flow;
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
    float ramp0r, ramp0g, ramp0b;
    float ramp1r, ramp1g, ramp1b;
    float ramp2r, ramp2g, ramp2b;
    float ramp3r, ramp3g, ramp3b;
};

struct PointOut {
    float4 position [[position]];
    float  size     [[point_size]];
    float3 color;
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

fragment float4 trail_decay_fragment(VSOut in [[stage_in]],
                                     texture2d<float> uTexture [[texture(0)]],
                                     constant float2 &texelSize [[buffer(0)]],
                                     constant float  &keep      [[buffer(1)]],
                                     constant float  &diffuse   [[buffer(2)]]) {
    float2 uv = in.uv;
    float4 c = uTexture.sample(fluidSampler, uv);
    float4 blurred = 0.25 * (uTexture.sample(fluidSampler, uv - float2(texelSize.x, 0.0))
                           + uTexture.sample(fluidSampler, uv + float2(texelSize.x, 0.0))
                           + uTexture.sample(fluidSampler, uv + float2(0.0, texelSize.y))
                           + uTexture.sample(fluidSampler, uv - float2(0.0, texelSize.y)));
    return mix(c, blurred, clamp(diffuse, 0.0, 1.0)) * keep;
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

static inline float senseTrail(texture2d<float> trail, float2 pos, float angle,
                               float2 sensor) {
    float2 at = pos + float2(cos(angle), sin(angle)) * sensor;
    return dot(trail.sample(fluidSampler, fract(at)).rgb, float3(0.333));
}

kernel void agent_update(device Particle *agents             [[buffer(0)]],
                         constant AgentUniforms &u           [[buffer(1)]],
                         texture2d<float> uTrail             [[texture(0)]],
                         texture2d<float> uVelocity          [[texture(1)]],
                         uint gid [[thread_position_in_grid]]) {
    if (gid >= u.count) { return; }

    Particle a = agents[gid];
    float angle = a.vel.x;
    float2 sensor = float2(u.sensorX, u.sensorY);

    float ahead = senseTrail(uTrail, a.pos, angle, sensor);
    float left  = senseTrail(uTrail, a.pos, angle - u.sensorAngle, sensor);
    float right = senseTrail(uTrail, a.pos, angle + u.sensorAngle, sensor);

    float step = u.turn * u.dt;
    if (ahead > left && ahead > right) {
    } else if (ahead < left && ahead < right) {
        angle += (hash11(a.seed + u.time * 37.1) < 0.5 ? -step : step);
    } else if (right > left) {
        angle += step;
    } else if (left > right) {
        angle -= step;
    }

    float2 flow = uVelocity.sample(fluidSampler, a.pos).xy;
    if (length(flow) > 1.0) {
        angle += (atan2(flow.y, flow.x) - angle) * clamp(u.flow * u.dt, 0.0, 1.0);
    }

    a.pos = fract(a.pos + float2(cos(angle), sin(angle)) * float2(u.stepX, u.stepY));
    a.vel.x = angle;
    agents[gid] = a;
}

vertex PointOut deposit_vertex(uint vid [[vertex_id]],
                               const device Particle *agents      [[buffer(0)]],
                               constant ParticleRenderUniforms &u [[buffer(1)]]) {
    Particle a = agents[vid];
    PointOut o;
    o.position = float4(a.pos.x * 2.0 - 1.0, (1.0 - a.pos.y) * 2.0 - 1.0, 0.0, 1.0);
    o.size = u.pointSize;
    o.color = float3(u.hotR, u.hotG, u.hotB) * u.brightness;
    return o;
}

fragment float4 particle_fragment(PointOut in [[stage_in]],
                                  float2 pc [[point_coord]]) {
    float d = length(pc - 0.5) * 2.0;
    float falloff = exp(-d * d * 3.2);
    return float4(in.color * falloff, 1.0);
}

fragment float4 display_mycelium_fragment(VSOut in [[stage_in]],
                                          texture2d<float> uTexture [[texture(0)]],
                                          texture2d<float> uBloom   [[texture(1)]],
                                          constant DisplayUniforms &u [[buffer(0)]]) {
    float2 uv = in.uv;
    float3 field = uTexture.sample(fluidSampler, uv).rgb;
    float mass = max(field.r, max(field.g, field.b));
    float d = mass * u.p0;
    float3 tint = field / max(mass, 0.0001);

    float3 c = float3(u.ramp0r, u.ramp0g, u.ramp0b);
    c = mix(c, float3(u.ramp1r, u.ramp1g, u.ramp1b) * tint, smoothstep(0.02, 0.30, d));
    c = mix(c, float3(u.ramp2r, u.ramp2g, u.ramp2b) * tint, smoothstep(0.26, 0.70, d));
    c = mix(c, float3(u.ramp3r, u.ramp3g, u.ramp3b) * tint, smoothstep(0.68, 1.10, d));

    if (u.bloomEnabled > 0.5) {
        c += uBloom.sample(fluidSampler, uv).rgb;
    }

    if (u.reveal < 1.0) {
        float2 rd = uv - 0.5;
        rd.x *= u.aspect;
        float radius = length(rd) / 0.60;
        float front = u.reveal * 1.45;

        c *= 1.0 - smoothstep(front - 0.30, front, radius);

        float q = (radius - front) * 9.0;
        float band = exp(-q * q);
        c += float3(1.00, 0.64, 0.32) * tint * band * smoothstep(0.015, 0.30, d) * 1.1;
    }

    return float4(c, 1.0);
}
