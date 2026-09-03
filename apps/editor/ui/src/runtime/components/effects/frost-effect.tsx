import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { PostEffectPlane } from "./shared/post-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";

/** 霜玻璃：高斯模糊 + 冷色调 + 霜晶噪点，随呼吸周期起雾消散。 */
export function FrostEffect({ world, params, localTime }: ComponentRenderContext) {
	const intensity = num(params.intensity, 1);
	return (
		<PostEffectPlane
			world={world}
			fragmentShader={getShaderTexturePass("frost")!}
			buildUniforms={(texture) => ({
				uMap: new THREE.Uniform(texture),
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uTime: new THREE.Uniform(localTime),
				uIntensity: new THREE.Uniform(intensity),
			})}
			updateUniforms={(u, texture) => {
				u.uMap.value = texture;
				u.uResolution.value.set(world.width, world.height);
				u.uTime.value = localTime;
				u.uIntensity.value = intensity;
			}}
		/>
	);
}
