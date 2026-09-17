/**
 * [INPUT]: VHS pass source and semantic motion uniforms.
 * [OUTPUT]: VHS EffectDefinition for global Effect and future Element Texture Motion.
 * [POS]: shader-effects catalog; no React lifecycle or component dependency.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as THREE from "three";
import { VHS_FRAGMENT_SHADER } from "../passes/vhs";
import type { ShaderEffectDefinition } from "../types";

export const vhsEffect: ShaderEffectDefinition = {
	id: "vhs",
	parameters: ["time", "intensity", "progress"],
	create: () => ({ id: "vhs", uniforms: {
		time: new THREE.Uniform(0), intensity: new THREE.Uniform(1), progress: new THREE.Uniform(0),
	} }),
	implementations: [{
		kind: "texture", priority: 100, supports: (context) => context.hasSourceTexture,
		fragmentShader: VHS_FRAGMENT_SHADER,
		createTextureUniforms: ({ instance, texture }) => ({
			uMap: new THREE.Uniform(texture), uResolution: new THREE.Uniform(new THREE.Vector2(1, 1)),
			uTime: instance.uniforms.time, uIntensity: instance.uniforms.intensity, uProgress: instance.uniforms.progress,
		}),
	}],
};
