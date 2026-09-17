import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { AmbientEffectPlane } from "./shared/ambient-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";

/** 矩阵字符雨：确定性下落的字符列，位置与笔画由 hash+time 派生，可 seek。 */
export function GlyphRainEffect({ world, object, params, localTime }: ComponentRenderContext) {
	const intensity = num(params.intensity, 1);
	const opacity = num(params.opacity, 0.8);
	return (
		<AmbientEffectPlane
			world={world}
			object={object}
			fragmentShader={getShaderTexturePass("glyph-rain")!}
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
