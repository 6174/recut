import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { PostEffectPlane } from "./shared/post-effect";
import { getShaderTextureImplementation } from "../../shader-effects/registry";

const CLOTH = getShaderTextureImplementation("cloth")!;


/**
 * 布料起伏：顶点正弦波动模拟布料飘动，确定性、可 seek。
 * 平面是 world.width×height 像素，顶点位移必须以像素为单位：
 * 振幅参数按「短边 × 0.25」折算（remotion-kit 材质在以 4.9 为高的平面上用
 * 0.18 振幅 ≈ 短边 3.7%，此处同比例折算，避免亚像素位移 → 完全不可见）。
 */
export function ClothEffect({ world, params, localTime }: ComponentRenderContext) {
	const amplitude = num(params.amplitude, 0.18);
	const scale = num(params.scale, 1.2);
	const speed = num(params.speed, 1.4);
	const amplitudePx =
		amplitude * Math.min(world.width, world.height) * 0.25;
	return (
		<PostEffectPlane
			world={world}
			fragmentShader={CLOTH.fragmentShader!}
			vertexShader={CLOTH.vertexShader}
			geometrySegments={[32, 32]}
			buildUniforms={(texture) => ({
				uMap: new THREE.Uniform(texture),
				uTime: new THREE.Uniform(localTime),
				uAmplitude: new THREE.Uniform(amplitudePx),
				uSpeed: new THREE.Uniform(speed),
				uScale: new THREE.Uniform(scale),
			})}
			updateUniforms={(u, texture) => {
				u.uMap.value = texture;
				u.uTime.value = localTime;
				u.uAmplitude.value =
					amplitude * Math.min(world.width, world.height) * 0.25;
				u.uSpeed.value = speed;
				u.uScale.value = scale;
			}}
		/>
	);
}
