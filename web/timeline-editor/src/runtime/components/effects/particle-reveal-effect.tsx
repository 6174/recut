import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { PostEffectPlane } from "./shared/post-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";

/**
 * 粒子揭示：未揭示区散射碎片 + 悬浮光点，进度完成后严格落回真实内容。
 * uProgress ≥ 0.86 时 shader 短路返回原纹理，progress 必须由元素生命周期驱动
 * （预览随时间循环重放，时间线单次 0→1）；静态参数（=1）会让特效完全不可见
 * （对齐 remotion-kit「ShotGraph 注入的单次效果进度」）。
 */
export function ParticleRevealEffect({ world, params, localTime, progress }: ComponentRenderContext) {
	const cell = num(params.cell, 22);
	const intensity = num(params.intensity, 1);
	return (
		<PostEffectPlane
			world={world}
			fragmentShader={getShaderTexturePass("particle-reveal")!}
			buildUniforms={(texture) => ({
				uMap: new THREE.Uniform(texture),
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uTime: new THREE.Uniform(localTime),
				uCell: new THREE.Uniform(cell),
				uIntensity: new THREE.Uniform(intensity),
				uProgress: new THREE.Uniform(progress),
			})}
			updateUniforms={(u, texture) => {
				u.uMap.value = texture;
				u.uResolution.value.set(world.width, world.height);
				u.uTime.value = localTime;
				u.uCell.value = cell;
				u.uIntensity.value = intensity;
				u.uProgress.value = progress;
			}}
		/>
	);
}
