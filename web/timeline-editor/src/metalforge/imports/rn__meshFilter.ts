import { Skia } from "@shopify/react-native-skia";

export const FILTER = Skia.RuntimeEffect.Make(`

uniform shader image;

uniform float2 resolution;
uniform float mode;
uniform float a;
uniform float b;
uniform float ppp;
uniform float4 knobs;

float3 tap(float2 uv) {
    return float3(image.eval(clamp(uv, float2(0.0), float2(1.0)) * resolution).rgb);
}

float3 blurAt(float2 uv, float radiusPx) {
    if (radiusPx < 0.35) {
        return tap(uv);
    }
    float2 stp = radiusPx / resolution;
    float3 sum = tap(uv) * 0.18;
    float wsum = 0.18;
    for (int i = 0; i < 8; i++) {
        float ang = (float(i) / 8.0) * 6.2831853;
        float2 d = float2(cos(ang), sin(ang));
        sum += tap(uv + d * stp * 0.55) * 0.075;
        sum += tap(uv + d * stp) * 0.0275;
        wsum += 0.1025;
    }
    return sum / wsum;
}

float filmGrain(float2 uv) {
    float x = (uv.x + 4.0) * (uv.y + 4.0) * 10.0;
    return mod((mod(x, 13.0) + 1.0) * (mod(x, 123.0) + 1.0), 0.01) - 0.005;
}

float hash21(float2 p) {
    return fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
}

float sdRoundBox(float2 p, float2 ext, float r) {
    float2 q = abs(p) - ext + float2(r);
    return length(max(q, float2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

float vnoise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash21(i), hash21(i + float2(1.0, 0.0)), u.x),
        mix(hash21(i + float2(0.0, 1.0)), hash21(i + float2(1.0, 1.0)), u.x),
        u.y
    );
}

float2 aspect() {
    return float2(resolution.x / max(resolution.y, 1.0), 1.0);
}

float2 hash22(float2 p) {
    float2 q = float2(dot(p, float2(127.1, 311.7)), dot(p, float2(269.5, 183.3)));
    return fract(sin(q) * 43758.5453) * 2.0 - 1.0;
}

float gnoise(float2 p) {
    float2 i = floor(p);
    float2 f = fract(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(dot(hash22(i),                    f),
            dot(hash22(i + float2(1.0, 0.0)), f - float2(1.0, 0.0)), u.x),
        mix(dot(hash22(i + float2(0.0, 1.0)), f - float2(0.0, 1.0)),
            dot(hash22(i + float2(1.0, 1.0)), f - float2(1.0, 1.0)), u.x),
        u.y
    );
}

float fbm3(float2 p) {
    float amp = 0.6;
    float s = 0.0;
    for (int i = 0; i < 3; i++) {
        s += amp * gnoise(p);
        p *= 2.1;
        amp *= 0.42;
    }
    return s;
}

half4 main(float2 fragCoord) {
    float2 uv = fragCoord / resolution;
    int m = int(mode + 0.5);
    float3 col = tap(uv);

    if (m == 7) {
        col = clamp(col + float3(filmGrain(uv) * a), 0.0, 1.0);
    } else if (m == 8) {
        float s = max(b, 0.5);
        float2 w = float2(
            sin(uv.y * s * 6.2831853 + 1.3) + 0.5 * sin(uv.y * s * 12.9 + 0.7),
            cos(uv.x * s * 6.2831853 + 2.1) + 0.5 * cos(uv.x * s * 11.3 + 1.9)
        );
        col = tap(uv + w * a * 0.02);
    } else if (m == 9) {
        float2 asp = aspect();
        float2 cell = floor(uv * asp * max(b, 1.0));
        float h1 = hash21(cell);
        float h2 = hash21(cell + float2(37.0, 17.0));
        float2 off = (float2(h1, h2) - float2(0.5)) * a * 0.06 / asp;
        col = clamp(tap(uv + off) * (1.0 + (h1 - 0.5) * a * 0.35), 0.0, 1.0);
    } else if (m == 10) {
        float2 asp = aspect();
        float2 p = uv * asp * 42.0;
        float2 n = float2(vnoise(p), vnoise(p + float2(7.3, 2.1))) - float2(0.5);
        col = blurAt(uv + n * a * 0.05 / asp, b * ppp);
    } else if (m == 11) {
        float2 asp = aspect();
        float th = radians(knobs.x);
        float2 dir = float2(cos(th), sin(th));
        float2 q = (uv - float2(0.5)) * asp;
        float span = max(abs(dir.x) * asp.x + abs(dir.y) * asp.y, 0.0001);
        float t = dot(q, dir) / span + 0.5;
        float n = max(b, 1.0) * 2.0;
        float centre = (floor(t * n) + 0.5) / n;
        float fl = (t - centre) * n;
        float e = abs(fl) * 2.0;
        float k = (1.0 - clamp(a, 0.0, 1.0)) * (1.0 - 0.65 * e * e);
        float shift = (centre + (t - centre) * k - t) * span;
        float3 c = tap((q + dir * shift) / asp + float2(0.5));
        float sh = (fl + 0.18) * 3.2;
        col = clamp(c + float3(0.09 * a * exp(-sh * sh)), 0.0, 1.0);
    } else if (m == 12) {
        float2 asp = aspect();
        float nx = max(floor(b + 0.5), 1.0);
        float ny = max(floor(nx / max(asp.x, 0.0001) + 0.5), 1.0);
        float2 cnt = float2(nx, ny);
        float2 bs = uv * cnt;
        float2 cell = floor(bs);
        float2 fq = fract(bs) - float2(0.5);
        float2 ca = float2(asp.x * ny / nx, 1.0);
        float inset = clamp(knobs.w, 0.0, 0.45);
        float halfSide = max(min(0.5 * ca.x, 0.5) - inset, 0.02);
        float2 ext = float2(halfSide);
        float rad = clamp(knobs.x, 0.0, 1.0) * min(ext.x, ext.y);
        float2 fp = fq * ca;
        float sd = sdRoundBox(fp, ext, rad);
        float2 stx = float2(0.004, 0.0);
        float2 sty = float2(0.0, 0.004);
        float2 grad = float2(
            sdRoundBox(fp + stx, ext, rad) - sdRoundBox(fp - stx, ext, rad),
            sdRoundBox(fp + sty, ext, rad) - sdRoundBox(fp - sty, ext, rad)
        );
        float2 nrm = grad / max(length(grad), 0.0001);
        float band = max(knobs.y, 0.01) * min(ext.x, ext.y);
        float t = clamp(-sd / band, 0.0, 1.0);
        float bend = (1.0 - t) * (1.0 - t);
        float k = 1.0 - 0.85 * clamp(a, 0.0, 1.0);
        float inPane = step(sd, 0.0);
        float3 c = blurAt(
            (cell + float2(0.5) + fq * mix(1.0, k, inPane)
                + (nrm / ca) * bend * a * 0.06 * inPane) / cnt,
            knobs.z * ppp * inPane
        );
        col = clamp(c, 0.0, 1.0);
    } else if (m == 13) {
        float2 asp = aspect();
        float amt = clamp(a, 0.0, 1.0);
        float soft = clamp(knobs.y, 0.0, 1.0);
        float th = radians(knobs.x);
        float2 qc = (uv - float2(0.5)) * asp;
        float2 rq = float2(cos(th) * qc.x + sin(th) * qc.y, -sin(th) * qc.x + cos(th) * qc.y);
        float2 wp = rq * (max(b, 0.1) * (1.05 - soft * 0.55)) + float2(7.3);
        float w = amt * 4.0 * (0.35 + soft * 0.7);
        float2 q1 = float2(fbm3(wp), fbm3(wp + float2(3.7, 1.3)));
        float2 r1 = float2(fbm3(wp + w * q1 + float2(1.7, 9.2)),
                           fbm3(wp + w * q1 + float2(8.3, 2.8)));
        float3 c = tap(uv + r1 * amt * 0.16 / asp);
        float vd = length(qc * float2(0.78, 0.52));
        c *= mix(1.0, 1.0 - smoothstep(0.1, 1.25, vd), clamp(knobs.w, 0.0, 1.0));
        float g = hash21(floor(uv * asp * 1500.0));
        c += (g - 0.5) * clamp(knobs.z, 0.0, 1.0) * 0.34 * (0.22 + dot(c, float3(0.333)));
        col = clamp(c, 0.0, 1.0);
    }

    return half4(half3(col), 1.0);
}
`)!;
