import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { PostEffectPlane } from "./shared/post-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";

/** 复古抖动：Bayer 有序抖动 + 色阶量化，叠加扫描线。 */
export function RetroDitherEffect({ world, params, localTime }: ComponentRenderContext) {
	const levels = num(params.levels, 4);
	const grid = num(params.grid, 4);
	return (
		<PostEffectPlane
			world={world}
			fragmentShader={getShaderTexturePass("retro-dither")!}
			buildUniforms={(texture) => ({
				uMap: new THREE.Uniform(texture),
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uLevels: new THREE.Uniform(levels),
				uGrid: new THREE.Uniform(grid),
				uTime: new THREE.Uniform(localTime),
			})}
			updateUniforms={(u, texture) => {
				u.uMap.value = texture;
				u.uResolution.value.set(world.width, world.height);
				u.uLevels.value = levels;
				u.uGrid.value = grid;
				u.uTime.value = localTime;
			}}
		/>
	);
}
