/**
 * [INPUT]: ComponentRenderContext 的世界时间/强度参数、SceneCapture 纹理与 shader motion uniforms。
 * [OUTPUT]: GlitchEffect；提供 tearing、RGB split、噪声与可独立驱动的 uMotionIntensity。
 * [POS]: runtime/components/effects 的 Glitch 后处理特效，被效果组件注册表与动画预设共同消费。
 * [PROTOCOL]: 变更时更新此头部，然后检查 README.md
 */
import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { PostEffectPlane } from "./shared/post-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";

/** 信号故障：横向 tearing + RGB split + 噪声，周期性爆发。 */
export function GlitchEffect({ world, params, localTime }: ComponentRenderContext) {
	const intensity = num(params.intensity, 1.35);
	return (
		<PostEffectPlane
			world={world}
			fragmentShader={getShaderTexturePass("glitch")!}
			buildUniforms={(texture) => ({
				uMap: new THREE.Uniform(texture),
				uTime: new THREE.Uniform(localTime),
				uIntensity: new THREE.Uniform(intensity),
				uMotionIntensity: new THREE.Uniform(1),
				uMotionProgress: new THREE.Uniform(-1),
				uAspect: new THREE.Uniform(world.width / world.height),
			})}
			updateUniforms={(u, texture) => {
				u.uMap.value = texture;
				u.uTime.value = localTime;
				u.uIntensity.value = intensity;
				u.uAspect.value = world.width / world.height;
			}}
		/>
	);
}
