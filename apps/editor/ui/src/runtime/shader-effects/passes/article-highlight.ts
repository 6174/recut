/**
 * [INPUT]: Three shader uniforms and shared GLSL helpers.
 * [OUTPUT]: Verified shader source for the article-highlight effect.
 * [POS]: shader-effects pass catalog; React effect components only bind uniforms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export const ARTICLE_HIGHLIGHT_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform vec2 uResolution;
  uniform float uIntensity;
  uniform float uTime;
  uniform vec2 uCenter;
  uniform vec2 uMarkerHalf;
  uniform float uProgress;
  varying vec2 vUv;

  float gauss1(float value, float sigma) {
    float sigmaSquared = sigma * sigma + 1e-6;
    return exp(-(value * value) / (2.0 * sigmaSquared));
  }

  float markerMask(vec2 uv) {
    vec2 lower = uCenter - uMarkerHalf;
    vec2 upper = uCenter + uMarkerHalf;
    float revealedX = mix(lower.x, upper.x, smoothstep(0.1, 0.46, uProgress));
    float vertical = smoothstep(lower.y - 0.008, lower.y + 0.012, uv.y)
      * (1.0 - smoothstep(upper.y - 0.012, upper.y + 0.008, uv.y));
    float horizontal = smoothstep(lower.x - 0.006, lower.x + 0.014, uv.x)
      * (1.0 - smoothstep(revealedX - 0.014, revealedX + 0.006, uv.x));
    float paper = 0.88 + 0.12 * sin(uv.x * 780.0 + uv.y * 117.0);
    return vertical * horizontal * paper;
  }

  void main() {
    vec2 pixel = 1.0 / uResolution;
    vec4 sharp = texture2D(uMap, vUv);
    // 焦点与高亮 marker 共用锚点，避免清晰带漂离正在强调的文字。
    float sharpY = uCenter.y;
    float edgeY = abs(vUv.y - sharpY) * 2.0;
    float blurMix = pow(smoothstep(0.035, 0.62, edgeY), 1.06);
    float sigmaPixels = blurMix * (2.0 + 9.0 * uIntensity) + 0.05;
    vec3 blurred = vec3(0.0);
    float totalWeight = 0.0;
    for (int y = -6; y <= 6; y++) {
      for (int x = -6; x <= 6; x++) {
        float weight = gauss1(float(x), sigmaPixels) * gauss1(float(y), sigmaPixels);
        vec2 sampleUv = clamp(vUv + pixel * vec2(float(x), float(y)), vec2(1e-4), vec2(1.0 - 1e-4));
        blurred += texture2D(uMap, sampleUv).rgb * weight;
        totalWeight += weight;
      }
    }
    vec3 color = mix(sharp.rgb, blurred / totalWeight, blurMix);
    float marker = markerMask(vUv) * clamp(uIntensity, 0.0, 2.0);
    // 乘法混合模拟真实 marker：白纸变黄，黑色正文保持黑色，文字仍在笔划之上。
    color *= mix(vec3(1.0), vec3(1.0, 0.88, 0.12), 0.88 * marker);
    vec2 centered = vUv * 2.0 - 1.0;
    centered.x *= uResolution.x / uResolution.y;
    color *= 1.0 - smoothstep(0.38, 1.02, length(centered)) * 0.13;
    gl_FragColor = vec4(color, sharp.a);
  }
`;
