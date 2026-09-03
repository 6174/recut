import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num, str } from "../../utils";
import { AmbientEffectPlane } from "./shared/ambient-effect";
import { rawSrgbColor } from "./shared/uniforms";
import { getShaderTexturePass } from "../../shader-effects/registry";

/**
 * 液态流动场：域扭曲 fBm 双色渐变，随时间流动的环境层。
 * 时间系数比 remotion-kit 材质提升 2×（0.06→0.12）：原速下 0.5s 帧间变化
 * 低于感知阈值，预览里看起来是静止色块；提升后保持「慢速流动」气质但可被看见。
 */
export function LiquidEffect({ world, object, params, localTime }: ComponentRenderContext) {
	const opacity = num(params.opacity, 0.8);
	const colorA = str(params.colorA, "#0ea5e9");
	const colorB = str(params.colorB, "#7c3aed");
	return (
		<AmbientEffectPlane
			world={world}
			object={object}
			fragmentShader={getShaderTexturePass("liquid")!}
			buildUniforms={() => ({
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uTime: new THREE.Uniform(localTime),
				uColorA: new THREE.Uniform(rawSrgbColor(colorA)),
				uColorB: new THREE.Uniform(rawSrgbColor(colorB)),
				uOpacity: new THREE.Uniform(opacity),
			})}
			updateUniforms={(u) => {
				u.uResolution.value.set(world.width, world.height);
				u.uTime.value = localTime;
				u.uColorA.value.setStyle(colorA, THREE.LinearSRGBColorSpace);
				u.uColorB.value.setStyle(colorB, THREE.LinearSRGBColorSpace);
				u.uOpacity.value = opacity;
			}}
		/>
	);
}
