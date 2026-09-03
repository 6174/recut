/**
 * [INPUT]: Three shader uniforms and shared GLSL helpers.
 * [OUTPUT]: Verified shader source for the blaze effect.
 * [POS]: shader-effects pass catalog; React effect components only bind uniforms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export const BLAZE_FRAGMENT_SHADER = `
  uniform vec2 uResolution;
  uniform float uTime;
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

  vec3 fireRamp(float t) {
    vec3 a = vec3(0.04, 0.01, 0.01);
    vec3 b = vec3(0.9, 0.1, 0.02);
    vec3 c = vec3(1.0, 0.55, 0.05);
    vec3 d = vec3(1.0, 0.95, 0.5);
    float i = clamp(t, 0.0, 1.0);
    return i < 0.5 ? mix(a, b, i * 2.0) : mix(b, c, (i - 0.5) * 2.0);
  }

  void main() {
    vec2 p = vUv * vec2(uResolution.x / uResolution.y, 1.0);
    float f = fbm2(p * 2.0 + vec2(uTime * 0.18, -uTime * 0.12));
    float heat = fbm2(p * 4.0 - vec2(uTime * 0.3, uTime * 0.15));
    float field = clamp(f * 0.7 + heat * 0.45, 0.0, 1.0);
    vec3 color = fireRamp(field);
    float alpha = field * uOpacity;
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;
