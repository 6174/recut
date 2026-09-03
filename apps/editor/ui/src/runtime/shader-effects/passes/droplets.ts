/**
 * [INPUT]: Three shader uniforms and shared GLSL helpers.
 * [OUTPUT]: Verified shader source for the droplets effect.
 * [POS]: shader-effects pass catalog; React effect components only bind uniforms.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import { GLSL_HASH12 } from "../shared/glsl";
export const DROPLETS_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uSpeed;
  uniform float uScale;
  uniform float uDropWidth;
  uniform float uDropLength;
  uniform float uRefraction;
  varying vec2 vUv;

  ${GLSL_HASH12}

  float random1(float n) {
    return fract(sin(n * 12345.564) * 7658.76);
  }

  float saw(float edge, float t) {
    return smoothstep(0.0, edge, t) * smoothstep(1.0, edge, t);
  }

  // CanvasUI 的卵形水滴 SDF：上圆下尖，不是规则圆泡泡。
  float sdEgg(vec2 p, float ra, float rb) {
    const float k = 1.7320508;
    p.x = abs(p.x);
    float r = ra - rb;
    return ((p.y < 0.0) ? length(vec2(p.x, p.y)) - r :
            (k * (p.x + r) < p.y) ? length(vec2(p.x, p.y - k * r)) :
            length(vec2(p.x + r, p.y)) - 2.0 * r) - rb;
  }

  // 一个缓慢下滑的主水滴、它的连续拖痕，以及沿拖痕附着的细小水珠。
  vec2 dropLayer(vec2 uv, float t) {
    vec2 sourceUv = uv;
    vec2 cellAspect = vec2(6.0, 1.0);
    vec2 grid = cellAspect * 2.0;
    vec2 id = floor(uv * grid);
    float gridFall = random1(id.x) / 3.0 + 0.5;
    uv.y += t * gridFall / cellAspect.y;
    id = floor(uv * grid);
    uv.y += random1(id.x);
    id = floor(uv * grid);
    vec2 st = fract(uv * grid) - vec2(0.5, 0.0);
    vec3 seed = vec3(
      hash12(id.x * 35.2 + id.y * 2376.1 + vec2(0.0, 0.0)),
      hash12(id.x * 35.2 + id.y * 2376.1 + vec2(11.7, 4.2)),
      hash12(id.x * 35.2 + id.y * 2376.1 + vec2(5.4, 17.6))
    );

    float x = seed.x - 0.5;
    float lambda = sourceUv.y * 20.0;
    x += sin(lambda + sin(lambda)) * (0.5 - abs(x)) * (seed.z - 0.5) * 0.65;
    x *= 0.6;
    float slowStart = 0.85;
    float phase = fract(t * (gridFall + 0.1) + seed.z);
    float y = (saw(slowStart, phase) - 0.5) * 0.9 + 0.5;
    float squash = phase > slowStart
      ? -sin(6.2831853 * phase / (1.0 - slowStart)) * 0.5 - 0.5
      : 0.0;
    float drop = smoothstep(
      (random1(id.x + id.y) / 7.0 + 0.2) / 1.5,
      0.0,
      sdEgg((st - vec2(x, y)) * cellAspect.yx / vec2(uDropWidth, uDropLength), 0.0, squash)
    );

    float aboveHead = smoothstep(1.0, y, st.y);
    float taper = sqrt(aboveHead);
    float thickness = (random1(id.x + id.y) / 7.0 + 0.2) * 0.95 * uDropWidth;
    float offsetX = abs(st.x - x);
    float trail = smoothstep(thickness * taper, 0.0, offsetX)
      * aboveHead * smoothstep(-0.02, 0.02, st.y - y) * 0.5;

    float microTrail = smoothstep((thickness - 0.15) * taper, 0.0, offsetX)
      * smoothstep(-0.02, 0.02, st.y - y) * seed.z;
    float microY = fract(sourceUv.y * 11.0 * (random1(id.x) / 1.5 + 0.5)) + st.y - 0.5;
    float micro = smoothstep(microTrail + random1(st.y) / 40.0 + 0.05, 0.0,
      length(st - vec2(x, microY)));

    return vec2(drop + micro * taper * smoothstep(-0.02, 0.02, st.y - y), trail);
  }

  float staticDrops(vec2 uv, float t) {
    uv *= 40.0;
    vec2 id = floor(uv);
    vec2 seed = vec2(
      hash12(id * 107.45 + 3.1),
      hash12(id * 3543.654 + 7.7)
    );
    vec2 point = (seed - 0.5) * 0.6;
    float drop = smoothstep(0.3 * clamp(uDropWidth, 0.4, 1.4), 0.0,
      length(fract(uv) - 0.5 - point));
    return drop * saw(0.1, fract(t + seed.y)) * fract(seed.x * 27.0);
  }

  vec2 rainField(vec2 uv, float t) {
    float amount = clamp(uIntensity * 0.75, 0.0, 1.25);
    float staticLayer = smoothstep(-0.5, 1.0, amount) * 0.36;
    float layerOne = smoothstep(0.25, 0.75, amount);
    float layerTwo = smoothstep(0.0, 0.5, amount);
    vec2 one = dropLayer(uv, t);
    vec2 two = dropLayer(uv * 1.85, t * 1.17);
    float mask = staticDrops(uv, t) * staticLayer + one.x * layerOne + two.x * layerTwo;
    return vec2(smoothstep(0.3, 1.0, mask), one.y * layerOne + two.y * layerTwo);
  }

  void main() {
    vec2 aspectUv = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    vec2 scaledUv = aspectUv * max(uScale, 0.01);
    float rainTime = uTime * 0.2 * max(uSpeed, 0.01);
    vec2 field = rainField(scaledUv, rainTime);
    vec2 eps = vec2(0.001, 0.0);
    vec2 normal = vec2(
      rainField(scaledUv + eps, rainTime).x - field.x,
      rainField(scaledUv + eps.yx, rainTime).x - field.x
    );
    vec2 refractedUv = clamp(vUv + normal * uRefraction, 0.001, 0.999);
    vec3 source = texture2D(uMap, vUv).rgb;
    vec3 refracted = texture2D(uMap, refractedUv).rgb;
    vec3 normal3 = normalize(vec3(normal * 36.0, 1.0));
    float highlight = pow(max(dot(reflect(vec3(0.0, 0.0, -1.0), normal3),
      normalize(vec3(-0.35, 0.75, 0.55))), 0.0), 28.0);
    float rim = smoothstep(0.008, 0.07, length(normal));
    vec3 wet = refracted + vec3(0.82, 0.91, 1.0) * (highlight * 0.42 + rim * 0.08);
    vec3 color = mix(source, wet, field.x);
    // 拖痕比滴头更暗，形成玻璃上真实的连续水路。
    color *= 1.0 - field.y * 0.12;
    gl_FragColor = vec4(color, 1.0);
  }
`;
