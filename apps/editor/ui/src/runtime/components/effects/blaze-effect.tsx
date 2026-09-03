import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { AmbientEffectPlane } from "./shared/ambient-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";

/**
 * 火焰能量场：域扭曲 fBm 叠加火色渐变，随时间燃烧翻涌的环境层。
 * 时间系数比 remotion-kit 材质提升 1.5×：原速下翻涌接近静态，预览里像蒙了一层雾。
 */
export function BlazeEffect({ world, object, params, localTime }: ComponentRenderContext) {
	const opacity = num(params.opacity, 0.85);
	return (
		<AmbientEffectPlane
			world={world}
			object={object}
			fragmentShader={getShaderTexturePass("blaze")!}
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
