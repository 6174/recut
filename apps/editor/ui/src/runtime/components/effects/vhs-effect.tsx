import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { PostEffectPlane } from "./shared/post-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";

/**
 * 录像带：开场失锁抖动/扫描线/色偏/dropout/tracking bar，收尾严格归零。
 * shader 中所有失真都乘以 burst（progress 收尾窗口归零），因此 progress 必须由
 * 元素生命周期驱动（预览随时间循环重放，时间线单次 0→1）；若用静态参数（=1）
 * 会落在收尾窗口 → 整帧完全不可见（对齐 remotion-kit「ShotGraph 注入的单次效果进度」）。
 */
export function VhsEffect({ world, params, localTime, progress }: ComponentRenderContext) {
	const intensity = num(params.intensity, 1);
	return (
		<PostEffectPlane
			world={world}
			fragmentShader={getShaderTexturePass("vhs")!}
			buildUniforms={(texture) => ({
				uMap: new THREE.Uniform(texture),
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uTime: new THREE.Uniform(localTime),
				uIntensity: new THREE.Uniform(intensity),
				uProgress: new THREE.Uniform(progress),
			})}
			updateUniforms={(u, texture) => {
				u.uMap.value = texture;
				u.uResolution.value.set(world.width, world.height);
				u.uTime.value = localTime;
				u.uIntensity.value = intensity;
				u.uProgress.value = progress;
			}}
		/>
	);
}
