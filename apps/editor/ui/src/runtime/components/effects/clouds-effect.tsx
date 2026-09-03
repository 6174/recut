import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { AmbientEffectPlane } from "./shared/ambient-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";

/** 云层雾场：fBm 程序化迷雾，随时间漂移，作为环境层铺在全画布上。 */
export function CloudsEffect({ world, object, params, localTime }: ComponentRenderContext) {
	const opacity = num(params.opacity, 0.74);
	return (
		<AmbientEffectPlane
			world={world}
			object={object}
			fragmentShader={getShaderTexturePass("clouds")!}
			buildUniforms={() => ({
				uTime: new THREE.Uniform(localTime),
				uOpacity: new THREE.Uniform(opacity),
			})}
			updateUniforms={(u) => {
				u.uTime.value = localTime;
				u.uOpacity.value = opacity;
			}}
		/>
	);
}
