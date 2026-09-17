import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { PostEffectPlane } from "./shared/post-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";
import { PASSTHROUGH_VERTEX } from "../../shader-effects/shared/glsl";

const eased = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return 1 - (1 - t) * (1 - t);
};

/** 纸张揭页：圆柱卷曲 + 背胶纸 + 弧面反射，卷起量由元素生命周期驱动。
 * 同 remotion-kit 预览的 0→1→0 循环（0.5-0.5cos(2π·progress)）：无硬切，
 * 时间线上每个片段做一次完整的卷起/揭开。
 */
export function StorePeelEffect({ world, progress }: ComponentRenderContext) {
	const amount = 0.5 - 0.5 * Math.cos(progress * Math.PI * 2);
	const direction = new THREE.Vector2(-0.72, 0.69).normalize();
	const support =
		Math.abs(direction.x) * world.width * 0.5 +
		Math.abs(direction.y) * world.height * 0.5;
	const curlRadius = Math.min(world.width, world.height) * 0.24;
	return (
		<PostEffectPlane
			world={world}
			fragmentShader={getShaderTexturePass("store-peel")!}
			vertexShader={PASSTHROUGH_VERTEX}
			geometrySegments={[1, 1]}
			buildUniforms={(texture) => ({
				uMap: new THREE.Uniform(texture),
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uProgress: new THREE.Uniform(1),
				uMaxAxisDistance: new THREE.Uniform(support + curlRadius),
				uCurlRadius: new THREE.Uniform(curlRadius),
				uCorner: new THREE.Uniform(
					new THREE.Vector2(
						world.width * 0.5 - direction.x * support,
						world.height * 0.5 - direction.y * support,
					),
				),
				uDirection: new THREE.Uniform(direction),
			})}
			updateUniforms={(u, texture) => {
				const reveal = eased(amount);
				u.uMap.value = texture;
				u.uResolution.value.set(world.width, world.height);
				u.uMaxAxisDistance.value = support + curlRadius;
				u.uCurlRadius.value = curlRadius;
				u.uCorner.value.set(
					world.width * 0.5 - direction.x * support,
					world.height * 0.5 - direction.y * support,
				);
				u.uDirection.value.copy(direction);
				u.uProgress.value = 1 - reveal;
			}}
		/>
	);
}
