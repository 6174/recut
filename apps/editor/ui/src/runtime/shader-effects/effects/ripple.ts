/**
 * [INPUT]: ShaderEffectInstance 的 progress/strength 语义参数。
 * [OUTPUT]: Ripple effect definition；以屏幕空间波纹调制颜色边缘。
 * [POS]: shader-effects 的独立视觉算法，可复用于任意可编译 Three 材质。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as THREE from "three";
import type { ShaderEffectDefinition } from "../types";
import { RIPPLE_FRAGMENT_SHADER } from "../passes/ripple";

export const rippleEffect: ShaderEffectDefinition = {
	id: "ripple",
	parameters: ["progress", "strength"],
	create: () => ({
		id: "ripple",
		uniforms: {
			progress: new THREE.Uniform(0),
			strength: new THREE.Uniform(0),
		},
	}),
	implementations: [{
		kind: "texture",
		priority: 100,
		supports: (context) => context.hasSourceTexture,
		fragmentShader: RIPPLE_FRAGMENT_SHADER,
		createTextureUniforms: ({ instance, texture }) => ({
			uMap: new THREE.Uniform(texture), uResolution: new THREE.Uniform(new THREE.Vector2(1, 1)),
			uCenter: new THREE.Uniform(new THREE.Vector2(0.5, 0.5)), uTime: new THREE.Uniform(0),
			uRadius: new THREE.Uniform(320), uStrength: instance.uniforms.strength, uFrequency: new THREE.Uniform(2.2),
		}),
	}],
};
