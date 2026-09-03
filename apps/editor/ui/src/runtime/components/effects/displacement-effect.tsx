import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { PostEffectPlane } from "./shared/post-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";

/** 位移扭曲：fBm 域扭曲 UV，强度沿游走的位移焦点增强。 */
export function DisplacementEffect({ world, params, localTime }: ComponentRenderContext) {
	const amount = num(params.amount, 0.035);
	const scale = num(params.scale, 2.4);
	return (
		<PostEffectPlane
			world={world}
			fragmentShader={getShaderTexturePass("displacement")!}
			buildUniforms={(texture) => ({
				uMap: new THREE.Uniform(texture),
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uTime: new THREE.Uniform(localTime),
				uAmount: new THREE.Uniform(amount),
				uScale: new THREE.Uniform(scale),
			})}
			updateUniforms={(u, texture) => {
				u.uMap.value = texture;
				u.uResolution.value.set(world.width, world.height);
				u.uTime.value = localTime;
				u.uAmount.value = amount;
				u.uScale.value = scale;
			}}
		/>
	);
}
