/**
 * [INPUT]: Three shader uniforms and shared GLSL helpers.
 * [OUTPUT]: Verified shader source for the asciify effect.
 * [POS]: shader-effects pass catalog; React effect components only bind uniforms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { GLSL_HASH12 } from "../shared/glsl";
export const ASCIIFY_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform sampler2D uGlyphs;
  uniform vec2 uResolution;
  uniform float uCell;
  uniform float uGlyphCount;
  uniform float uTime;
  uniform float uProgress;
  varying vec2 vUv;

  ${GLSL_HASH12}

  float lum(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  void main() {
    vec3 original = texture2D(uMap, vUv).rgb;
    // 终态必须绕过 cell 采样；否则 amount=0 也只会得到低分辨率像素图。
    if (uProgress >= 0.82) {
      gl_FragColor = vec4(original, 1.0);
      return;
    }
    vec2 cells = uResolution / uCell;
    vec2 cellCoord = floor(vUv * cells);
    vec2 cellUv = fract(vUv * cells);
    vec2 cellCenter = (cellCoord + 0.5) / cells;
    vec3 cellSource = texture2D(uMap, cellCenter).rgb;
    float index = clamp(floor(lum(cellSource) * uGlyphCount), 0.0, uGlyphCount - 1.0);
    vec2 glyphUv = vec2(cellUv.x, (index + cellUv.y) / uGlyphCount);
    vec4 glyph = texture2D(uGlyphs, glyphUv);
    float flicker = 0.88 + 0.12 * hash12(cellCoord + floor(uTime * 5.0) * 0.37);
    // 终端扫描线：一条亮带自上而下扫过，字符随之增亮
    float scan = 0.5 + 0.5 * sin(vUv.y * 16.0 - uTime * 2.2);
    vec3 ascii = cellSource * glyph.a * flicker * (0.78 + 0.34 * scan);
    // ASCII 是一次解码表演：先形成字符，再在镜头后段精确回到原始内容。
    float amount = smoothstep(0.04, 0.2, uProgress)
      * (1.0 - smoothstep(0.58, 0.86, uProgress));
    vec3 color = mix(original, ascii, amount);
    gl_FragColor = vec4(color, 1.0);
  }
`;
