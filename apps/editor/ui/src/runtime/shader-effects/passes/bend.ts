/**
 * [INPUT]: Three shader uniforms and shared GLSL helpers.
 * [OUTPUT]: Verified shader source for the bend effect.
 * [POS]: shader-effects pass catalog; React effect components only bind uniforms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export const BEND_VERTEX_SHADER = `
  uniform float uBend;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 transformed = position;
    float fold = (uv.y - 0.5) * uBend * 2.1;
    transformed.y *= cos(fold);
    transformed.z += abs(transformed.y) * sin(abs(fold)) * 0.92;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`;
export const BEND_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(uMap, vUv);
  }
`;
