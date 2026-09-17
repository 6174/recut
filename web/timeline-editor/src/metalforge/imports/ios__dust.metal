#include <metal_stdlib>
using namespace metal;

struct Uniforms {
    float2 viewport;
    float2 center;
    float  radius;
    float  phase;
    float  squash;
    float  twistK;
    uint   rings;
    uint   shells;
    uint   segments;
    uint   style;
    float  dashScale;
    float  brightness;
    float  glowAmt;
    float  vignetteAmt;
    float  dpr;
    float  pad0;
    float  pad1;
    float  pad2;
    float4 dustColor;
    float4 glowColor;
    float4 vigColor;
    float4 bgColor;
};

constant float kTau = 6.283185307179586f;
constant float kPi  = 3.141592653589793f;
constant uint  kTableLen = 3600u;

constant float kTierA[3] = { 0.16f, 0.42f, 0.92f };
constant float kTierW[3] = { 0.65f, 0.95f, 1.4f };

constant float2 kQuad[6] = {
    float2(-1.0f, -1.0f), float2( 1.0f, -1.0f), float2(-1.0f,  1.0f),
    float2(-1.0f,  1.0f), float2( 1.0f, -1.0f), float2( 1.0f,  1.0f)
};

struct DashOut {
    float4 position [[position]];
    float2 local;
    float  segLen [[flat]];
    float  halfW  [[flat]];
    float3 chan   [[flat]];
};

static DashOut dust_dropped() {
    DashOut o;
    o.position = float4(0.0f, 0.0f, -2.0f, 1.0f);
    o.local = float2(0.0f);
    o.segLen = 0.0f;
    o.halfW = 0.0f;
    o.chan = float3(0.0f);
    return o;
}

vertex DashOut dust_vertex(uint vid [[vertex_id]],
                           uint iid [[instance_id]],
                           constant Uniforms &U [[buffer(0)]],
                           device const float4 *P [[buffer(1)]])
{
    uint seg = max(U.segments, 1u);
    uint rings = max(U.rings, 2u);
    float ph = U.phase;
    float cssW = U.viewport.x / U.dpr;
    float cssH = U.viewport.y / U.dpr;

    float2 pos;
    float2 dvec;
    float  al;

    if (U.style == 0u) {
        uint j = iid / seg;
        uint k = iid % seg;
        if (j >= rings) { return dust_dropped(); }

        float f = float(j) / float(rings - 1u);
        float r = U.radius * (0.95f + 0.35f * sin(f * 5.0f - ph));
        if (r <= 0.5f) { return dust_dropped(); }
        float ry = cssH * 0.06f + f * cssH * 0.88f;
        float tw = f * U.twistK + ph;

        float band = 0.5f + 0.5f * sin(f * 9.0f - ph * 2.0f);
        float amp = 0.35f + 0.85f * band;

        float4 p = P[(j * seg + k * 7u + j) % kTableLen];
        float a = (float(k) / float(seg)) * kTau + tw;
        float rr = r * (1.0f + (p.x - 0.5f) * 0.05f);
        float sa = sin(a);
        float ca = cos(a);

        pos = float2(U.center.x + ca * rr,
                     ry + sa * rr * U.squash + (p.y - 0.5f) * 3.2f);
        if (pos.x < -30.0f || pos.x > cssW + 30.0f ||
            pos.y < -30.0f || pos.y > cssH + 30.0f) {
            return dust_dropped();
        }
        float front = 0.4f + 0.6f * (0.5f + 0.5f * sa);
        al = (0.06f + 0.9f * p.z) * front * amp;
        float len = (1.1f + 2.6f * p.y) * U.dashScale;
        dvec = float2(-sa * len, ca * len * (U.squash + 0.35f));
    } else {
        uint k = iid % seg;
        uint rest = iid / seg;
        uint j = rest % rings;
        uint sh = rest / rings;
        if (sh >= max(U.shells, 1u)) { return dust_dropped(); }

        float shf = float(sh);
        float pulse = 1.0f + 0.12f * sin(ph * 2.0f - shf * 1.1f);
        float RS = U.radius * (0.42f + 0.33f * shf) * pulse;
        float th = ((float(j) + 0.5f) / float(rings)) * kPi;
        float rr = sin(th) * RS;
        float yy = -cos(th) * RS;

        float4 p = P[(sh * 1500u + j * 100u + k * 3u) % kTableLen];
        float a = (float(k) / float(seg)) * kTau + ph * (1.0f + shf);
        float sa = sin(a);
        float ca = cos(a);

        pos = float2(U.center.x + ca * rr, U.center.y + yy * 0.92f + sa * rr * U.squash);
        float front = 0.4f + 0.6f * (0.5f + 0.5f * sa);
        al = (0.05f + 0.8f * p.z) * front * (1.0f - shf * 0.13f);
        dvec = float2(-sa * 2.2f, ca * 0.8f) * U.dashScale;
    }

    al *= U.brightness;
    if (al < 0.05f) { return dust_dropped(); }
    int tier = 0;
    if (al > 0.62f) { tier = 2; } else if (al > 0.28f) { tier = 1; }

    float2 A = pos * U.dpr;
    float2 D = dvec * U.dpr;
    float halfW = kTierW[tier] * 0.5f * U.dpr;

    float ln = length(D);
    float2 tang = float2(1.0f, 0.0f);
    if (ln > 1e-5f) { tang = D / ln; }
    float2 nrm = float2(-tang.y, tang.x);

    float pad = halfW + 1.0f;
    float2 q = kQuad[vid];
    float s = (q.x * 0.5f + 0.5f) * (ln + 2.0f * pad) - pad;
    float v = q.y * pad;
    float2 px = A + tang * s + nrm * v;

    DashOut o;
    o.position = float4(px.x / U.viewport.x * 2.0f - 1.0f,
                        1.0f - px.y / U.viewport.y * 2.0f,
                        0.0f, 1.0f);
    o.local = float2(s, v);
    o.segLen = ln;
    o.halfW = halfW;
    o.chan = float3(tier == 0 ? 1.0f : 0.0f,
                    tier == 1 ? 1.0f : 0.0f,
                    tier == 2 ? 1.0f : 0.0f);
    return o;
}

static float dust_coverage(float dist, float halfW) {
    return clamp(dist + halfW, -0.5f, 0.5f) - clamp(dist - halfW, -0.5f, 0.5f);
}

fragment float4 dust_fragment(DashOut in [[stage_in]])
{
    float across = dust_coverage(fabs(in.local.y), in.halfW);
    float capH = in.halfW * 0.7853981634f;
    float e = min(in.local.x + capH, in.segLen + capH - in.local.x);
    float along = clamp(e + 0.5f, 0.0f, 1.0f);
    return float4(in.chan * (across * along), 0.0f);
}

struct FullOut {
    float4 position [[position]];
};

vertex FullOut dust_full_vertex(uint vid [[vertex_id]]) {
    FullOut o;
    float x = float(int(vid) / 2) * 4.0f - 1.0f;
    float y = float(int(vid) & 1) * 4.0f - 1.0f;
    o.position = float4(x, y, 0.0f, 1.0f);
    return o;
}

fragment float4 dust_composite(FullOut in [[stage_in]],
                               constant Uniforms &U [[buffer(0)]],
                               texture2d<float, access::read> tiers [[texture(0)]])
{
    float4 c = tiers.read(uint2(in.position.xy));
    float a = kTierA[0] * c.r + kTierA[1] * c.g + kTierA[2] * c.b;
    return float4(U.dustColor.rgb * a, a);
}

fragment float4 dust_glow(FullOut in [[stage_in]],
                          constant Uniforms &U [[buffer(0)]])
{
    float2 p = in.position.xy / U.dpr;
    float r = max(U.radius * 0.4f, 1e-4f);
    float q = distance(p, U.center) / r;
    float a = 0.0f;
    if (q < 0.3f) {
        a = mix(U.glowAmt, U.glowAmt * 0.3f, q / 0.3f);
    } else if (q < 1.0f) {
        a = mix(U.glowAmt * 0.3f, 0.0f, (q - 0.3f) / 0.7f);
    }
    return float4(U.glowColor.rgb * a, a);
}

fragment float4 dust_vig(FullOut in [[stage_in]],
                         constant Uniforms &U [[buffer(0)]])
{
    float2 css = U.viewport / U.dpr;
    float2 p = in.position.xy / U.dpr;
    float d = length(css);
    float a = U.vignetteAmt * clamp((distance(p, U.center) - d * 0.3f) / (d * 0.36f), 0.0f, 1.0f);
    return float4(U.vigColor.rgb * a, a);
}
