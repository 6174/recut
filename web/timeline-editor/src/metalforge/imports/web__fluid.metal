#include <metal_stdlib>
using namespace metal;

constexpr sampler fluidSampler(mag_filter::linear,
                               min_filter::linear,
                               address::clamp_to_edge);

struct VSOut {
    float4 position [[position]];
    float2 uv;
};

vertex VSOut fullscreen_vertex(uint vid [[vertex_id]]) {
    float2 pos[3] = { float2(-1.0, -1.0), float2(3.0, -1.0), float2(-1.0, 3.0) };
    VSOut out;
    float2 p = pos[vid];
    out.position = float4(p, 0.0, 1.0);
    out.uv = float2(p.x * 0.5 + 0.5, 1.0 - (p.y * 0.5 + 0.5));
    return out;
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

fragment float4 display_fragment(VSOut in [[stage_in]],
                                 texture2d<float> uTexture [[texture(0)]],
                                 texture2d<float> uBloom   [[texture(1)]],
                                 constant float2 &texelSize    [[buffer(0)]],
                                 constant float  &shading      [[buffer(1)]],
                                 constant float  &bloomEnabled [[buffer(2)]]) {
    float2 uv = in.uv;
    float3 c = uTexture.sample(fluidSampler, uv).rgb;

    if (shading > 0.5) {
        float3 lc = uTexture.sample(fluidSampler, uv - float2(texelSize.x, 0.0)).rgb;
        float3 rc = uTexture.sample(fluidSampler, uv + float2(texelSize.x, 0.0)).rgb;
        float3 tc = uTexture.sample(fluidSampler, uv + float2(0.0, texelSize.y)).rgb;
        float3 bc = uTexture.sample(fluidSampler, uv - float2(0.0, texelSize.y)).rgb;

        float dx = length(rc) - length(lc);
        float dy = length(tc) - length(bc);

        float3 n = normalize(float3(dx, dy, length(texelSize)));
        float3 l = float3(0.0, 0.0, 1.0);
        float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
        c *= diffuse;
    }

    if (bloomEnabled > 0.5) {
        float3 bloom = uBloom.sample(fluidSampler, uv).rgb;
        c += bloom;
    }

    return float4(c, 1.0);
}
