/**
 * [INPUT]: Three shader uniforms and shared GLSL helpers.
 * [OUTPUT]: Verified shader source for the glass effect.
 * [POS]: shader-effects pass catalog; React effect components only bind uniforms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { GLSL_NUMERIC } from "../shared/glsl";
export const GLASS_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform vec2 uResolution;
  uniform vec2 uCenter;
  uniform vec2 uHalf;
  uniform float uCorner;
  uniform float uEdge;
  uniform float uBevel;
  uniform float uIor;
  uniform float uDepth;
  uniform float uAberration;
  uniform float uBlur;
  uniform float uReflect;
  uniform float uShine;
  uniform float uZoom;
  varying vec2 vUv;

  const float PI = 3.14159265358979;
  const float AIR_IOR = 1.0003;
  const vec3 INCIDENT = vec3(0.0, 0.0, 1.0);

  ${GLSL_NUMERIC}

  float sdf(vec2 p) {
    vec2 q = abs(p) - (uHalf - vec2(uCorner));
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uCorner;
  }
  float ign(vec2 v) { return fract(52.9829189 * fract(0.06711056 * v.x + 0.00583715 * v.y)); }
  // 特效纹理为 sRGB（SceneCapture 已做 linear→sRGB 编码 pass），线性化做光学计算。
  vec3 page(vec2 px) {
    return pow(texture2D(uMap, clamp(px / uResolution, 0.0005, 0.9995)).rgb, vec3(2.2));
  }
  float iorForWavelength(float wavelength) {
    float ab = uAberration * 0.1;
    return mix(uIor + ab, uIor - ab, 1.0 - pow(1.0 - linearStep(450.0, 650.0, wavelength), 4.0));
  }
  vec3 pageAA(vec2 px) {
    float footprint = max(length(fwidth(px)), 1.0);
    return mix(page(px), page(px + vec2(footprint * 0.12)), 0.08);
  }
  vec3 sampleRefraction(vec2 basePx, float rim, vec3 normal, float glassIor) {
    vec3 ray = refract(INCIDENT, normal, AIR_IOR / glassIor);
    ray /= abs(ray.z) / uDepth;
    return mix(pageAA(basePx + ray.xy), page(basePx + ray.xy), min(uBlur * (1.0 + rim) * 0.14, 0.72));
  }
  float fresnelSchlick(float cosTheta, float f0) { return f0 + (1.0 - f0) * pow5(1.0 - cosTheta); }
  float smithSchlickDenom(float cosTheta, float k) { return cosTheta * (1.0 - k) + k; }
  float ggx(float roughness, float NDotL, float NDotV, float NDotH) {
    if (NDotL <= 0.0) return 0.0;
    float a2 = pow2(roughness);
    float d = a2 / (PI * pow2(pow2(NDotH) * (a2 - 1.0) + 1.0));
    float k = roughness * 0.5;
    float v = 1.0 / (smithSchlickDenom(NDotL, k) * smithSchlickDenom(clamp(NDotV, 0.0, 1.0), k));
    return NDotL * d * v;
  }

  void main() {
    vec2 fragPx = vUv * uResolution;
    vec2 p = fragPx - uCenter;
    float sd = sdf(p);
    float mask = 1.0 - smoothstep(-1.5, 0.0, sd);
    float minHalf = min(uHalf.x, uHalf.y);
    float edgeW = max(minHalf * (1.0 - clamp(uEdge, 0.0, 0.98)), 1.0);
    float rim = pow(linearStep(-edgeW, 0.0, sd), uBevel);
    float randAngle = ign(fragPx) * PI * 2.0;
    float scatter = min(uBlur, 1.0) * 0.02;
    vec3 flatNormal = normalize(vec3(sin(randAngle) * scatter, cos(randAngle) * scatter, -1.0));
    vec2 grad = vec2(sdf(p + vec2(1.0, 0.0)) - sdf(p - vec2(1.0, 0.0)), sdf(p + vec2(0.0, 1.0)) - sdf(p - vec2(0.0, 1.0)));
    vec3 rimNormal = vec3(normalize(grad + vec2(1e-5)), 0.0);
    vec3 normal = normalize(mix(flatNormal, rimNormal, rim));
    vec2 basePx = uCenter + p / uZoom;
    vec3 refracted = sampleRefraction(basePx, rim, normal, iorForWavelength(611.4)) * vec3(1.0, 0.0, 0.0);
    refracted += sampleRefraction(basePx, rim, normal, iorForWavelength(570.5)) * vec3(1.0, 1.0, 0.0);
    refracted += sampleRefraction(basePx, rim, normal, iorForWavelength(549.1)) * vec3(0.0, 1.0, 0.0);
    refracted += sampleRefraction(basePx, rim, normal, iorForWavelength(491.4)) * vec3(0.0, 1.0, 1.0);
    refracted += sampleRefraction(basePx, rim, normal, iorForWavelength(464.2)) * vec3(0.0, 0.0, 1.0);
    refracted += sampleRefraction(basePx, rim, normal, iorForWavelength(374.0)) * vec3(1.0, 0.0, 1.0);
    refracted /= 3.0;

    const vec3 V = vec3(0.0, 0.0, -1.0);
    float NDotV = clamp(dot(V, normal), 0.0, 1.0);
    float f0 = pow2((uIor - AIR_IOR) / (uIor + AIR_IOR));
    vec3 reflectVector = reflect(INCIDENT, normal);
    vec3 L = reflectVector;
    vec3 H = normalize(L + V);
    reflectVector /= abs(reflectVector.z) / uDepth;
    vec3 reflected = page(basePx + reflectVector.xy) * ggx(0.5, dot(normal, L), NDotV, dot(normal, H));
    vec3 glass = mix(refracted, reflected, clamp(fresnelSchlick(NDotV, f0) * uReflect, 0.0, 1.0));
    float ldot = dot(rimNormal.xy, normalize(vec2(-0.6, 0.8)));
    float band = pow(rim, 1.8);
    float arcs = pow(abs(ldot), 3.0) * (ldot > 0.0 ? 0.5 : 0.28);
    glass += band * (0.04 + arcs) * uShine;
    vec3 source = texture2D(uMap, vUv).rgb;
    // source(sRGB) 与编码后的 glass(sRGB) 混合；alpha=mask：玻璃之外完全透明，
    // 下层内容/背景原样显示，绝不被快照覆盖。
    gl_FragColor = vec4(mix(source, pow(max(glass, 0.0), vec3(1.0 / 2.2)), mask), clamp(mask, 0.0, 1.0));
  }
`;
