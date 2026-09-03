/**
 * [INPUT]: Three shader uniforms and shared GLSL helpers.
 * [OUTPUT]: Verified shader source for the particle-scroll effect.
 * [POS]: shader-effects pass catalog; React effect components only bind uniforms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { GLSL_HASH12 } from "../shared/glsl";
export const PARTICLE_SCROLL_FRAGMENT_SHADER = `
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;

  ${GLSL_HASH12}

  void main() {
    vec2 grid = vec2(28.0, 20.0);
    vec2 cell = floor(vUv * grid);
    vec2 p = fract(vUv * grid) - 0.5;
    float seed = hash12(cell);
    float drift = fract(uTime * (0.06 + seed * 0.1) + seed * 4.0);
    vec2 center = vec2(
      (seed - 0.5) * 1.4,
      fract(seed * 7.3 + uTime * (0.04 + seed * 0.05)) - 0.5
    );
    vec2 delta = p - center;
    // 点半径按 1920 参考宽折算成 cell 分数：任意预览尺寸下保持相同像素直径
    // （320 宽的对话框预览里亚像素点不可见，会显得「没有飘」）。
    float radius = (0.05 + seed * 0.06) * (1920.0 / uResolution.x);
    float twinkle = 0.55 + 0.45 * sin(uTime * (1.0 + seed * 2.0) + seed * 20.0);
    float dot = (1.0 - smoothstep(radius * 0.3, radius, length(delta))) * twinkle;
    vec3 color = mix(vec3(0.65, 0.8, 1.0), vec3(1.0, 0.95, 0.8), seed);
    float alpha = dot * uOpacity * (0.5 + drift * 0.5);
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;
