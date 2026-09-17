/**
 * [INPUT]: Three shader uniforms and shared GLSL helpers.
 * [OUTPUT]: Verified shader source for the decrypt-reveal effect.
 * [POS]: shader-effects pass catalog; React effect components only bind uniforms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { GLSL_HASH12 } from "../shared/glsl";
export const DECRYPT_REVEAL_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uCell;
  uniform float uProgress;
  varying vec2 vUv;

  ${GLSL_HASH12}

  float hSegment(vec2 p, float y) {
    float d = max(abs(p.y - y), abs(p.x) - 0.31);
    return 1.0 - smoothstep(0.035, 0.075, d);
  }

  float vSegment(vec2 p, float x, float y) {
    float d = max(abs(p.x - x), abs(p.y - y) - 0.19);
    return 1.0 - smoothstep(0.035, 0.075, d);
  }

  void main() {
    vec3 source = texture2D(uMap, vUv).rgb;
    // 任何入场材质在结束帧都必须是无损原纹理。
    if (uProgress >= 0.86) {
      gl_FragColor = vec4(source, 1.0);
      return;
    }
    float reveal = smoothstep(0.04, 0.82, clamp(uProgress, 0.0, 1.0));
    vec2 cells = vec2(uResolution.x / (uCell * 0.62), uResolution.y / uCell);
    vec2 cell = floor(vUv * cells);
    float resolveAt = hash12(cell + 1.7);
    float resolved = smoothstep(resolveAt - 0.12, resolveAt + 0.035, reveal);
    vec2 cellCenter = (cell + 0.5) / cells;
    vec3 cellColor = texture2D(uMap, clamp(cellCenter, 0.001, 0.999)).rgb;
    vec2 glyph = fract(vUv * cells) - 0.5;
    float tick = floor(uTime * 11.0);
    float a = step(0.47, hash12(cell + vec2(1.1, tick * 0.31)));
    float b = step(0.47, hash12(cell + vec2(2.3, tick * 0.53)));
    float c = step(0.47, hash12(cell + vec2(3.7, tick * 0.79)));
    float d = step(0.47, hash12(cell + vec2(5.9, tick * 0.97)));
    float e = step(0.47, hash12(cell + vec2(7.1, tick * 1.17)));
    float f = step(0.47, hash12(cell + vec2(8.3, tick * 1.39)));
    float g = step(0.47, hash12(cell + vec2(9.7, tick * 1.61)));
    // 7-segment cipher glyph：比随机采样块更接近真正的解密字符，同时保持纯 shader、可 seek。
    float cipher = max(max(a * hSegment(glyph, 0.31), b * vSegment(glyph, 0.31, 0.16)),
      max(c * vSegment(glyph, 0.31, -0.16), d * hSegment(glyph, -0.31)));
    cipher = max(cipher, max(e * vSegment(glyph, -0.31, -0.16), f * vSegment(glyph, -0.31, 0.16)));
    cipher = max(cipher, g * hSegment(glyph, 0.0));
    vec3 cipherInk = mix(vec3(0.44, 0.77, 1.0), cellColor * 1.35, 0.72);
    vec3 scrambled = mix(source * 0.055, cipherInk, cipher);
    vec3 color = mix(scrambled, source, resolved);
    gl_FragColor = vec4(color, 1.0);
  }
`;
