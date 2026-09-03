import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { AmbientEffectPlane } from "./shared/ambient-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";

/** 扫描激光线：竖直方向循环扫过的激光光带，带抖动与闪烁，扫描位置由 time 派生。 */
export function LaserEffect({ world, object, params, localTime }: ComponentRenderContext) {
	const intensity = num(params.intensity, 1);
	const opacity = num(params.opacity, 0.85);
	return (
		<AmbientEffectPlane
			world={world}
			object={object}
			fragmentShader={getShaderTexturePass("laser")!}
			buildUniforms={() => ({
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uTime: new THREE.Uniform(localTime),
				uOpacity: new THREE.Uniform(opacity),
				uIntensity: new THREE.Uniform(intensity),
			})}
			updateUniforms={(u) => {
				u.uResolution.value.set(world.width, world.height);
				u.uTime.value = localTime;
				u.uOpacity.value = opacity;
				u.uIntensity.value = intensity;
			}}
		/>
	);
}
