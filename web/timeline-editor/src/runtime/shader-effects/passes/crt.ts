/**
 * [INPUT]: uMap、uTime、uResolution、uCurvature、uScanIntensity、uVignette、uMotion。
 * [OUTPUT]: 已验证 CRT texture pass GLSL。
 * [POS]: shader-effects 的唯一 CRT 视觉实现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
export const CRT_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec2 uCurvature;
  uniform float uScanIntensity;
  uniform float uVignette;
  uniform float uMotion;
  varying vec2 vUv;

  vec2 curveUv(vec2 uv) {
    vec2 c = uv * 2.0 - 1.0;
    vec2 offset = abs(c.yx) / uCurvature;
    c = c + c * offset * offset;
    return c * 0.5 + 0.5;
  }

  void main() {
    vec2 uv = curveUv(vUv);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    float refreshPhase = fract(uv.y - uTime * 0.16);
    float refreshBand = exp(-pow((refreshPhase - 0.5) * 15.0, 2.0));
    float rowFlutter = sin(uv.y * 1450.0 + uTime * 23.0) + 0.45 * sin(uv.y * 521.0 - uTime * 17.0);
    uv.x += (rowFlutter * 0.00042 + refreshBand * 0.006) * uMotion;
    uv.y += (sin(uTime * 15.0) * 0.00035 + sin(uTime * 5.2 + 1.7) * 0.00018) * uMotion;
    uv = clamp(uv, 0.001, 0.999);
    vec2 fromCenter = uv - 0.5;
    float radius = length(fromCenter);
    vec2 direction = radius > 0.0001 ? normalize(fromCenter) : vec2(0.0);
    float aberration = 0.0018 * pow(radius * 2.0, 2.0);
    vec3 color = vec3(
      texture2D(uMap, uv + direction * aberration).r,
      texture2D(uMap, uv).g,
      texture2D(uMap, uv - direction * aberration).b
    );
    float scan = 0.5 + 0.5 * sin(uv.y * uResolution.y + uTime * 7.5);
    color *= mix(1.0, scan, uScanIntensity);
    float column = mod(gl_FragCoord.x, 3.0);
    vec3 mask = column < 1.0 ? vec3(1.04, 0.97, 0.97) : column < 2.0 ? vec3(0.97, 1.04, 0.97) : vec3(0.97, 0.97, 1.04);
    color *= mix(vec3(1.0), mask, 0.18);
    float vignette = smoothstep(0.95, 0.45, radius);
    color *= mix(1.0, vignette, uVignette);
    float flicker = 1.0 + 0.024 * sin(uTime * 60.0) + 0.011 * sin(uTime * 17.0 + 1.3);
    float rolling = 0.012 * sin(uv.y * 44.0 - uTime * 6.0);
    color *= flicker + rolling + refreshBand * 0.13 * uMotion;
    color -= vec3(0.04) * smoothstep(0.62, 0.78, radius);
    gl_FragColor = vec4(color, 1.0);
  }
`;
