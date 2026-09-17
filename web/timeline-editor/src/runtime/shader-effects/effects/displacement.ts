/**
 * [INPUT]: ShaderEffectInstance 的 progress/amount 语义参数。
 * [OUTPUT]: Displacement effect definition；通过色道偏移模拟局部位移反馈。
 * [POS]: shader-effects 的独立视觉算法；真实 UV 位移可在同一 effect 协议下追加 map stage。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as THREE from "three";
import type { ShaderEffectDefinition } from "../types";
import { DISPLACEMENT_FRAGMENT_SHADER } from "../passes/displacement";

export const displacementEffect: ShaderEffectDefinition = {
	id: "displacement",
	parameters: ["progress", "amount"],
	create: () => ({
		id: "displacement",
		uniforms: { progress: new THREE.Uniform(0), amount: new THREE.Uniform(0) },
	}),
	implementations: [{
		kind: "texture",
		priority: 100,
		supports: (context) => context.hasSourceTexture,
		fragmentShader: DISPLACEMENT_FRAGMENT_SHADER,
		createTextureUniforms: ({ instance, texture }) => ({
			uMap: new THREE.Uniform(texture), uResolution: new THREE.Uniform(new THREE.Vector2(1, 1)),
			uTime: new THREE.Uniform(0), uAmount: instance.uniforms.amount, uScale: new THREE.Uniform(2.4),
		}),
	}],
};
