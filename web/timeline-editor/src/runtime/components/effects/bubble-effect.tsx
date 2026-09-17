import { useRef } from "react";
import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { PostEffectPlane } from "./shared/post-effect";
import { getShaderTexturePass } from "../../shader-effects/registry";
const MAX_TRAIL = 24;
const TRAIL_COUNT = 18;


const updateTrail = (points: THREE.Vector2[], time: number, aspect: number) => {
	points.forEach((point, index) => {
		const delayed = time * 0.72 - index * 0.052;
		const x =
			Math.sin(delayed * 0.82) * Math.min(aspect * 0.62, 1.12) +
			Math.sin(delayed * 1.61) * 0.16;
		const y = Math.cos(delayed * 0.57) * 0.38 + Math.sin(delayed * 1.17) * 0.12;
		point.set(x, y);
	});
};

/** 气泡：metaball 轨迹 ray-march + 折射色散 + 镜面 glints，轨迹随时间重建。 */
export function BubbleEffect({ world, params, localTime }: ComponentRenderContext) {
	const trail = useRef<THREE.Vector2[]>([]);
	if (trail.current.length === 0) {
		trail.current = Array.from({ length: MAX_TRAIL }, () => new THREE.Vector2());
	}
	const intensity = num(params.intensity, 1);
	const refraction = num(params.refraction, 80);
	const dispersion = num(params.dispersion, 1);
	const iridescence = num(params.iridescence, 1);
	const aspect = world.width / world.height;
	return (
		<PostEffectPlane
			world={world}
			fragmentShader={getShaderTexturePass("bubble")!}
			buildUniforms={(texture) => ({
				uMap: new THREE.Uniform(texture),
				uResolution: new THREE.Uniform(
					new THREE.Vector2(world.width, world.height),
				),
				uTime: new THREE.Uniform(0),
				uCount: new THREE.Uniform(TRAIL_COUNT),
				uTrail: new THREE.Uniform(trail.current),
				uBaseRadius: new THREE.Uniform((2 * 42) / (1080 * TRAIL_COUNT)),
				uBlend: new THREE.Uniform(14),
				uRefraction: new THREE.Uniform(refraction),
				uDispersion: new THREE.Uniform(dispersion),
				uShine: new THREE.Uniform(0.25),
				uRim: new THREE.Uniform(0.5),
				uIridescence: new THREE.Uniform(iridescence),
				uIntensity: new THREE.Uniform(intensity),
				uColorA: new THREE.Uniform(new THREE.Color(0.29, 0.45, 0.72)),
				uColorB: new THREE.Uniform(new THREE.Color(0.41, 0.41, 0.42)),
			})}
			updateUniforms={(u, texture) => {
				u.uMap.value = texture;
				u.uResolution.value.set(world.width, world.height);
				updateTrail(trail.current, localTime, aspect);
				u.uTime.value = localTime * 2;
				u.uIntensity.value = intensity;
				u.uRefraction.value = refraction;
				u.uDispersion.value = dispersion;
				u.uIridescence.value = iridescence;
			}}
		/>
	);
}
