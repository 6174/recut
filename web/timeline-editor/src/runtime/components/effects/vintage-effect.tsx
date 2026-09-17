import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { PostEffectPlane } from "./shared/post-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";

/** 复古胶片：gate weave + 颗粒划痕灰尘 + 漏光暗角，按 24fps 帧离散换噪。 */
export function VintageEffect({ world, params, localTime }: ComponentRenderContext) {
	const grain = num(params.grain, 0.126);
	const vignette = num(params.vignette, 0.6);
	const warmth = num(params.warmth, 0.28);
	const fade = num(params.fade, 0.385);
	return (
		<PostEffectPlane
			world={world}
			fragmentShader={getShaderTexturePass("vintage")!}
			buildUniforms={(texture) => ({
				uMap: new THREE.Uniform(texture),
				uTime: new THREE.Uniform(localTime),
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uGrain: new THREE.Uniform(grain),
				uVignette: new THREE.Uniform(vignette),
				uWarmth: new THREE.Uniform(warmth),
				uFade: new THREE.Uniform(fade),
			})}
			updateUniforms={(u, texture) => {
				u.uMap.value = texture;
				u.uTime.value = localTime;
				u.uResolution.value.set(world.width, world.height);
				u.uGrain.value = grain;
				u.uVignette.value = vignette;
				u.uWarmth.value = warmth;
				u.uFade.value = fade;
			}}
		/>
	);
}
