/**
 * [INPUT]: Three shader uniforms and shared GLSL helpers.
 * [OUTPUT]: Verified shader source for the bubble effect.
 * [POS]: shader-effects pass catalog; React effect components only bind uniforms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export const BUBBLE_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform int uCount;
  uniform vec2 uTrail[24];
  uniform float uBaseRadius;
  uniform float uBlend;
  uniform float uRefraction;
  uniform float uDispersion;
  uniform float uShine;
  uniform float uRim;
  uniform float uIridescence;
  uniform float uIntensity;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying vec2 vUv;

  const float EPS = 1e-4;
  const int ITR = 14;

  vec3 page(vec2 px) {
    vec2 uv = clamp(px / uResolution, 0.0005, 0.9995);
    return pow(texture2D(uMap, uv).rgb, vec3(2.2));
  }

  float rnd3D(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453123);
  }

  float noise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float a000 = rnd3D(i);
    float a100 = rnd3D(i + vec3(1.0, 0.0, 0.0));
    float a010 = rnd3D(i + vec3(0.0, 1.0, 0.0));
    float a110 = rnd3D(i + vec3(1.0, 1.0, 0.0));
    float a001 = rnd3D(i + vec3(0.0, 0.0, 1.0));
    float a101 = rnd3D(i + vec3(1.0, 0.0, 1.0));
    float a011 = rnd3D(i + vec3(0.0, 1.0, 1.0));
    float a111 = rnd3D(i + vec3(1.0, 1.0, 1.0));
    float k0 = a000;
    float k1 = a100 - a000;
    float k2 = a010 - a000;
    float k3 = a001 - a000;
    float k4 = a000 - a100 - a010 + a110;
    float k5 = a000 - a010 - a001 + a011;
    float k6 = a000 - a100 - a001 + a101;
    float k7 = -a000 + a100 + a010 - a110 + a001 - a101 - a011 + a111;
    return k0 + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y
      + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z;
  }

  float smoothMin(float d1, float d2, float k) {
    float h = exp(-k * d1) + exp(-k * d2);
    return -log(max(h, 1e-12)) / k;
  }

  float map(vec3 p) {
    float radius = uBaseRadius * float(uCount);
    float d = 1e5;
    for (int i = 0; i < 24; i++) {
      if (i >= uCount) break;
      float sphere = length(p - vec3(uTrail[i], 0.0))
        - (radius - uBaseRadius * float(i));
      d = smoothMin(d, sphere, uBlend);
    }
    return d;
  }

  vec3 generateNormal(vec3 p) {
    return normalize(vec3(
      map(p + vec3(EPS, 0.0, 0.0)) - map(p - vec3(EPS, 0.0, 0.0)),
      map(p + vec3(0.0, EPS, 0.0)) - map(p - vec3(0.0, EPS, 0.0)),
      map(p + vec3(0.0, 0.0, EPS)) - map(p - vec3(0.0, 0.0, EPS))));
  }

  vec3 dropletColor(vec3 normal, vec3 rayDir) {
    vec3 reflectDir = reflect(rayDir, normal);
    vec3 color0 = uColorA * noise3D(reflectDir * 2.0 + uTime);
    vec3 color1 = uColorB * noise3D(reflectDir * 2.0 - uTime);
    return (color0 + color1) * uIntensity;
  }

  void main() {
    vec3 source = texture2D(uMap, vUv).rgb;
    float minRes = min(uResolution.x, uResolution.y);
    vec2 p = (vUv * uResolution * 2.0 - uResolution) / minRes;
    vec3 ray = vec3(p, 1.0);
    vec3 rayDir = vec3(0.0, 0.0, -1.0);
    float dist = 0.0;
    for (int i = 0; i < ITR; i++) {
      dist = map(ray);
      ray += rayDir * dist;
      if (dist < EPS || dist > 8.0) break;
    }
    float coverage = 1.0 - smoothstep(0.0, 3.0 / minRes, dist);
    if (coverage < 0.001) {
      gl_FragColor = vec4(source, 1.0);
      return;
    }

    vec3 normal = generateNormal(ray);
    vec3 glints = pow(max(dropletColor(normal, rayDir), 0.0), vec3(7.0));
    vec3 light = normalize(vec3(-0.5, 0.7, 0.6));
    float spec = pow(max(dot(reflect(-light, normal), vec3(0.0, 0.0, 1.0)), 0.0), 60.0);
    float depth = uRefraction;
    float ca = uDispersion * 0.03;
    vec3 rvR = refract(rayDir, normal, 1.0 / (1.33 - ca));
    vec3 rvG = refract(rayDir, normal, 1.0 / 1.33);
    vec3 rvB = refract(rayDir, normal, 1.0 / (1.33 + ca));
    vec3 refracted = vec3(
      page(vUv * uResolution + rvR.xy * depth).r,
      page(vUv * uResolution + rvG.xy * depth).g,
      page(vUv * uResolution + rvB.xy * depth).b);
    float edge = pow(1.0 - clamp(normal.z, 0.0, 1.0), 1.5);
    refracted *= 1.0 - 0.35 * uRim * edge;
    vec3 color = pow(max(refracted, 0.0), vec3(1.0 / 2.2));
    color += glints * uIridescence;
    color += vec3(spec * uShine * 0.9);
    gl_FragColor = vec4(mix(source, color, coverage), 1.0);
  }
`;
