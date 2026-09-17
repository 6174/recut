/**
 * [INPUT]: Three shader uniforms and shared GLSL helpers.
 * [OUTPUT]: Verified shader source for the clouds effect.
 * [POS]: shader-effects pass catalog; React effect components only bind uniforms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export const CLOUDS_FRAGMENT_SHADER = `
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

  void main() {
    vec2 p = vUv * vec2(1.78, 1.0);
    float drift = uTime * 0.08;
    float field = fbm2(p * 2.4 + vec2(drift, -drift * 0.4));
    float detail = fbm2(p * 5.0 - vec2(drift * 1.8, drift));
    float mist = smoothstep(0.5, 0.87, field * 0.76 + detail * 0.24);
    float edge = smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
    vec3 color = mix(vec3(0.04, 0.17, 0.23), vec3(0.25, 0.82, 0.67), field);
    gl_FragColor = vec4(color * mist, mist * edge * uOpacity);
  }
`;
