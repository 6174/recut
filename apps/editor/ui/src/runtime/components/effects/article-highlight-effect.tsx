import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { PostEffectPlane } from "./shared/post-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";

/** 文章高亮：黄色 marker 自左向右划出焦点行，上下信息渐进虚化。中心由 centerX/centerY（UV）驱动。 */
export function ArticleHighlightEffect({ world, params, localTime }: ComponentRenderContext) {
	const centerX = num(params.centerX, 0.5);
	const centerY = num(params.centerY, 0.5);
	const intensity = num(params.intensity, 1);
	const markerWidth = num(params.markerWidth, 0.54);
	const markerHeight = num(params.markerHeight, 0.115);
	const progress = num(params.progress, 1);
	return (
		<PostEffectPlane
			world={world}
			fragmentShader={getShaderTexturePass("article-highlight")!}
			buildUniforms={(texture) => ({
				uMap: new THREE.Uniform(texture),
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uIntensity: new THREE.Uniform(intensity),
				uTime: new THREE.Uniform(localTime),
				uCenter: new THREE.Uniform(new THREE.Vector2(centerX, centerY)),
				uMarkerHalf: new THREE.Uniform(
					new THREE.Vector2(markerWidth / 2, markerHeight / 2),
				),
				uProgress: new THREE.Uniform(progress),
			})}
			updateUniforms={(u, texture) => {
				u.uMap.value = texture;
				u.uResolution.value.set(world.width, world.height);
				u.uIntensity.value = intensity;
				u.uTime.value = localTime;
				u.uCenter.value.set(centerX, centerY);
				u.uMarkerHalf.value.set(markerWidth / 2, markerHeight / 2);
				u.uProgress.value = progress;
			}}
		/>
	);
}
