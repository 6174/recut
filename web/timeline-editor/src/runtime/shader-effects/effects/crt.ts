/**
 * [INPUT]: CRT pass source and semantic motion uniforms.
 * [OUTPUT]: CRT EffectDefinition for global Effect and future Element Texture Motion.
 * [POS]: shader-effects catalog; no React lifecycle or component dependency.
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as THREE from "three";
import { CRT_FRAGMENT_SHADER } from "../passes/crt";
import type { ShaderEffectDefinition } from "../types";

export const crtEffect: ShaderEffectDefinition = {
	id: "crt",
	parameters: ["time", "scanIntensity", "vignette", "motion"],
	create: () => ({ id: "crt", uniforms: {
		time: new THREE.Uniform(0), scanIntensity: new THREE.Uniform(0.24),
		vignette: new THREE.Uniform(0.68), motion: new THREE.Uniform(1),
	} }),
	implementations: [{
		kind: "texture", priority: 100, supports: (context) => context.hasSourceTexture,
		fragmentShader: CRT_FRAGMENT_SHADER,
		createTextureUniforms: ({ instance, texture }) => ({
			uMap: new THREE.Uniform(texture), uTime: instance.uniforms.time, uResolution: new THREE.Uniform(new THREE.Vector2(1, 1)),
			uCurvature: new THREE.Uniform(new THREE.Vector2(5.5, 5)), uScanIntensity: instance.uniforms.scanIntensity,
			uVignette: instance.uniforms.vignette, uMotion: instance.uniforms.motion,
		}),
	}],
};
