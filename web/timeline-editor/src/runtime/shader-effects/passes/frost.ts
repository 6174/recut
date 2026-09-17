/**
 * [INPUT]: Three shader uniforms and shared GLSL helpers.
 * [OUTPUT]: Verified shader source for the frost effect.
 * [POS]: shader-effects pass catalog; React effect components only bind uniforms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { GLSL_HASH12 } from "../shared/glsl";
export const FROST_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uIntensity;
  varying vec2 vUv;

  ${GLSL_HASH12}

  void main() {
    float breath = 0.32 + 0.68 * abs(sin(uTime * 0.45));
    float amount = uIntensity * breath;
    vec2 pixel = 1.0 / uResolution;
    float radius = 1.2 + 5.5 * amount;
    vec3 blurred = vec3(0.0);
    float total = 0.0;
    for (int y = -3; y <= 3; y++) {
      for (int x = -3; x <= 3; x++) {
        float weight = exp(-(float(x * x + y * y)) / (2.0 * radius * radius));
        blurred += texture2D(uMap, clamp(vUv + pixel * vec2(float(x), float(y)) * radius, 0.001, 0.999)).rgb * weight;
        total += weight;
      }
    }
    blurred /= total;
    vec3 frostColor = vec3(0.78, 0.9, 1.0);
    vec3 color = mix(blurred, blurred * frostColor * 1.15, 0.35 * amount);
    float crystal = hash12(floor(vUv * uResolution / 6.0) + floor(uTime * 2.0) * 0.37);
    color += vec3(crystal * 0.06 * amount);
    float edgeFrost = smoothstep(0.0, 0.25, length(vUv - 0.5));
    color = mix(color, frostColor * 0.9, edgeFrost * 0.18 * amount);
    gl_FragColor = vec4(color, 1.0);
  }
`;
