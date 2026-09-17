/**
 * [INPUT]: Three shader uniforms and shared GLSL helpers.
 * [OUTPUT]: Verified shader source for the retro-dither effect.
 * [POS]: shader-effects pass catalog; React effect components only bind uniforms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export const RETRO_DITHER_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform vec2 uResolution;
  uniform float uLevels;
  uniform float uGrid;
  uniform float uTime;
  varying vec2 vUv;

  float bayer2(vec2 p) {
    p = mod(p, 2.0);
    return mod(p.y + mod(p.x, 2.0) * 2.0, 4.0);
  }

  float bayer4(vec2 p) {
    vec2 q = mod(floor(p / 2.0), 2.0);
    return bayer2(p) + 4.0 * bayer2(q);
  }

  float dither(vec2 uv) {
    vec2 shifted = uv + vec2(fract(uTime * 0.7) * 0.5, fract(uTime * 0.45) * 0.5);
    return bayer4(floor(shifted * uResolution / uGrid)) / 16.0 - 0.5;
  }

  void main() {
    vec3 color = texture2D(uMap, vUv).rgb;
    vec3 quantized = floor(color * uLevels + dither(vUv)) / max(uLevels - 1.0, 1.0);
    float scan = 0.05 * sin(vUv.y * uResolution.y * 2.0 + uTime * 5.0);
    gl_FragColor = vec4(clamp(quantized + scan, 0.0, 1.0), 1.0);
  }
`;
