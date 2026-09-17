import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { AmbientEffectPlane } from "./shared/ambient-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";

/** 漂浮微粒流：hash+time 派生的确定性微粒，带闪烁与漂移，作为环境层。 */
export function ParticleScrollEffect({ world, object, params, localTime }: ComponentRenderContext) {
	const opacity = num(params.opacity, 0.8);
	return (
		<AmbientEffectPlane
			world={world}
			object={object}
			fragmentShader={getShaderTexturePass("particle-scroll")!}
			buildUniforms={() => ({
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uTime: new THREE.Uniform(localTime),
				uOpacity: new THREE.Uniform(opacity),
			})}
			updateUniforms={(u) => {
				u.uResolution.value.set(world.width, world.height);
				u.uTime.value = localTime;
				u.uOpacity.value = opacity;
			}}
		/>
	);
}
