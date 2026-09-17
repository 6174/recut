import * as THREE from "three";
import type { ComponentDefinition, ComponentRenderContext } from "../../types";
import { BackgroundEffectPlane } from "../effects/shared/background-plane";
import { rawSrgbColor } from "../effects/shared/uniforms";
import { num, str } from "../../utils";

/**
 * [INPUT]: MetalForge wallpaper WGSL（catalog/wgsl/wallpaper.wgsl）与参数 schema
 * [OUTPUT]: mf.bg.wallpaper 组件（全屏背景，GLSL 移植，自适应画布宽高比）
 * [POS]: MetalForge→editor 内置组件的第一个案例：WGSL 手工移植为 GLSL fragment，
 *        常量与数学保持逐句一致；uv 约定由 AmbientEffectPlane 的 vUv 适配。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */

const FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform vec2 uSize;
uniform float uTime;
uniform float uMode;
uniform float uAnimate;
uniform float uScale;
uniform float uWarp;
uniform float uSeed;
uniform float uContrast;
uniform float uBands;
uniform float uRotation;
uniform float uLift;
uniform float uSoftness;
uniform float uGrain;
uniform float uVignette;
uniform float uASpeed;
uniform float uAAmount;
uniform float uAWaves;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec3 uColor4;
uniform vec3 uColor5;

vec2 wpHash2(vec2 p) {
  vec2 q = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(q) * 43758.5453) * 2.0 - 1.0;
}

float wpHash1(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float wpNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u2 = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dot(wpHash2(i), f),
        dot(wpHash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u2.x),
    mix(dot(wpHash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
        dot(wpHash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u2.x),
    u2.y);
}

float wpFbm(vec2 p0) {
  vec2 p = p0;
  float a = 0.6;
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    s += a * wpNoise(p);
    p = p * 2.1;
    a = a * 0.42;
  }
  return s;
}

vec3 wpPal(float t0) {
  float t = clamp(t0, 0.0, 1.0);
  vec3 c = mix(uColor1, uColor2, smoothstep(0.00, 0.46, t));
  c = mix(c, uColor3, smoothstep(0.44, 0.76, t));
  c = mix(c, uColor4, smoothstep(0.74, 0.93, t));
  c = mix(c, uColor5, smoothstep(0.92, 1.00, t));
  return c;
}

void main() {
  // vUv: three 平面 bottom-left origin。WGSL 版内部从 top-left uv 翻回 bottom
  // （"let fc = (uv01.x*res.x, res.y - uv01.y*res.y)"），这里 vUv 已经是
  // bottom-origin，直接等于 fc——同一 seed 渲出同一帧。
  vec2 res = max(uSize, vec2(1.0));
  vec2 fc = vUv * res;
  vec2 uv = (fc - 0.5 * res) / res.y;

  float soft = clamp(uSoftness, 0.0, 1.0);
  float sc = uScale * (1.05 - soft * 0.55);
  float wa = uWarp * (0.35 + soft * 0.7);
  float th = radians(uRotation);
  vec2 uvw = uv;
  if (uAnimate > 0.5) {
    float ts = uTime * uASpeed;
    uvw += uAAmount * vec2(sin(ts + uv.y * uAWaves),
                           cos(ts * 0.77 + uv.x * uAWaves));
  }
  vec2 p = vec2(cos(th) * uvw.x + sin(th) * uvw.y,
                -sin(th) * uvw.x + cos(th) * uvw.y) * sc + vec2(uSeed);

  vec2 q = vec2(wpFbm(p), wpFbm(p + vec2(3.7, 1.3)));
  vec2 r = vec2(wpFbm(p + wa * q + vec2(1.7, 9.2)),
                wpFbm(p + wa * q + vec2(8.3, 2.8)));
  float f = wpFbm(p + wa * r);

  float t;
  if (uMode < 0.5) {
    t = 0.46 + f * uContrast * 1.9;
    float k = t - 0.78;
    if (k > 0.0) { t = 0.78 + k / (1.0 + k * 1.6); }
    t = pow(clamp(t, 0.0, 1.0), 1.35);
  } else {
    t = 0.5 + 0.5 * sin(f * 6.2831 * uBands * 1.7 + uSeed * 2.0);
    t = pow(clamp(t, 0.0, 1.0), uContrast);
    float k = t - 0.72;
    if (k > 0.0) { t = 0.72 + k / (1.0 + k * 0.6); }
  }

  vec3 col = wpPal(t + uLift);

  float d = length(uv * vec2(0.78, 0.52));
  col *= mix(1.0, 1.0 - smoothstep(0.1, 1.25, d), clamp(uVignette, 0.0, 1.0));

  float gs = 1500.0 / res.y;
  float g = wpHash1(floor(fc * gs) + uSeed * 37.0);
  col += vec3((g - 0.5) * clamp(uGrain, 0.0, 1.0) * 0.34 * (0.22 + dot(col, vec3(0.333))));

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

interface WallpaperPreset {
  mode?: string;
  scale: number;
  warp: number;
  contrast: number;
  bands: number;
  rotation: number;
  lift: number;
  seed: number;
  color1: string;
  color2: string;
  color3: string;
  color4: string;
  color5: string;
}

const STYLE_PRESETS: Record<string, WallpaperPreset> = {
	abyss: { mode: "bloom", scale: 1.15, warp: 2.6, contrast: 1.35, bands: 1, rotation: 20, lift: 0.04, seed: 27, color1: "#04051A", color2: "#08195E", color3: "#1E5CFF", color4: "#3FD8FF", color5: "#EEF1F6" },
	silk: { mode: "flow", scale: 1.45, warp: 1.7, contrast: 1.45, bands: 1.25, rotation: -29, lift: -0.04, seed: 23, color1: "#000208", color2: "#03102F", color3: "#0A3F9E", color4: "#2B8BFF", color5: "#A8D8FF" },
	cinder: { mode: "bloom", scale: 1.05, warp: 2.2, contrast: 1.75, bands: 1, rotation: 77, lift: 0.07, seed: 27, color1: "#02110F", color2: "#0B3A36", color3: "#C8722A", color4: "#FF4F14", color5: "#FFD7A3" },
	pewter: { mode: "flow", scale: 1.35, warp: 1.9, contrast: 1.5, bands: 1, rotation: 52, lift: 0.02, seed: 22.6, color1: "#02040A", color2: "#0F1B2C", color3: "#3F6D94", color4: "#ADC8DD", color5: "#F4F8FB" },
	aura: { mode: "bloom", scale: 0.95, warp: 2.9, contrast: 1.7, bands: 1, rotation: -11, lift: 0, seed: 27, color1: "#000000", color2: "#141848", color3: "#7B2FF7", color4: "#FF5F6D", color5: "#FFD36E" },
	moss: { mode: "bloom", scale: 1.25, warp: 2.4, contrast: 1.4, bands: 1, rotation: 34, lift: 0.03, seed: 27, color1: "#01100A", color2: "#06301F", color3: "#2F7D4F", color4: "#9AD86B", color5: "#EEF7CD" },
	rose: { mode: "flow", scale: 1.2, warp: 2, contrast: 1.3, bands: 0.85, rotation: -63, lift: 0.02, seed: 22.6, color1: "#0A0209", color2: "#390E2C", color3: "#A52A6B", color4: "#FF7A9B", color5: "#FFE4D5" },
	solar: { mode: "bloom", scale: 1.1, warp: 2.7, contrast: 1.6, bands: 1, rotation: 126, lift: 0.01, seed: 27, color1: "#050203", color2: "#280913", color3: "#D1341F", color4: "#FF9A1F", color5: "#FFF1C6" },
};

function WallpaperEffect({ world, object, params, localTime }: ComponentRenderContext) {
	const uniforms = () => ({
		uSize: { value: new THREE.Vector2(world.width, world.height) },
		uTime: { value: localTime },
		uMode: { value: str(params.mode, "bloom") === "flow" ? 1 : 0 },
		uAnimate: { value: str(params.animate, "wave") === "wave" ? 1 : 0 },
		uScale: { value: num(params.scale, 1.15) },
		uWarp: { value: num(params.warp, 2.6) },
		uSeed: { value: num(params.seed, 27) },
		uContrast: { value: num(params.contrast, 1.35) },
		uBands: { value: num(params.bands, 1) },
		uRotation: { value: num(params.rotation, 20) },
		uLift: { value: num(params.lift, 0.04) },
		uSoftness: { value: num(params.softness, 0.5) },
		uGrain: { value: num(params.grain, 0.5) },
		uVignette: { value: num(params.vignette, 0.85) },
		uASpeed: { value: num(params.aSpeed, 1) },
		uAAmount: { value: num(params.aAmount, 0.05) },
		uAWaves: { value: num(params.aWaves, 6) },
		uColor1: { value: rawSrgbColor(str(params.color1, "#04051A")) },
		uColor2: { value: rawSrgbColor(str(params.color2, "#08195E")) },
		uColor3: { value: rawSrgbColor(str(params.color3, "#1E5CFF")) },
		uColor4: { value: rawSrgbColor(str(params.color4, "#3FD8FF")) },
		uColor5: { value: rawSrgbColor(str(params.color5, "#EEF1F6")) },
	});

	return (
		<BackgroundEffectPlane
			world={world}
			object={object}
			fragmentShader={FRAGMENT}
			buildUniforms={uniforms}
			updateUniforms={(u) => {
				u.uTime.value = localTime;
				u.uSize.value.set(world.width, world.height);
				u.uMode.value = str(params.mode, "bloom") === "flow" ? 1 : 0;
				u.uAnimate.value = str(params.animate, "wave") === "wave" ? 1 : 0;
				u.uScale.value = num(params.scale, 1.15);
				u.uWarp.value = num(params.warp, 2.6);
				u.uSeed.value = num(params.seed, 27);
				u.uContrast.value = num(params.contrast, 1.35);
				u.uBands.value = num(params.bands, 1);
				u.uRotation.value = num(params.rotation, 20);
				u.uLift.value = num(params.lift, 0.04);
				u.uSoftness.value = num(params.softness, 0.5);
				u.uGrain.value = num(params.grain, 0.5);
				u.uVignette.value = num(params.vignette, 0.85);
				u.uASpeed.value = num(params.aSpeed, 1);
				u.uAAmount.value = num(params.aAmount, 0.05);
				u.uAWaves.value = num(params.aWaves, 6);
				(u.uColor1.value as THREE.Color).setStyle(str(params.color1, "#04051A"), THREE.LinearSRGBColorSpace);
				(u.uColor2.value as THREE.Color).setStyle(str(params.color2, "#08195E"), THREE.LinearSRGBColorSpace);
				(u.uColor3.value as THREE.Color).setStyle(str(params.color3, "#1E5CFF"), THREE.LinearSRGBColorSpace);
				(u.uColor4.value as THREE.Color).setStyle(str(params.color4, "#3FD8FF"), THREE.LinearSRGBColorSpace);
				(u.uColor5.value as THREE.Color).setStyle(str(params.color5, "#EEF1F6"), THREE.LinearSRGBColorSpace);
			}}
		/>
	);
}

export const metalforgeWallpaperComponent: ComponentDefinition = {
	id: "mf.bg.wallpaper",
	name: "MF Wallpaper 壁纸",
	keywords: ["metalforge", "wallpaper", "壁纸", "渐变", "gradient", "bloom", "flow", "背景"],
	category: "effect",
	group: "bg",
	selectable: false,
	surface: "r3f",
	color: "#1E5CFF",
	inputs: [
		{ key: "style", type: "select", default: "abyss", label: "Style", options: [
			{ value: "abyss", label: "Abyss" },
			{ value: "silk", label: "Silk" },
			{ value: "cinder", label: "Cinder" },
			{ value: "pewter", label: "Pewter" },
			{ value: "aura", label: "Aura" },
			{ value: "moss", label: "Moss" },
			{ value: "rose", label: "Rose" },
			{ value: "solar", label: "Solar" },
		] },
		{ key: "mode", type: "select", default: "bloom", label: "Mode", options: [
			{ value: "bloom", label: "Bloom" },
			{ value: "flow", label: "Flow" },
		] },
		{ key: "animate", type: "select", default: "wave", label: "Animation", options: [
			{ value: "off", label: "Off" },
			{ value: "wave", label: "On" },
		] },
		{ key: "scale", type: "number", default: 1.15, min: 0.5, max: 2, step: 0.01, label: "Scale" },
		{ key: "warp", type: "number", default: 2.6, min: 0, max: 4, step: 0.05, label: "Warp" },
		{ key: "seed", type: "number", default: 27, min: 0, max: 120, step: 0.5, label: "Seed" },
		{ key: "aSpeed", type: "number", default: 1, min: 0.1, max: 3, step: 0.05, label: "Speed" },
		{ key: "aAmount", type: "number", default: 0.05, min: 0.005, max: 0.15, step: 0.005, label: "Amount" },
		{ key: "aWaves", type: "number", default: 6, min: 1, max: 15, step: 0.5, label: "Waves" },
		{ key: "contrast", type: "number", default: 1.35, min: 0.8, max: 2.5, step: 0.01, label: "Contrast" },
		{ key: "bands", type: "number", default: 1, min: 0.5, max: 2, step: 0.05, label: "Bands" },
		{ key: "rotation", type: "number", default: 20, min: -180, max: 180, step: 1, label: "Rotation" },
		{ key: "lift", type: "number", default: 0.04, min: -0.2, max: 0.2, step: 0.005, label: "Lift" },
		{ key: "color1", type: "color", default: "#04051A", label: "Colour 1" },
		{ key: "color2", type: "color", default: "#08195E", label: "Colour 2" },
		{ key: "color3", type: "color", default: "#1E5CFF", label: "Colour 3" },
		{ key: "color4", type: "color", default: "#3FD8FF", label: "Colour 4" },
		{ key: "color5", type: "color", default: "#EEF1F6", label: "Colour 5" },
		{ key: "softness", type: "number", default: 0.5, min: 0, max: 1, step: 0.01, label: "Softness" },
		{ key: "grain", type: "number", default: 0.5, min: 0, max: 1, step: 0.01, label: "Grain" },
		{ key: "vignette", type: "number", default: 0.85, min: 0, max: 1, step: 0.01, label: "Vignette" },
	],
	render: WallpaperEffect,
};

/** select preset 联动：切 style 时面板 merge preset 默认值进实例 params。 */
export function metalforgeWallpaperStylePreset(style: string): Partial<Record<string, unknown>> {
	return STYLE_PRESETS[style] ?? STYLE_PRESETS.abyss;
}
