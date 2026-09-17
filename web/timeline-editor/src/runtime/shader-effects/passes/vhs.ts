/**
 * [INPUT]: uMap、uResolution、uTime、uIntensity、uProgress。
 * [OUTPUT]: 已验证 VHS texture pass GLSL。
 * [POS]: shader-effects 的唯一 VHS 视觉实现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export const VHS_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uProgress;
  varying vec2 vUv;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    float burst = smoothstep(0.035, 0.16, uProgress) * (1.0 - smoothstep(0.48, 0.78, uProgress)) * uIntensity;
    float line = floor(vUv.y * uResolution.y);
    float jitter = (hash12(vec2(line, floor(uTime * 24.0))) - 0.5) * 0.07 * burst;
    vec2 uv = clamp(vUv + vec2(jitter, 0.0), 0.001, 0.999);
    float bleed = 0.024 * burst;
    vec3 color = vec3(
      texture2D(uMap, clamp(uv + vec2(bleed, 0.0), 0.001, 0.999)).r,
      texture2D(uMap, uv).g,
      texture2D(uMap, clamp(uv - vec2(bleed, 0.0), 0.001, 0.999)).b
    );
    float scan = 1.0 - (0.025 + 0.045 * sin(vUv.y * uResolution.y * 1.9 + uTime * 5.0)) * burst;
    color *= scan;
    float dropout = step(0.965, hash12(vec2(floor(vUv.y * 42.0), floor(uTime * 7.0)))) * burst;
    color *= 1.0 - dropout * 0.5;
    float barY = fract(uTime * 0.035) * 1.2 - 0.1;
    color += vec3(smoothstep(0.06, 0.0, abs(vUv.y - barY)) * 0.16 * burst);
    color += vec3((hash12(vUv * uResolution + floor(uTime * 24.0)) - 0.5) * 0.1 * burst);
    gl_FragColor = vec4(color, 1.0);
  }
`;
