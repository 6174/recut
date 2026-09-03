import * as THREE from "three";
import type { ComponentRenderContext } from "../../types";
import { num } from "../../utils";
import { EFFECT_RENDER_ORDER } from "./shared/constants";
import { useSceneTexture } from "./shared/scene-texture";
import { useMaterialUniforms } from "./shared/uniforms";
import { getShaderTexturePass } from "../../shader-effects/registry";
import { PASSTHROUGH_VERTEX } from "../../shader-effects/shared/glsl";

/**
 * 玻璃特效：全画布后处理平面，以圆角 SDF 玻璃卡折射 / 反射底层场景纹理。
 * 玻璃卡中心由可关键帧的 centerX/centerY（UV [0,1]）参数驱动。
 */
export function GlassEffect({ world, params }: ComponentRenderContext) {
	const texture = useSceneTexture();
	if (!texture) return null;
	const centerX = num(params.centerX, 0.5);
	const centerY = num(params.centerY, 0.5);
	const zoom = num(params.zoom, 1.34);
	const ior = num(params.ior, 1.5);
	const depth = num(params.depth, 250);
	const reflect = num(params.reflect, 1);
	const half = num(params.half, 170);

	const { material, uniforms } = useMaterialUniforms<THREE.ShaderMaterial>(
		() => ({
			uMap: new THREE.Uniform(texture),
			uResolution: new THREE.Uniform(
				new THREE.Vector2(world.width, world.height),
			),
			uCenter: new THREE.Uniform(
				new THREE.Vector2(centerX * world.width, centerY * world.height),
			),
			uHalf: new THREE.Uniform(new THREE.Vector2(half, half)),
			uCorner: new THREE.Uniform(half),
			uEdge: new THREE.Uniform(0.7),
			uBevel: new THREE.Uniform(4),
			uIor: new THREE.Uniform(ior),
			uDepth: new THREE.Uniform(depth),
			uAberration: new THREE.Uniform(1),
			uBlur: new THREE.Uniform(0),
			uReflect: new THREE.Uniform(reflect),
			uShine: new THREE.Uniform(0.01),
			uZoom: new THREE.Uniform(zoom),
		}),
		(u) => {
			u.uMap.value = texture;
			u.uResolution.value.set(world.width, world.height);
			u.uCenter.value.set(centerX * world.width, centerY * world.height);
			u.uHalf.value.set(half, half);
			u.uCorner.value = half;
			u.uIor.value = ior;
			u.uDepth.value = depth;
			u.uReflect.value = reflect;
			u.uZoom.value = zoom;
		},
	);

	return (
		<mesh
			position={[0, 0, 0]}
			renderOrder={EFFECT_RENDER_ORDER}
			frustumCulled={false}
		>
			<planeGeometry args={[world.width, world.height]} />
			<shaderMaterial
				ref={material}
				fragmentShader={getShaderTexturePass("glass")!}
				vertexShader={PASSTHROUGH_VERTEX}
				uniforms={uniforms}
				toneMapped={false}
				transparent
				depthTest={false}
				depthWrite={false}
			/>
		</mesh>
	);
}
