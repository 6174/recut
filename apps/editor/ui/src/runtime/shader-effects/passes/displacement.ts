/**
 * [INPUT]: uMap、uResolution、uTime、uAmount、uScale。
 * [OUTPUT]: 已验证 Displacement texture pass GLSL。
 * [POS]: shader-effects 的唯一 Displacement 视觉实现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export const DISPLACEMENT_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uAmount;
  uniform float uScale;
  varying vec2 vUv;

  float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
    float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
    float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm2(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise2D(p);
      p = p * 2.02 + 17.1;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 p = vUv * vec2(uResolution.x / uResolution.y, 1.0);
    vec2 drift = vec2(uTime * 0.16, uTime * 0.11);
    vec2 warp = vec2(fbm2(p * uScale + drift), fbm2(p * uScale + vec2(5.2, 1.3) - drift * 0.7));
    vec2 center = vec2(0.5 + 0.34 * sin(uTime * 0.28), 0.5 + 0.22 * cos(uTime * 0.22));
    float focus = smoothstep(0.6, 0.0, length(p - center));
    vec2 uv = clamp(vUv + (warp - 0.5) * uAmount * (0.35 + focus), 0.001, 0.999);
    gl_FragColor = vec4(texture2D(uMap, uv).rgb, 1.0);
  }
`;
