import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { PostEffectPlane } from "./shared/post-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";

/** 文本焦点：圆角焦点框锁定内容锐利，其余画面渐进虚化，拉焦途中显示对焦框。 */
export function TextFocusEffect({ world, params, localTime }: ComponentRenderContext) {
	const focusX = num(params.focusX, 0.28);
	const focusY = num(params.focusY, 0.4);
	const focusWidth = num(params.focusWidth, 0.44);
	const focusHeight = num(params.focusHeight, 0.16);
	const feather = num(params.feather, 0.035);
	const intensity = num(params.intensity, 1);
	const progress = num(params.progress, 1);
	const focusBox: [number, number, number, number] = [
		focusX,
		1 - focusY - focusHeight,
		focusWidth,
		focusHeight,
	];
	return (
		<PostEffectPlane
			world={world}
			fragmentShader={getShaderTexturePass("text-focus")!}
			buildUniforms={(texture) => ({
				uMap: new THREE.Uniform(texture),
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uFocusOrigin: new THREE.Uniform(
					new THREE.Vector2(focusBox[0] * world.width, focusBox[1] * world.height),
				),
				uFocusSize: new THREE.Uniform(
					new THREE.Vector2(focusBox[2] * world.width, focusBox[3] * world.height),
				),
				uFeather: new THREE.Uniform(feather * Math.min(world.width, world.height)),
				uIntensity: new THREE.Uniform(intensity),
				uProgress: new THREE.Uniform(progress),
			})}
			updateUniforms={(u, texture) => {
				u.uMap.value = texture;
				u.uResolution.value.set(world.width, world.height);
				u.uFocusOrigin.value.set(focusBox[0] * world.width, focusBox[1] * world.height);
				u.uFocusSize.value.set(focusBox[2] * world.width, focusBox[3] * world.height);
				u.uFeather.value = feather * Math.min(world.width, world.height);
				u.uIntensity.value = intensity;
				u.uProgress.value = progress;
			}}
		/>
	);
}
