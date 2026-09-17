import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { PostEffectPlane } from "./shared/post-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";

/** 老式 CRT：桶形畸变 + 滚动刷新带 + RGB 光栅 + 扫描线与暗角，行级轻抖。 */
export function CrtEffect({ world, params, localTime }: ComponentRenderContext) {
	const scan = num(params.scan, 0.24);
	const vignette = num(params.vignette, 0.68);
	const motion = num(params.motion, 1);
	return (
		<PostEffectPlane
			world={world}
			fragmentShader={getShaderTexturePass("crt")!}
			buildUniforms={(texture) => ({
				uMap: new THREE.Uniform(texture),
				uTime: new THREE.Uniform(localTime),
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uCurvature: new THREE.Uniform(new THREE.Vector2(5.5, 5.0)),
				uScanIntensity: new THREE.Uniform(scan),
				uVignette: new THREE.Uniform(vignette),
				uMotion: new THREE.Uniform(motion),
			})}
			updateUniforms={(u, texture) => {
				u.uMap.value = texture;
				u.uTime.value = localTime;
				u.uResolution.value.set(world.width, world.height);
				u.uScanIntensity.value = scan;
				u.uVignette.value = vignette;
				u.uMotion.value = motion;
			}}
		/>
	);
}
