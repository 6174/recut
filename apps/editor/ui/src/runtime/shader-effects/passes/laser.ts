/**
 * [INPUT]: Three shader uniforms and shared GLSL helpers.
 * [OUTPUT]: Verified shader source for the laser effect.
 * [POS]: shader-effects pass catalog; React effect components only bind uniforms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { GLSL_HASH12 } from "../shared/glsl";
export const LASER_FRAGMENT_SHADER = `
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uIntensity;
  varying vec2 vUv;

  ${GLSL_HASH12}

  void main() {
    float scan = fract(uTime * 0.22);
    float y = scan * 1.2 - 0.1;
    float d = abs(vUv.y - y);
    float core = smoothstep(0.004, 0.0, d);
    float halo = exp(-d * d / (0.006 * 0.006));
    float beam = core * 1.6 + halo * 0.35;
    float jitter = (hash12(vec2(floor(vUv.y * uResolution.y * 0.2), floor(uTime * 8.0))) - 0.5) * 0.05;
    float flicker = 0.85 + 0.15 * sin(uTime * 9.0 + vUv.x * 40.0);
    vec3 color = vec3(1.0, 0.12, 0.35);
    float alpha = beam * flicker * uOpacity * uIntensity;
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;
