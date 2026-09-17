/**
 * [INPUT]: Three shader uniforms and shared GLSL helpers.
 * [OUTPUT]: Verified shader source for the liquid effect.
 * [POS]: shader-effects pass catalog; React effect components only bind uniforms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export const LIQUID_FRAGMENT_SHADER = `
  uniform vec2 uResolution;
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
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
    vec2 q = p + vec2(
      fbm2(p * 1.4 + uTime * 0.12),
      fbm2(p * 1.4 + vec2(5.2, 1.3) - uTime * 0.08)
    );
    float field = fbm2(p * 1.6 + 2.2 * q);
    vec3 color = mix(uColorA, uColorB, field);
    // 预乘输出：共享特效平面使用 premultipliedAlpha 混合（与其他 bg pass 一致）。
    gl_FragColor = vec4(color * uOpacity, uOpacity);
  }
`;
