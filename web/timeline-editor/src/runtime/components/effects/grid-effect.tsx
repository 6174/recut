import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num, str } from "../../utils";
import { AmbientEffectPlane } from "./shared/ambient-effect";
import { rawSrgbColor } from "./shared/uniforms";
import { getShaderTexturePass } from "../../shader-effects/registry";

/** 编辑网格：持续斜向掠过的细格与主格线，纸面/蓝图风格的环境层。 */
export function GridEffect({ world, object, params, localTime }: ComponentRenderContext) {
	const opacity = num(params.opacity, 0.5);
	const color = str(params.color, "#334155");
	const cell = num(params.cell, 96);
	const line = num(params.line, 1.2);
	const majorEvery = num(params.majorEvery, 5);
	const speed = num(params.speed, 0.75);
	return (
		<AmbientEffectPlane
			world={world}
			object={object}
			fragmentShader={getShaderTexturePass("grid")!}
			buildUniforms={() => ({
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uTime: new THREE.Uniform(localTime),
				uColor: new THREE.Uniform(rawSrgbColor(color)),
				uOpacity: new THREE.Uniform(opacity),
				uCell: new THREE.Uniform(new THREE.Vector2(cell, cell)),
				uLine: new THREE.Uniform(line),
				uMajorEvery: new THREE.Uniform(majorEvery),
				uSpeed: new THREE.Uniform(speed),
			})}
			updateUniforms={(u) => {
				u.uResolution.value.set(world.width, world.height);
				u.uTime.value = localTime;
				u.uColor.value.setStyle(color, THREE.LinearSRGBColorSpace);
				u.uOpacity.value = opacity;
				u.uCell.value.set(cell, cell);
				u.uLine.value = line;
				u.uMajorEvery.value = majorEvery;
				u.uSpeed.value = speed;
			}}
		/>
	);
}
