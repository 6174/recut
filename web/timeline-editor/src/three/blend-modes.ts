/**
 * 17 种 Photoshop 混合模式的 Porter-Duff 合成 GLSL。
 * 移植自 Rust compositor 的 blend.wgsl 语义：
 *   out_alpha = src.a + dst.a * (1 - src.a)
 *   out_rgb   = (blend(src.rgb, dst.rgb) * src.a + dst.rgb * dst.a * (1 - src.a)) / out_alpha
 */

export const BLEND_MODE_INDEX: Record<string, number> = {
	normal: 0,
	darken: 1,
	multiply: 2,
	"color-burn": 3,
	lighten: 4,
	screen: 5,
	"plus-lighter": 6,
	"color-dodge": 7,
	overlay: 8,
	"soft-light": 9,
	"hard-light": 10,
	difference: 11,
	exclusion: 12,
	hue: 13,
	saturation: 14,
	color: 15,
	luminosity: 16,
};

export const BLEND_FUNCTIONS_GLSL = /* glsl */ `
vec3 blendNormal(vec3 s, vec3 d) { return s; }
vec3 blendDarken(vec3 s, vec3 d) { return min(s, d); }
vec3 blendMultiply(vec3 s, vec3 d) { return s * d; }
vec3 blendColorBurn(vec3 s, vec3 d) {
  return 1.0 - min(vec3(1.0), (1.0 - d) / max(s, vec3(1e-5)));
}
vec3 blendLighten(vec3 s, vec3 d) { return max(s, d); }
vec3 blendScreen(vec3 s, vec3 d) { return 1.0 - (1.0 - s) * (1.0 - d); }
vec3 blendPlusLighter(vec3 s, vec3 d) { return min(vec3(1.0), s + d); }
vec3 blendColorDodge(vec3 s, vec3 d) {
  return min(vec3(1.0), d / max(1.0 - s, vec3(1e-5)));
}
vec3 blendOverlay(vec3 s, vec3 d) {
  return mix(2.0 * s * d, 1.0 - 2.0 * (1.0 - s) * (1.0 - d), step(vec3(0.5), d));
}
vec3 blendSoftLight(vec3 s, vec3 d) {
  vec3 c = step(vec3(0.5), s);
  vec3 lo = d - (1.0 - 2.0 * s) * d * (1.0 - d);
  vec3 hi = d + (2.0 * s - 1.0) * (pow(d, vec3(0.5)) - d);
  return mix(lo, hi, c);
}
vec3 blendHardLight(vec3 s, vec3 d) {
  return mix(2.0 * s * d, 1.0 - 2.0 * (1.0 - s) * (1.0 - d), step(vec3(0.5), s));
}
vec3 blendDifference(vec3 s, vec3 d) { return abs(s - d); }
vec3 blendExclusion(vec3 s, vec3 d) { return s + d - 2.0 * s * d; }

float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
float sat(vec3 c) { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
vec3 setLum(vec3 c, float l) {
  float d = l - lum(c);
  return c + d;
}
vec3 setSat(vec3 c, float s) {
  float m = min(c.r, min(c.g, c.b));
  vec3 base = c - m;
  float mx = max(base.r, max(base.g, base.b));
  if (mx > 0.0) {
    base = base * (s / mx);
  }
  return base;
}
vec3 clipColor(vec3 c) {
  float l = lum(c);
  float mn = min(c.r, min(c.g, c.b));
  float mx = max(c.r, max(c.g, c.b));
  if (mn < 0.0) {
    c = l + (c - l) * (l / (l - mn));
  }
  if (mx > 1.0) {
    c = l + (c - l) * ((1.0 - l) / (mx - l));
  }
  return c;
}
vec3 blendHue(vec3 s, vec3 d) { return clipColor(setLum(setSat(s, sat(d)), lum(d))); }
vec3 blendSaturation(vec3 s, vec3 d) { return clipColor(setLum(setSat(d, sat(s)), lum(d))); }
vec3 blendColor(vec3 s, vec3 d) { return clipColor(setLum(s, lum(d))); }
vec3 blendLuminosity(vec3 s, vec3 d) { return clipColor(setLum(d, lum(s))); }

vec3 applyBlend(int mode, vec3 s, vec3 d) {
  if (mode == 0) return blendNormal(s, d);
  if (mode == 1) return blendDarken(s, d);
  if (mode == 2) return blendMultiply(s, d);
  if (mode == 3) return blendColorBurn(s, d);
  if (mode == 4) return blendLighten(s, d);
  if (mode == 5) return blendScreen(s, d);
  if (mode == 6) return blendPlusLighter(s, d);
  if (mode == 7) return blendColorDodge(s, d);
  if (mode == 8) return blendOverlay(s, d);
  if (mode == 9) return blendSoftLight(s, d);
  if (mode == 10) return blendHardLight(s, d);
  if (mode == 11) return blendDifference(s, d);
  if (mode == 12) return blendExclusion(s, d);
  if (mode == 13) return blendHue(s, d);
  if (mode == 14) return blendSaturation(s, d);
  if (mode == 15) return blendColor(s, d);
  if (mode == 16) return blendLuminosity(s, d);
  return s;
}
`;

export const BLEND_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform sampler2D uBackdrop;
uniform sampler2D uMap;
uniform sampler2D uMask;
uniform int uMode;
uniform int uUseMask;
uniform int uInvert;
in vec2 vUv;
out vec4 fragColor;

${BLEND_FUNCTIONS_GLSL}

void main() {
  vec4 src = texture(uMap, vUv);
  vec4 dst = texture(uBackdrop, vUv);
  float maskA = 1.0;
  if (uUseMask == 1) {
    float m = texture(uMask, vUv).a;
    if (uInvert == 1) m = 1.0 - m;
    maskA = clamp(m, 0.0, 1.0);
  }
  float sa = clamp(src.a * maskA, 0.0, 1.0);
  float da = dst.a;
  float outA = sa + da * (1.0 - sa);
  vec3 blended = applyBlend(uMode, src.rgb, dst.rgb);
  vec3 outRgb = outA > 1e-5 ? (blended * sa + dst.rgb * da * (1.0 - sa)) / outA : vec3(0.0);
  fragColor = vec4(outRgb, outA);
}
`;

export const FULLSCREEN_VERTEX_SHADER = /* glsl */ `
precision highp float;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
