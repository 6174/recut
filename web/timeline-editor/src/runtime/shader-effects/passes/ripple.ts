/**
 * [INPUT]: uMap、uResolution、uCenter、uTime、uRadius、uStrength、uFrequency。
 * [OUTPUT]: 已验证 Ripple texture pass GLSL。
 * [POS]: shader-effects 的唯一 Ripple 视觉实现，供 global Effect 与未来 element capture 复用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export const RIPPLE_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform vec2 uResolution;
  uniform vec2 uCenter;
  uniform float uTime;
  uniform float uRadius;
  uniform float uStrength;
  uniform float uFrequency;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv * uResolution - uCenter;
    float d = length(p);
    float wave = sin(d / uRadius * 3.14159265 * uFrequency - uTime * 4.0)
      * exp(-d / max(uRadius * 1.6, 1.0));
    vec2 direction = normalize(p + vec2(1e-4));
    vec2 uv = clamp(vUv + direction * wave * uStrength, 0.001, 0.999);
    vec3 color = texture2D(uMap, uv).rgb;
    gl_FragColor = vec4(color, 1.0);
  }
`;
