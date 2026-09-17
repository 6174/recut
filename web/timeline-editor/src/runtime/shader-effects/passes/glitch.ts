/**
 * [INPUT]: uMap、uTime、uIntensity、uMotionIntensity、uMotionProgress、uAspect。
 * [OUTPUT]: 已验证的 Glitch texture pass GLSL，供全局 Effect 与元素 Texture Effect 复用。
 * [POS]: shader-effects 的唯一 Glitch 视觉实现；React 组件只负责 uniforms/lifecycle。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

export const GLITCH_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uMotionIntensity;
  uniform float uMotionProgress;
  uniform float uAspect;
  varying vec2 vUv;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    float burstClock = uMotionProgress >= 0.0 ? uMotionProgress * 0.56 : mod(uTime, 3.7);
    float attack = smoothstep(0.0, 0.06, burstClock);
    float release = 1.0 - smoothstep(0.34, 0.56, burstClock);
    float amount = attack * release * uIntensity * uMotionIntensity;
    vec2 uv = vUv;
    float band = floor(uv.y * 24.0);
    float seed = floor(uTime / 3.7) + 1.0;
    float pick = hash12(vec2(band, seed));
    float tear = step(0.74, pick) * amount;
    float direction = hash12(vec2(band, seed + 13.0)) * 2.0 - 1.0;
    uv.x += tear * direction * 0.035 / uAspect;
    float micro = hash12(vec2(floor(vUv.y * 160.0), seed + 29.0)) - 0.5;
    uv.x += micro * amount * 0.004;
    vec2 block = floor(uv * vec2(12.0, 8.0));
    if (hash12(block + seed) > 0.94 - amount * 0.08) {
      uv += vec2(hash12(block + 3.1) - 0.5, hash12(block + 7.7) - 0.5) * amount * vec2(0.06, 0.015);
    }
    float split = amount * 0.012;
    vec4 source = texture2D(uMap, clamp(uv, 0.001, 0.999));
    vec3 color = vec3(
      texture2D(uMap, clamp(uv + vec2(split, 0.0), 0.001, 0.999)).r,
      texture2D(uMap, clamp(uv, 0.001, 0.999)).g,
      texture2D(uMap, clamp(uv - vec2(split, 0.0), 0.001, 0.999)).b
    );
    float grain = hash12(vUv * 1400.0 + seed) - 0.5;
    color += grain * amount * 0.13;
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), source.a);
  }
`;
