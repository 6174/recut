import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { PostEffectPlane } from "./shared/post-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";

/** 雨滴玻璃：双层下落雨滴 + 拖痕 + 静滴，法线折射水体与高光。 */
export function DropletsEffect({ world, params, localTime }: ComponentRenderContext) {
	const speed = num(params.speed, 1);
	const scale = num(params.scale, 0.4);
	const dropWidth = num(params.dropWidth, 1);
	const dropLength = num(params.dropLength, 1);
	const refraction = num(params.refraction, 0.2);
	const intensity = num(params.intensity, 1);
	return (
		<PostEffectPlane
			world={world}
			fragmentShader={getShaderTexturePass("droplets")!}
			buildUniforms={(texture) => ({
				uMap: new THREE.Uniform(texture),
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uTime: new THREE.Uniform(localTime),
				uIntensity: new THREE.Uniform(intensity),
				uSpeed: new THREE.Uniform(speed),
				uScale: new THREE.Uniform(scale),
				uDropWidth: new THREE.Uniform(dropWidth),
				uDropLength: new THREE.Uniform(dropLength),
				uRefraction: new THREE.Uniform(refraction),
			})}
			updateUniforms={(u, texture) => {
				u.uMap.value = texture;
				u.uResolution.value.set(world.width, world.height);
				u.uTime.value = localTime;
				u.uIntensity.value = intensity;
				u.uSpeed.value = speed;
				u.uScale.value = scale;
				u.uDropWidth.value = dropWidth;
				u.uDropLength.value = dropLength;
				u.uRefraction.value = refraction;
			}}
		/>
	);
}
