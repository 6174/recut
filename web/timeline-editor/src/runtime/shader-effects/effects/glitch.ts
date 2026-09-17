/**
 * [INPUT]: ShaderEffectInstance 的 progress/intensity 语义参数。
 * [OUTPUT]: Glitch effect definition；提供横向 tearing、RGB split 与噪声色带。
 * [POS]: shader-effects 的独立视觉算法，不依赖任何具体元素组件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as THREE from "three";
import type { ShaderEffectDefinition } from "../types";
import { GLITCH_FRAGMENT_SHADER } from "../passes/glitch";

/** 全局 Effect 与元素局部 TexturePass 共用的高保真 Glitch 材质。 */
export const GLITCH_TEXTURE_FRAGMENT_SHADER = GLITCH_FRAGMENT_SHADER;

export const glitchEffect: ShaderEffectDefinition = {
	id: "glitch",
	parameters: ["progress", "intensity"],
	create: () => ({
		id: "glitch",
		uniforms: {
			progress: new THREE.Uniform(0),
			intensity: new THREE.Uniform(0),
		},
	}),
	implementations: [
		{
			kind: "texture",
			priority: 100,
			supports: (context) => context.hasSourceTexture,
			fragmentShader: GLITCH_TEXTURE_FRAGMENT_SHADER,
			createTextureUniforms: ({ instance, texture, aspect }) => ({
				uMap: new THREE.Uniform(texture),
				uTime: new THREE.Uniform(0),
				uIntensity: new THREE.Uniform(1),
				uMotionIntensity: instance.uniforms.intensity,
				uMotionProgress: instance.uniforms.progress,
				uAspect: new THREE.Uniform(aspect),
			}),
			updateTextureUniforms: ({ instance, uniforms }) => {
				uniforms.uTime.value = Number(instance.uniforms.progress.value) * 3.7;
			},
		},
	],
};
