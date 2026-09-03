import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { PostEffectPlane } from "./shared/post-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";

/** 涟漪：径向折射扰动，涟漪中心由可关键帧的 centerX/centerY（UV [0,1]）参数驱动。 */
export function RippleEffect({ world, params, localTime }: ComponentRenderContext) {
	const centerX = num(params.centerX, 0.5);
	const centerY = num(params.centerY, 0.5);
	const strength = num(params.strength, 0.045);
	const radius = num(params.radius, 320);
	const frequency = num(params.frequency, 2.2);
	return (
		<PostEffectPlane
			world={world}
			fragmentShader={getShaderTexturePass("ripple")!}
			buildUniforms={(texture) => ({
				uMap: new THREE.Uniform(texture),
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uCenter: new THREE.Uniform(
					new THREE.Vector2(centerX * world.width, centerY * world.height),
				),
				uTime: new THREE.Uniform(localTime),
				uRadius: new THREE.Uniform(radius),
				uStrength: new THREE.Uniform(strength),
				uFrequency: new THREE.Uniform(frequency),
			})}
			updateUniforms={(u, texture) => {
				u.uMap.value = texture;
				u.uResolution.value.set(world.width, world.height);
				u.uCenter.value.set(centerX * world.width, centerY * world.height);
				u.uTime.value = localTime;
				u.uRadius.value = radius;
				u.uStrength.value = strength;
				u.uFrequency.value = frequency;
			}}
		/>
	);
}
