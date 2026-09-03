/**
 * [INPUT]: Shader pass source modules.
 * [OUTPUT]: Shared deterministic GLSL snippets for all Effect passes.
 * [POS]: shader-effects source boundary; components/effects must not own Shader source.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export const GLSL_HASH12 = `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
`;
export const PASSTHROUGH_VERTEX = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
export const GLSL_NUMERIC = `
  float linearStep(float edge0, float edge1, float value) {
    return clamp((value - edge0) / max(edge1 - edge0, 1e-6), 0.0, 1.0);
  }
  float pow2(float x) { return x * x; }
  float pow5(float x) { float x2 = x * x; return x2 * x2 * x; }
`;
export const GLSL_FBM2 = `
  float noise2D(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
    float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
    float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm2(vec2 p) { float value = 0.0; float amplitude = 0.5; for (int i = 0; i < 5; i++) { value += amplitude * noise2D(p); p = p * 2.02 + 17.1; amplitude *= 0.5; } return value; }
`;
