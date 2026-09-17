/**
 * [INPUT]: Three shader uniforms and shared GLSL helpers.
 * [OUTPUT]: Verified shader source for the cloth effect.
 * [POS]: shader-effects pass catalog; React effect components only bind uniforms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export const CLOTH_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uSpeed;
  uniform float uScale;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 transformed = position;
    float wave = sin(uv.x * uScale * 6.283 + uTime * uSpeed)
      * cos(uv.y * uScale * 4.712 + uTime * uSpeed * 0.7);
    transformed.z += wave * uAmplitude;
    transformed.x += sin(uv.y * uScale * 5.0 + uTime * uSpeed * 0.5) * uAmplitude * 0.3;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`;
export const CLOTH_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(uMap, vUv);
  }
`;
