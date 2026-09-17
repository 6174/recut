/**
 * [INPUT]: Three shader uniforms and shared GLSL helpers.
 * [OUTPUT]: Verified shader source for the grid effect.
 * [POS]: shader-effects pass catalog; React effect components only bind uniforms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export const GRID_FRAGMENT_SHADER = `
  uniform vec2 uResolution;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform vec2 uCell;
  uniform float uLine;
  uniform float uMajorEvery;
  uniform float uSpeed;
  varying vec2 vUv;

  void main() {
    // 像素空间的连续平移：细格与主格用同一个坐标，循环越过边界时没有跳变。
    vec2 drift = uTime * uSpeed * vec2(22.0, -9.0);
    vec2 c = (vUv * uResolution + drift) / uCell;
    vec2 f = abs(fract(c) - 0.5);
    vec2 halfW = vec2(uLine) / uCell;
    float minor = max(
      1.0 - smoothstep(halfW.x, halfW.x * 3.0, f.x),
      1.0 - smoothstep(halfW.y, halfW.y * 3.0, f.y)
    );
    vec2 majorC = (vUv * uResolution + drift) / (uCell * uMajorEvery);
    vec2 majorF = abs(fract(majorC) - 0.5);
    float major = max(
      1.0 - smoothstep(0.5, 0.5 - 2.0 / (uCell.x * uMajorEvery), majorF.x),
      1.0 - smoothstep(0.5, 0.5 - 2.0 / (uCell.y * uMajorEvery), majorF.y)
    );
    float breathe = 0.92 + 0.08 * sin(uTime * 0.5);
    float alpha = (minor * 0.55 + major * 0.8) * uOpacity * breathe;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;
